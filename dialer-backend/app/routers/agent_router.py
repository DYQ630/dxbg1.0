"""邀约员路由：领取号码、提交使用、收藏、历史、个人资料。

面向普通邀约员，提供号码领取和使用全流程接口。
所有接口均需登录（get_current_user 鉴权），无需管理员权限。
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from .. import models, schemas
from ..deps import get_current_user
from ..phone_util import mask_number
from . import admin_router  # 复用 _resolve_tags_to_names

router = APIRouter(prefix="/api/agent", tags=["邀约员"])


# ==============================================================
# 北京时间工具函数（与 admin_router 保持一致）
# ==============================================================

def _now_bj():
    """返回当前北京时间（东八区，带时区）。"""
    return datetime.now(timezone(timedelta(hours=8)))


def _today_start_bj():
    """返回北京时间今天 0:00:00（带时区）。"""
    now = _now_bj()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


# ==============================================================
# 规则解析（与 admin_router._resolve_rule 逻辑一致）
# ==============================================================

def _resolve_rule(db: Session, user_id: int) -> dict:
    """解析指定用户的生效规则：优先用个人规则，否则继承全局。

    返回：{daily_limit, history_count, favorite_limit, recycle_days}
    """
    g = db.query(models.GlobalRule).filter(models.GlobalRule.id == 1).first()
    if not g:
        g = models.GlobalRule(id=1, daily_limit=50, history_count=5, favorite_limit=5, recycle_days=7)
        db.add(g)
        db.commit()
        db.refresh(g)
    ur = db.query(models.UserRule).filter(models.UserRule.user_id == user_id).first()
    return {
        "daily_limit": ur.daily_limit or g.daily_limit if ur else g.daily_limit,
        "history_count": ur.history_count or g.history_count if ur else g.history_count,
        "favorite_limit": ur.favorite_limit or g.favorite_limit if ur else g.favorite_limit,
        "recycle_days": ur.recycle_days or g.recycle_days if ur else g.recycle_days,
    }


# ==============================================================
# 自动回收（号码分配后长期未提交则回池）
# ==============================================================

def _auto_recycle(db: Session, user_id: int, recycle_days: int):
    """回收分配给该用户、超过 N 天未提交使用记录的号码。

    触发时机：每次 get_current / swap_to_next_number 调用时执行（懒回收）。
    被回收的号码：assigned_to 置 NULL，status 改为 pool（回到号码池，不进入回收池）。

    参数：
      user_id: 员工 ID
      recycle_days: 超过多少天未提交则回收（由规则决定）
    """
    expire_at = _now_bj() - timedelta(days=recycle_days)
    expired = db.query(models.PhoneNumber).filter(
        models.PhoneNumber.assigned_to == user_id,
        models.PhoneNumber.status == "assigned",
        models.PhoneNumber.assigned_at != None,
        models.PhoneNumber.assigned_at < expire_at,
    ).all()
    for n in expired:
        n.status = "pool"
        n.assigned_to = None
        n.assigned_at = None
    if expired:
        db.commit()


# ==============================================================
# 号码领取 / 当前号码
# ==============================================================

@router.get("/current")
def get_current(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """返回当前待跟进号码（自动分配逻辑）。

    自动分配规则（按优先级依次判断）：
      1. 今日已达上限（today_used >= daily_limit）→ 返回 number=None + reason
      2. 已有分配且未完成（status='assigned'）→ 直接返回当前号码
      3. 从池中按 ID 升序取第一个（先来先得、均分原则）
      4. 号码池为空 → 返回 number=None + reason

    每位员工首次分配到某号码时，号码的 usage_count += 1（distinct 计数）。
    """
    rule = _resolve_rule(db, user.id)
    _auto_recycle(db, user.id, rule["recycle_days"])

    # 今日已使用数（北京时间当天 0 点起）
    today_start = _today_start_bj()
    today_used = db.query(models.UsageRecord).filter(
        models.UsageRecord.user_id == user.id,
        models.UsageRecord.used_at >= today_start,
    ).count()

    # 1. 今日已达上限
    if today_used >= rule["daily_limit"]:
        return {
            "number": None,
            "reason": "今日已达上限",
            "today_used": today_used,
            "daily_limit": rule["daily_limit"]
        }

    # 2. 有未完成分配的号码 → 直接返回
    current = db.query(models.PhoneNumber).filter(
        models.PhoneNumber.assigned_to == user.id,
        models.PhoneNumber.status == "assigned",
    ).first()

    if not current:
        # 3. 从池中按 ID 升序取第一个未分配号码
        current = db.query(models.PhoneNumber).filter(
            models.PhoneNumber.status == "pool",
        ).order_by(models.PhoneNumber.id.asc()).first()

        if not current:
            return {
                "number": None,
                "reason": "号码池已空",
                "today_used": today_used,
                "daily_limit": rule["daily_limit"]
            }

        # 分配给该员工，并计入 usage_count
        current.assigned_to = user.id
        current.assigned_at = _now_bj()
        current.status = "assigned"
        current.display_status = "已分配"
        _increment_usage_count(db, current.id, user.id)
        db.commit()
        db.refresh(current)

    return {
        "number": {
            "id": current.id,
            "number_masked": mask_number(current.number),
            "number_plain": current.number,
            "carrier": current.carrier,
            "region": current.region,
        },
        "today_used": today_used,
        "daily_limit": rule["daily_limit"],
        "history_count": rule["history_count"],
        "favorite_limit": rule["favorite_limit"],
        "recycle_days": rule["recycle_days"],
    }


@router.post("/current/next")
def swap_to_next_number(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """换个号码：将当前分配的号码释放回池，立即分配下一个。

    业务规则：
      1. 把用户当前 'assigned' 状态的号码重置为 'pool'（不写 usage 记录，因为没拨）
      2. 从号码池按 ID 顺序取下一个未分配的号码分配给该员工
      3. 若已达今日上限 / 池空，返回 number=None + reason

    注意：换号不消耗今日额度（submit_usage 提交后才算一次使用）。
    """
    rule = _resolve_rule(db, user.id)
    _auto_recycle(db, user.id, rule["recycle_days"])

    today_start = _today_start_bj()
    today_used = db.query(models.UsageRecord).filter(
        models.UsageRecord.user_id == user.id,
        models.UsageRecord.used_at >= today_start,
    ).count()
    if today_used >= rule["daily_limit"]:
        return {
            "number": None,
            "reason": "今日已达上限",
            "today_used": today_used,
            "daily_limit": rule["daily_limit"]
        }

    # 1. 释放当前 assigned 号码（不写记录）
    cur = db.query(models.PhoneNumber).filter(
        models.PhoneNumber.assigned_to == user.id,
        models.PhoneNumber.status == "assigned",
    ).first()
    if cur:
        cur.assigned_to = None
        cur.assigned_at = None
        cur.status = "pool"

    # 2. 取下一个（按 ID 升序）
    nxt = db.query(models.PhoneNumber).filter(
        models.PhoneNumber.status == "pool",
    ).order_by(models.PhoneNumber.id.asc()).first()

    if not nxt:
        db.commit()
        return {
            "number": None,
            "reason": "号码池已空",
            "today_used": today_used,
            "daily_limit": rule["daily_limit"]
        }

    nxt.assigned_to = user.id
    nxt.assigned_at = _now_bj()
    nxt.status = "assigned"
    nxt.display_status = "已分配"
    _increment_usage_count(db, nxt.id, user.id)
    db.commit()
    db.refresh(nxt)

    return {
        "number": {
            "id": nxt.id,
            "number_masked": mask_number(nxt.number),
            "number_plain": nxt.number,
            "carrier": nxt.carrier,
            "region": nxt.region,
        },
        "today_used": today_used,
        "daily_limit": rule["daily_limit"],
    }


# ==============================================================
# 标签列表
# ==============================================================

@router.get("/tags", response_model=List[schemas.TagOut])
def list_tags(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """返回所有可用标签（内置+自定义），邀约员提交记录时选择。"""
    return db.query(models.Tag).order_by(models.Tag.id).all()


# ==============================================================
# 使用记录提交
# ==============================================================

@router.post("/usage", response_model=schemas.UsageOut)
def submit_usage(
    data: schemas.UsageIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """提交一次使用：标记完成 + 写使用记录。

    业务规则：
      1. 号码必须当前分配给该员工（assigned_to == user.id）
      2. 收藏数校验：is_favorite=True 时，若已有收藏数 >= favorite_limit 则拒绝
      3. 写 usage 记录时，若 (number_id, user_id) 组合首次出现 → usage_count += 1
      4. 提交后，若员工历史记录数 > history_count 限制 → 回收最旧 1 条对应号码

    参数：
      - data.number_id: 号码 ID（必须在 assigned 状态且分配给当前用户）
      - data.tags: 标签 ID 或名称列表
      - data.note: 备注
      - data.is_favorite: 是否收藏（受 favorite_limit 限制）

    返回：UsageOut（含号码详情、标签列表）
    """
    rule = _resolve_rule(db, user.id)
    num = db.query(models.PhoneNumber).filter(models.PhoneNumber.id == data.number_id).first()
    if not num:
        raise HTTPException(404, "号码不存在")
    if num.assigned_to != user.id:
        raise HTTPException(403, "该号码未分配给你")

    # 收藏数校验
    fav_count = db.query(models.UsageRecord).filter(
        models.UsageRecord.user_id == user.id,
        models.UsageRecord.is_favorite == True,
    ).count()
    if data.is_favorite and fav_count >= rule["favorite_limit"]:
        raise HTTPException(400, f"收藏已达上限 {rule['favorite_limit']} 个")

    # 标签转换：id → 名称
    tags_str = admin_router._resolve_tags_to_names(data.tags) if data.tags else ""

    # 写使用记录
    rec = models.UsageRecord(
        number_id=num.id,
        user_id=user.id,
        tags=tags_str,
        note=data.note or "",
        is_favorite=data.is_favorite,
        is_completed=True,
        used_at=_now_bj(),
        completed_at=_now_bj(),
    )
    db.add(rec)

    # 更新号码状态
    num.status = "favorite" if data.is_favorite else "used"
    num.used_at = _now_bj()
    num.display_status = "已分配"

    # usage_count +1（仅当该组合首次出现时）
    _increment_usage_count(db, num.id, user.id)

    # 滑动窗口规则：历史记录超限则回收最旧号码
    _enforce_history_limit(db, user.id, rule["history_count"])

    db.commit()
    db.refresh(rec)

    return _to_usage_out(rec)


@router.put("/usage/{rid}", response_model=schemas.UsageOut)
def update_usage(
    rid: int,
    data: schemas.UsageUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """更新使用记录（标签/备注/收藏状态）。

    注意：
      - 只能更新自己的记录（user_id 匹配）
      - 修改 is_favorite 会同步更新号码状态（favorite ↔ used）
      - 收藏数校验：新增收藏时，若已达上限则拒绝
    """
    rec = db.query(models.UsageRecord).filter(
        models.UsageRecord.id == rid,
        models.UsageRecord.user_id == user.id
    ).first()
    if not rec:
        raise HTTPException(404, "记录不存在")
    rule = _resolve_rule(db, user.id)

    # 更新标签
    if data.tags is not None:
        rec.tags = admin_router._resolve_tags_to_names(data.tags)

    # 更新备注
    if data.note is not None:
        rec.note = data.note

    # 更新收藏状态（含收藏数校验）
    if data.is_favorite is not None and data.is_favorite != rec.is_favorite:
        if data.is_favorite:
            fav_count = db.query(models.UsageRecord).filter(
                models.UsageRecord.user_id == user.id,
                models.UsageRecord.is_favorite == True,
            ).count()
            if fav_count >= rule["favorite_limit"]:
                raise HTTPException(400, f"收藏已达上限 {rule['favorite_limit']} 个")
        rec.is_favorite = data.is_favorite
        # 同步更新号码状态
        num = db.query(models.PhoneNumber).filter(models.PhoneNumber.id == rec.number_id).first()
        if num:
            num.status = "favorite" if data.is_favorite else "used"

    db.commit()
    db.refresh(rec)
    return _to_usage_out(rec)


# ==============================================================
# 历史记录 / 收藏
# ==============================================================

@router.get("/history")
def history(
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """返回分页历史记录（按使用时间倒序）。

    参数：
      - page / page_size: 分页，默认 page=1, page_size=50
    """
    total = db.query(models.UsageRecord).filter(
        models.UsageRecord.user_id == user.id
    ).count()
    records = (
        db.query(models.UsageRecord)
        .filter(models.UsageRecord.user_id == user.id)
        .order_by(models.UsageRecord.used_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "records": [_to_usage_out(r) for r in records],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/favorites", response_model=List[schemas.UsageOut])
def favorites(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """返回当前员工所有收藏记录（按使用时间倒序）。"""
    return [
        _to_usage_out(r) for r in
        db.query(models.UsageRecord)
        .filter(
            models.UsageRecord.user_id == user.id,
            models.UsageRecord.is_favorite == True
        )
        .order_by(models.UsageRecord.used_at.desc())
        .all()
    ]


@router.post("/favorite/cancel")
def cancel_favorite(
    data: dict,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """取消收藏：将号码从 favorite 状态移入回收池。

    操作：
      - 号码 status → recycled，assigned_to → NULL，display_status → "已使用"
      - usage 记录保留，仅 is_favorite 改为 False
    """
    number_id = data.get("number_id")
    if not number_id:
        raise HTTPException(400, "number_id 为空")
    rec = db.query(models.UsageRecord).filter(
        models.UsageRecord.number_id == number_id,
        models.UsageRecord.user_id == user.id,
        models.UsageRecord.is_favorite == True,
    ).first()
    if not rec:
        raise HTTPException(404, "收藏记录不存在")
    num = db.query(models.PhoneNumber).filter(models.PhoneNumber.id == number_id).first()
    if num:
        num.status = "recycled"
        num.recycled_by = user.id
        num.assigned_to = None
        num.display_status = "已使用"
    rec.is_favorite = False
    db.commit()
    return {"ok": True, "message": "已取消收藏，号码进入回收池"}


@router.delete("/usage/{rid}")
def delete_usage(rid: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """删除使用记录，号码进入回收池，并自动分配下一个号码。

    操作：
      1. 记录删除
      2. 号码 → recycled（进入回收池），assigned_to 置 NULL
      3. 若今日未达上限 → 自动分配下一个 pool 号码

    注意：删除后自动换号（不消耗今日额度，除非真正分配了下一个号码）
    """
    rec = db.query(models.UsageRecord).filter(
        models.UsageRecord.id == rid,
        models.UsageRecord.user_id == user.id
    ).first()
    if not rec:
        raise HTTPException(404, "记录不存在")

    num = db.query(models.PhoneNumber).filter(models.PhoneNumber.id == rec.number_id).first()
    if num:
        num.status = "recycled"
        num.recycled_by = user.id
        num.assigned_to = None
        num.used_at = None
        num.display_status = "已使用"
    db.delete(rec)

    # 自动分配下一个号码
    rule = _resolve_rule(db, user.id)
    today_start = _today_start_bj()
    today_used = db.query(models.UsageRecord).filter(
        models.UsageRecord.user_id == user.id,
        models.UsageRecord.used_at >= today_start,
    ).count()
    next_number = None
    if today_used < rule["daily_limit"]:
        next_number = db.query(models.PhoneNumber).filter(
            models.PhoneNumber.status == "pool",
        ).order_by(models.PhoneNumber.id.asc()).first()
        if next_number:
            next_number.assigned_to = user.id
            next_number.assigned_at = _now_bj()
            next_number.status = "assigned"
            next_number.display_status = "已分配"

    db.commit()

    result = {"ok": True, "message": "已删除，号码进入回收池"}
    if next_number:
        result["next_number"] = {
            "id": next_number.id,
            "number_masked": mask_number(next_number.number),
            "number_plain": next_number.number,
            "carrier": next_number.carrier,
            "region": next_number.region,
        }
    return result


# ==============================================================
# 个人资料 / 密码
# ==============================================================

@router.put("/profile")
def update_profile(
    data: dict,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """更新个人资料（姓名/手机号/头像 URL）。"""
    if "real_name" in data:
        user.real_name = data["real_name"]
    if "phone" in data:
        user.phone = data["phone"]
    if "avatar" in data:
        user.avatar = data["avatar"]
    db.commit()
    db.refresh(user)
    return {
        "ok": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "real_name": user.real_name,
            "phone": user.phone,
            "role": user.role
        }
    }


@router.post("/change-password")
def change_password(
    data: dict,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """修改密码（需验证旧密码）。"""
    from .. import auth as auth_module
    old_pw = data.get("old_password")
    new_pw = data.get("new_password")
    if not old_pw or not new_pw:
        raise HTTPException(400, "请提供旧密码和新密码")
    if not auth_module.verify_pw(old_pw, user.password_hash):
        raise HTTPException(400, "旧密码错误")
    user.password_hash = auth_module.hash_pw(new_pw)
    db.commit()
    return {"ok": True, "message": "密码修改成功"}


# ==============================================================
# 内部辅助函数
# ==============================================================

def _increment_usage_count(db: Session, number_id: int, user_id: int):
    """若 (number_id, user_id) 组合在 usage_records 中首次出现 → usage_count += 1。

    usage_count 字段含义：被多少个不同员工领取过（distinct 计数）。
    同一个员工重复领取同一号码不累加，用于识别"热号"。
    """
    exists = db.query(models.UsageRecord).filter(
        models.UsageRecord.number_id == number_id,
        models.UsageRecord.user_id == user_id,
    ).first()
    if not exists:
        num = db.query(models.PhoneNumber).filter(models.PhoneNumber.id == number_id).first()
        if num:
            num.usage_count = (num.usage_count or 0) + 1


def _enforce_history_limit(db: Session, user_id: int, history_count: int):
    """滑动窗口规则：员工历史记录只保留最近 N 条。

    员工每次 submit_usage 后调用此函数。
    若该员工 usage_records 总数（不含收藏）超过 limit，把最旧 1 条记录对应号码
    置为 status='recycled'（进入回收池）。
    usage_records 本身保留（前端分页仍可查看历史）。

    收藏豁免：is_favorite=True 的记录不参与窗口计数
    （收藏由 favorite_limit 独立管理，不会被历史窗口挤出）。
    """
    if not history_count or history_count <= 0:
        return
    # 取不含收藏的所有记录，按时间升序（最旧的在前）
    recs = db.query(models.UsageRecord).filter(
        models.UsageRecord.user_id == user_id,
        models.UsageRecord.is_favorite == False,
    ).order_by(
        models.UsageRecord.used_at.asc(),
        models.UsageRecord.id.asc()
    ).all()
    if len(recs) <= history_count:
        return
    # 只回收最旧的 1 条（每次提交滑动 1 条，逐条消化积压）
    # 若最旧记录对应号码已不在本员工名下（已被恢复/再分配），顺延下一条
    for rec in recs[:-history_count]:
        num = db.query(models.PhoneNumber).filter(
            models.PhoneNumber.id == rec.number_id
        ).first()
        if not num or num.deleted_at is not None:
            continue
        # 仅当号码仍挂在本员工名下（assigned_to == user_id）且处于 used/favorite 才回收
        if num.assigned_to == user_id and num.status in ("used", "favorite"):
            num.status = "recycled"
            num.recycled_by = user_id
            num.assigned_to = None
            num.display_status = "已使用"
            db.flush()
            return


def _to_usage_out(rec: models.UsageRecord) -> dict:
    """将 UsageRecord ORM 对象转换为 UsageOut 响应字典。

    处理号码被删除的边界情况（number=None），避免序列化失败。
    tags 字段从逗号分隔字符串转为列表。
    """
    num = rec.number
    if num is None:
        return {
            "id": rec.id,
            "number": {
                "id": None,
                "number": "(号码已删除)",
                "number_plain": "(号码已删除)",
                "number_masked": "(号码已删除)",
                "carrier": "",
                "region": "",
                "status": "deleted",
            },
            "tags": [t for t in (rec.tags or "").split(",") if t],
            "note": rec.note,
            "is_favorite": rec.is_favorite,
            "is_completed": rec.is_completed,
            "used_at": rec.used_at,
            "completed_at": rec.completed_at,
        }
    return {
        "id": rec.id,
        "number": {
            "id": num.id,
            "number": mask_number(num.number),
            "number_plain": num.number,
            "number_masked": mask_number(num.number),
            "carrier": num.carrier,
            "region": num.region,
            "status": num.status,
        },
        "tags": [t for t in (rec.tags or "").split(",") if t],
        "note": rec.note,
        "is_favorite": rec.is_favorite,
        "is_completed": rec.is_completed,
        "used_at": rec.used_at,
        "completed_at": rec.completed_at,
    }
