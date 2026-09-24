"""管理员路由：用户管理、规则管理、号码导入/池管理、统计报表、回收池。

所有接口均需管理员权限（require_admin 依赖注入），否则返回 403。
邀约员请使用 agent_router.py。
"""
import io
import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from openpyxl import load_workbook
from ..database import get_db
from .. import models, auth, schemas
from ..deps import require_admin
from ..phone_util import detect_phone

router = APIRouter(prefix="/api/admin", tags=["管理员"])


# ==============================================================
# 北京时间工具函数（所有时间均使用东八区，避免 UTC 本地时间混淆）
# ==============================================================

def _now_bj():
    """返回当前北京时间（东八区，带时区信息）。"""
    return datetime.now(timezone(timedelta(hours=8)))


def _today_start_bj():
    """返回北京时间今天 0:00:00（带时区信息）。用于日期边界判断。"""
    now = _now_bj()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


# ---- naive（无时区）北京时间：用于与 SQLite 中存储的 naive datetime 直接比较 ----
# SQLite 没有时区概念，存储的是 naive datetime，直接比较时不能混入带 tzinfo 的对象

def _now_bj_naive():
    """返回当前北京时间（naive，无时区），用于与 SQLite datetime 直接比较。"""
    return _now_bj().replace(tzinfo=None)


def _today_start_bj_naive():
    """返回北京时间今天 0:00:00（naive，无时区）。"""
    return _now_bj_naive().replace(hour=0, minute=0, second=0, microsecond=0)


def _week_start_bj_naive():
    """返回本周起点北京时间（naive），以周日为一周起点。

    计算方式：今日 - (今日weekday + 1) % 7 天
    等价于 SQLite: date('now','weekday 0','-7 days')
    Python weekday(): 0=Mon, 6=Sun
    """
    t = _today_start_bj_naive()
    return t - timedelta(days=(t.weekday() + 1) % 7)


def _month_start_bj_naive():
    """返回本月起点北京时间（naive），即每月 1 日 0:00:00。"""
    return _today_start_bj_naive().replace(day=1)


# ==============================================================
# usage_count 区间桶（前后端统一口径）
# ==============================================================

# 桶定义：按 usage_count（被多少个不同员工领取过）分为 5 档
# - 0：从未被分配过
# - 1/2/3：被 1/2/3 个员工分配过
# - 4plus：被 4 个及以上员工分配过（热号）
USAGE_BUCKET_KEYS = ["0", "1", "2", "3", "4plus"]


def _usage_bucket_key(uc: Optional[int]) -> str:
    """把 usage_count 映射到桶 key：0/1/2/3/4plus。"""
    n = int(uc or 0)
    return str(n) if n <= 3 else "4plus"


def _empty_usage_buckets() -> dict:
    """返回全是 0 的 5 档桶字典。"""
    return {k: 0 for k in USAGE_BUCKET_KEYS}


def _usage_buckets_from_query(q):
    """对一个 PhoneNumber 查询做真实 SQL GROUP BY usage_count 聚合，再折叠成 5 个桶。

    参数：q 为 SQLAlchemy 查询对象（已包含筛选条件）
    返回：{"0": N, "1": N, "2": N, "3": N, "4plus": N}
    """
    buckets = _empty_usage_buckets()
    rows = q.with_entities(
        func.coalesce(models.PhoneNumber.usage_count, 0).label("uc"),
        func.count(models.PhoneNumber.id).label("cnt"),
    ).group_by(func.coalesce(models.PhoneNumber.usage_count, 0)).all()
    for uc, cnt in rows:
        buckets[_usage_bucket_key(uc)] += int(cnt or 0)
    return buckets


def _apply_usage_bucket_filter(q, usage_bucket: Optional[str]):
    """按 usage_bucket 过滤：对 0/1/2/3 精确匹配，对 4plus 取 >=4。"""
    if not usage_bucket:
        return q
    key = str(usage_bucket).strip()
    uc = func.coalesce(models.PhoneNumber.usage_count, 0)
    if key == "4plus":
        return q.filter(uc >= 4)
    if key in ("0", "1", "2", "3"):
        return q.filter(uc == int(key))
    raise HTTPException(400, f"usage_bucket 非法，仅支持 {'/'.join(USAGE_BUCKET_KEYS)}")


# ==============================================================
# 用户管理
# ==============================================================

@router.get("/users", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    """返回所有未删除用户（含个人规则覆盖字段）。

    返回字段中：
      - daily_limit / history_count / favorite_limit / recycle_days：
        有个人规则则返回具体值；无个人规则则返回 None（前端应使用全局规则）
    """
    users = db.query(models.User).filter(
        models.User.deleted_at.is_(None)
    ).order_by(models.User.id.desc()).all()
    result = []
    for u in users:
        ur = db.query(models.UserRule).filter_by(user_id=u.id).first()
        result.append({
            "id": u.id,
            "username": u.username,
            "real_name": u.real_name or "",
            "role": u.role,
            "phone": u.phone,
            "is_active": bool(u.is_active),
            "daily_limit": ur.daily_limit if ur else None,
            "history_count": ur.history_count if ur else None,
            "favorite_limit": ur.favorite_limit if ur else None,
            "recycle_days": ur.recycle_days if ur else None,
        })
    return result


@router.post("/users", response_model=schemas.UserOut)
def create_user(data: schemas.UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    """新建用户账号（可为管理员或邀约员）。

    校验：用户名唯一，重复则返回 400。
    创建后自动哈希密码，初始密码由调用方提供。
    """
    if db.query(models.User).filter(models.User.username == data.username).first():
        raise HTTPException(400, "用户名已存在")
    u = models.User(
        username=data.username,
        password_hash=auth.hash_pw(data.password),   # 明文密码入库前必须哈希
        real_name=data.real_name,
        phone=data.phone or "",
        role=data.role or "agent",   # 默认角色为邀约员（agent）
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.put("/users/{uid}", response_model=schemas.UserOut)
def update_user(uid: int, data: schemas.UserUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    """更新指定用户信息（部分更新，仅处理非 None 字段）。

    可更新：姓名、电话、密码（传值时触发哈希）、在职状态
    """
    u = db.query(models.User).filter(models.User.id == uid).first()
    if not u:
        raise HTTPException(404, "用户不存在")
    if data.real_name is not None:
        u.real_name = data.real_name
    if data.phone is not None:
        u.phone = data.phone
    if data.password:
        u.password_hash = auth.hash_pw(data.password)
    if data.is_active is not None:
        u.is_active = data.is_active
    db.commit()
    db.refresh(u)
    return u


@router.delete("/users/{uid}")
def delete_user(uid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    """硬删除员工并生成数据备份文档（不可恢复）。

    业务流程（3步）：
      Step 1: 收集员工所有数据快照（用户信息 / 拨打记录 / 关联号码 / 个人规则）
      Step 2: 生成 Excel 备份文档（5 个 sheet）保存到 exports/ 目录
      Step 3: 物理删除数据库记录（号码回池，usage_records 保留）

    数据清理规则：
      - 关联号码：assigned_to 置 NULL，status 改为 pool，display_status="待分配"
      - usage_records：仅删除该员工本人提交的记录（他人打的记录保留）
      - user_rule：物理删除
      - user：物理删除

    返回：{ok, doc_filename, doc_path, doc_size, stats}
    """
    u = db.query(models.User).filter(models.User.id == uid).first()
    if not u:
        raise HTTPException(404, "用户不存在")
    if u.role == "admin":
        raise HTTPException(400, "不能删除管理员账号")

    # Step 1: 收集数据快照
    deleted_at_bj = _now_bj_naive()

    # 用户基本信息
    user_snapshot = {
        "id": u.id, "username": u.username, "real_name": u.real_name,
        "role": u.role, "phone": u.phone or "", "is_active": u.is_active,
        "created_at": u.created_at, "deleted_at": deleted_at_bj,
    }

    # 关联号码（assigned_to = uid 的所有号码）
    phones = db.query(models.PhoneNumber).filter(models.PhoneNumber.assigned_to == uid).all()
    phone_ids = [p.id for p in phones]
    phones_data = [
        {
            "id": p.id, "number": p.number, "carrier": p.carrier or "",
            "region": p.region or "", "status": p.status,
            "usage_count": p.usage_count, "assigned_at": p.assigned_at,
            "used_at": p.used_at, "created_at": p.created_at,
        }
        for p in phones
    ]

    # 拨打记录（仅本人打的：user_id = uid）
    my_records = db.query(models.UsageRecord).filter(models.UsageRecord.user_id == uid).all()

    # Tag 表：id → name 映射（用于把历史记录中的数字 ID 转为中文名称）
    tag_map = {t.id: t.name for t in db.query(models.Tag).all()}

    def _format_tags(tags_raw):
        """把 tags 字符串转为中文名称。
        旧数据格式（如 "3"）→ 查表转名称（如 "已加微信"）
        新数据格式（如 "已接通,已加微信"）→ 直接返回
        空值 → "无标签"
        """
        if not tags_raw or not str(tags_raw).strip():
            return "无标签"
        parts = [p.strip() for p in str(tags_raw).split(",") if p.strip()]
        out = []
        for p in parts:
            if p.isdigit() and int(p) in tag_map:
                out.append(tag_map[int(p)])
            else:
                out.append(p)
        return ",".join(out) if out else "无标签"

    # 合并拨打记录（按 used_at 倒序）
    records_combined = []
    for r in my_records:
        caller = db.query(models.User).filter(models.User.id == r.user_id).first()
        caller_name = f"{caller.real_name}({caller.username})" if caller else "本人(员工已删除)"
        records_combined.append({
            "id": r.id, "number_id": r.number_id,
            "number": r.number.number if r.number else "(号码已删除)",
            "caller": "本人", "caller_name": caller_name,
            "tags": _format_tags(r.tags), "note": r.note or "",
            "is_favorite": r.is_favorite, "is_completed": r.is_completed,
            "used_at": r.used_at, "completed_at": r.completed_at, "deleted_at": r.deleted_at,
        })
    records_combined.sort(key=lambda x: x["used_at"] or datetime.min, reverse=True)

    # 个人规则
    rule = db.query(models.UserRule).filter(models.UserRule.user_id == uid).first()
    rule_data = None
    if rule:
        rule_data = {
            "daily_limit": rule.daily_limit, "history_count": rule.history_count,
            "favorite_limit": rule.favorite_limit, "recycle_days": rule.recycle_days,
        }

    # 汇总统计
    my_count = len(my_records)
    my_favorites = sum(1 for r in my_records if r.is_favorite)
    my_completed = sum(1 for r in my_records if r.is_completed)
    summary = {
        "总拨打记录（本人）": my_count,
        "其中收藏记录": my_favorites,
        "其中完成记录": my_completed,
        "关联号码总数": len(phones_data),
        "是否有个人规则": "有" if rule_data else "无（使用全局）",
    }

    # Step 2: 生成 Excel 文档
    from openpyxl import Workbook as XWorkbook
    wb = XWorkbook()

    # Sheet 1: 汇总信息（一眼看到全部）
    ws_summary = wb.active
    ws_summary.title = "汇总信息"
    ws_summary.append(["字段", "值"])
    ws_summary.append(["--- 员工基本信息 ---", ""])
    ws_summary.append(["员工编号", u.id])
    ws_summary.append(["用户名", u.username])
    ws_summary.append(["真实姓名", u.real_name])
    ws_summary.append(["角色", u.role])
    ws_summary.append(["电话", u.phone or ""])
    ws_summary.append(["创建时间", str(u.created_at) if u.created_at else ""])
    ws_summary.append(["删除时间", str(deleted_at_bj)])
    ws_summary.append(["--- 数据统计 ---", ""])
    for key, value in summary.items():
        ws_summary.append([key, value])

    # Sheet 2: 员工信息（字段值对）
    ws_user = wb.create_sheet("员工信息")
    ws_user.append(["字段", "值"])
    for key, value in user_snapshot.items():
        ws_user.append([key, str(value) if value else ""])

    # Sheet 3: 拨打记录（最重要的数据前移）
    ws_records = wb.create_sheet("拨打记录")
    ws_records.append([
        "ID", "号码", "拨打人", "拨打人姓名", "标签", "备注",
        "是否收藏", "是否完成", "使用时间", "完成时间", "删除时间",
    ])
    for r in records_combined:
        ws_records.append([
            r["id"], r["number"], r["caller"], r["caller_name"],
            r["tags"], r["note"],
            "是" if r["is_favorite"] else "否",
            "是" if r["is_completed"] else "否",
            str(r["used_at"]) if r["used_at"] else "",
            str(r["completed_at"]) if r["completed_at"] else "",
            str(r["deleted_at"]) if r["deleted_at"] else "",
        ])

    # Sheet 4: 关联号码
    ws_phones = wb.create_sheet("关联号码")
    ws_phones.append(["ID", "号码", "运营商", "归属地", "状态", "使用次数", "分配时间", "使用时间", "创建时间"])
    for p in phones_data:
        ws_phones.append([
            p["id"], p["number"], p["carrier"], p["region"],
            p["status"], p["usage_count"],
            str(p["assigned_at"]) if p["assigned_at"] else "",
            str(p["used_at"]) if p["used_at"] else "",
            str(p["created_at"]) if p["created_at"] else "",
        ])

    # Sheet 5: 个人规则
    ws_rule = wb.create_sheet("个人规则")
    ws_rule.append(["字段", "值"])
    if rule_data:
        for key, value in rule_data.items():
            ws_rule.append([key, str(value) if value is not None else "(使用全局)"])
    else:
        ws_rule.append(["状态", "无个人规则覆盖，使用全局规则"])

    # 保存文件到 exports/
    timestamp_str = _now_bj_naive().strftime("%Y%m%d_%H%M%S")

    # 文件名 sanitize（去除 Windows 文件名非法字符）
    def _safe(s):
        if not s:
            return ""
        return (str(s)
                .replace("/", "_").replace("\\", "_")
                .replace(":", "_").replace("*", "_")
                .replace("?", "_").replace("\"", "_")
                .replace("<", "_").replace(">", "_")
                .replace("|", "_").replace(" ", "_"))

    safe_name = _safe(u.real_name)
    safe_phone = _safe(u.phone)
    filename = f"{uid}_{safe_name}_{safe_phone}_{timestamp_str}.xlsx" if safe_phone else f"{uid}_{safe_name}_{timestamp_str}.xlsx"

    export_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "exports",
    )
    os.makedirs(export_dir, exist_ok=True)
    filepath = os.path.join(export_dir, filename)
    wb.save(filepath)

    # Step 3: 删除数据（先清外键，再删主表）
    # 关联号码回池（不清 usage_records，号码本身回池）
    for p in phones:
        p.assigned_to = None
        p.assigned_at = None
        if p.status in ("assigned", "used", "favorite"):
            p.status = "pool"
            p.display_status = "待分配"
    db.flush()

    # 仅删除本人打的 usage_records（他人打的记录保留——别人的工作数据）
    db.query(models.UsageRecord).filter(models.UsageRecord.user_id == uid).delete(synchronize_session=False)
    db.flush()

    # 个人规则
    if rule:
        db.delete(rule)
        db.flush()

    # 用户本身
    db.delete(u)
    db.commit()

    return {
        "ok": True,
        "doc_filename": filename,
        "doc_path": filepath,
        "doc_size": os.path.getsize(filepath),
        "stats": {
            "records_count": my_count,
            "phones_count": len(phones_data),
            "has_rule": rule_data is not None,
        }
    }


# ==============================================================
# 规则管理（全局 + 个人）
# ==============================================================

def _resolve_rule(db: Session, user_id: int) -> dict:
    """解析指定用户的生效规则：优先用个人规则，否则继承全局。

    返回字段：daily_limit / history_count / favorite_limit / recycle_days
    """
    g = db.query(models.GlobalRule).filter(models.GlobalRule.id == 1).first()
    if not g:
        g = models.GlobalRule(id=1)
        db.add(g)
        db.commit()
        db.refresh(g)
    ur = db.query(models.UserRule).filter(models.UserRule.user_id == user_id).first()
    return {
        "daily_limit": (ur.daily_limit if ur and ur.daily_limit else g.daily_limit),
        "history_count": (ur.history_count if ur and ur.history_count else g.history_count),
        "favorite_limit": (ur.favorite_limit if ur and ur.favorite_limit else g.favorite_limit),
        "recycle_days": (ur.recycle_days if ur and ur.recycle_days else g.recycle_days),
    }


@router.get("/rules/global", response_model=schemas.GlobalRuleOut)
def get_global_rule(db: Session = Depends(get_db), _=Depends(require_admin)):
    """获取全局规则（整表只有一条，id=1）。若不存在则创建并返回默认值。"""
    g = db.query(models.GlobalRule).filter(models.GlobalRule.id == 1).first()
    if not g:
        g = models.GlobalRule(id=1)
        db.add(g)
        db.commit()
        db.refresh(g)
    return g


@router.put("/rules/global", response_model=schemas.GlobalRuleOut)
def update_global_rule(data: schemas.GlobalRuleIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    """更新全局规则（四个字段一次性更新）。"""
    g = db.query(models.GlobalRule).filter(models.GlobalRule.id == 1).first()
    if not g:
        g = models.GlobalRule(id=1)
        db.add(g)
    g.daily_limit = data.daily_limit
    g.history_count = data.history_count
    g.favorite_limit = data.favorite_limit
    g.recycle_days = data.recycle_days
    db.commit()
    db.refresh(g)
    return g


@router.post("/rules/clear-below-global")
def clear_personal_rules_below_global(db: Session = Depends(get_db), _=Depends(require_admin)):
    """清除所有个人规则覆盖项，将所有人重置为使用全局规则。

    场景：修改全局规则后，调用此接口批量清除个人覆盖，让全员立即生效新全局值。
    不会删除 UserRule 行，只把四个字段全部重置为 None。

    返回：
      - cleared_count: 被清除的非空字段总数
      - affected_users: 受影响的员工人数
      - per_field_cleared: 四个字段各自的清除数量
      - global: 当前全局规则值（供前端校验）
    """
    g = db.query(models.GlobalRule).filter(models.GlobalRule.id == 1).first()
    if not g:
        return {"cleared_count": 0, "total_users": 0,
                "per_field_cleared": {"daily_limit": 0, "history_count": 0, "favorite_limit": 0, "recycle_days": 0}}

    FIELDS = ["daily_limit", "history_count", "favorite_limit", "recycle_days"]
    per_field_cleared = {k: 0 for k in FIELDS}
    rules = db.query(models.UserRule).all()
    cleared = 0
    affected_users = 0
    for ur in rules:
        user_had_override = False
        for fname in FIELDS:
            cur = getattr(ur, fname)
            if cur is not None:
                setattr(ur, fname, None)
                per_field_cleared[fname] += 1
                cleared += 1
                user_had_override = True
        if user_had_override:
            affected_users += 1
    db.commit()
    return {
        "cleared_count": cleared,
        "total_users": len(rules),
        "affected_users": affected_users,
        "per_field_cleared": per_field_cleared,
        "global": {
            "daily_limit": g.daily_limit,
            "history_count": g.history_count,
            "favorite_limit": g.favorite_limit,
            "recycle_days": g.recycle_days,
        },
    }


@router.get("/users/{uid}/rule")
def get_user_rule(uid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    """获取指定用户的生效规则（个人规则 + 全局规则合并结果）。"""
    return _resolve_rule(db, uid)


@router.put("/users/{uid}/rule")
def update_user_rule(uid: int, data: schemas.UserRuleIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    """更新指定用户的个人规则。

    逻辑：
      - 若该用户尚无个人规则行，先创建（UserRule）
      - 仅处理非 None 字段（None = 删除该字段的覆盖，继承全局）
    """
    ur = db.query(models.UserRule).filter(models.UserRule.user_id == uid).first()
    if not ur:
        ur = models.UserRule(user_id=uid)
        db.add(ur)
    if data.daily_limit is not None:
        ur.daily_limit = data.daily_limit
    if data.history_count is not None:
        ur.history_count = data.history_count
    if data.favorite_limit is not None:
        ur.favorite_limit = data.favorite_limit
    if data.recycle_days is not None:
        ur.recycle_days = data.recycle_days
    db.commit()
    return _resolve_rule(db, uid)


# ==============================================================
# 号码导入
# ==============================================================

@router.post("/numbers/import")
async def import_numbers(
    file: UploadFile = File(...),
    add_to_pool: bool = True,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_admin),
):
    """导入 Excel 文件中的手机号码到号码池。

    参数：
      - file: .xlsx 或 .xls 文件，第一列（必需）为手机号
      - add_to_pool: True=直接入库，False=仅预览（返回统计数）
      - user: 当前管理员（记录在批次中）

    Excel 格式约定：
      - 第1列（A列）：手机号（必需，11位）
      - 第2列（B列）：运营商（可选，优先采用）
      - 第3列（C列）：归属地（可选，优先采用）
      - 非数字或空行自动跳过（计入 failed）

    逻辑：
      1. 解析 Excel，识别运营商/归属地（优先 B/C 列，缺失则查 phone_util）
      2. 去重：已在池中的号码跳过（不重复插入）
      3. 记录 ImportBatch（统计 total/success/failed）
      4. 清理旧批次（仅保留最近 10 条）

    返回：{batch_id, total, success, failed}
    """
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "仅支持 .xlsx 或 .xls 格式的 Excel 文件")
    content = await file.read()
    wb = load_workbook(io.BytesIO(content), data_only=True)
    ws = wb.active

    success = failed = 0
    nums = []
    for row in ws.iter_rows(values_only=True):
        if not row or not row[0]:
            continue
        raw = str(row[0]).strip()
        info = detect_phone(raw)
        if not info["valid"]:
            failed += 1
            continue
        # 优先用 Excel 填写值，其次从号段识别
        excel_carrier = (len(row) > 1 and row[1] is not None) and str(row[1]).strip() or ''
        excel_region  = (len(row) > 2 and row[2] is not None) and str(row[2]).strip() or ''
        carrier = excel_carrier or info["carrier"]
        region  = excel_region  or info["region"]
        nums.append((raw, carrier, region))

    batch = models.ImportBatch(
        filename=file.filename,
        total=len(nums) + failed,
        success=0,
        failed=failed,
        created_by=user.id,
    )
    db.add(batch)
    db.flush()

    if add_to_pool:
        for n, c, r in nums:
            # 已在池中（number 唯一）则跳过
            if db.query(models.PhoneNumber).filter(models.PhoneNumber.number == n).first():
                failed += 1
                continue
            db.add(models.PhoneNumber(
                number=n, carrier=c, region=r,
                status="pool", display_status="待分配",
                source_batch_id=batch.id
            ))
            success += 1
        batch.success = success
        batch.failed = failed
    db.commit()
    db.refresh(batch)

    # 清理旧批次（保留最近 10 个）
    old = db.query(models.ImportBatch).order_by(models.ImportBatch.id.desc()).offset(10).all()
    for b in old:
        db.delete(b)
    db.commit()

    return {"batch_id": batch.id, "total": batch.total, "success": batch.success, "failed": batch.failed}


@router.get("/batches", response_model=List[schemas.ImportBatchOut])
def list_batches(db: Session = Depends(get_db), _=Depends(require_admin)):
    """返回最近 10 个导入批次（倒序）。"""
    return db.query(models.ImportBatch).order_by(models.ImportBatch.id.desc()).limit(10).all()


@router.delete("/batches/{bid}")
def delete_batch(bid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    """删除指定批次：仅删除状态为 pool 的号码（避免误删已使用号码），然后删除批次记录。"""
    b = db.query(models.ImportBatch).filter(models.ImportBatch.id == bid).first()
    if not b:
        raise HTTPException(404, "批次不存在")
    # 只删除该批次中状态为 pool 的号码（已使用/收藏/回收的号码不能通过此途径删除）
    db.query(models.PhoneNumber).filter(
        models.PhoneNumber.source_batch_id == bid,
        models.PhoneNumber.status == "pool",
    ).delete()
    db.delete(b)
    db.commit()
    return {"ok": True}


@router.get("/pool/stats")
def pool_stats(db: Session = Depends(get_db), _=Depends(require_admin)):
    """号码池总览（真实 SQL 聚合，排除软删除）。

    口径说明（新滑动窗口规则下，三卡互斥且总和=顶部 total）：
      - total:          全部未删除号码数量
      - pool_remaining: status='pool'  ← 剩余可用：还没被员工领走
      - assigned:       status IN ('assigned','used','favorite')
                        ← 已分配：被员工领走（正在拨打 assigned + 已提交记录 used/favorite）
      - used:           status='recycled'  ← 已使用/已回收：超窗淘汰后进入回收池
      - by_usage:       按 usage_count 区间 {0,1,2,3,4plus} 分布
    """
    PN = models.PhoneNumber
    alive = PN.deleted_at.is_(None)

    # 一次 GROUP BY 拿到所有状态计数
    status_rows = (
        db.query(PN.status, func.count(PN.id))
        .filter(alive)
        .group_by(PN.status)
        .all()
    )
    by_status = {(s or ""): int(c or 0) for s, c in status_rows}
    total = sum(by_status.values())

    by_usage = _usage_buckets_from_query(db.query(PN).filter(alive))

    return {
        "total": total,
        "pool_remaining": by_status.get("pool", 0),
        "assigned": by_status.get("assigned", 0) + by_status.get("used", 0) + by_status.get("favorite", 0),
        "used": by_status.get("recycled", 0),
        "favorite": by_status.get("favorite", 0),
        "recycled": by_status.get("recycled", 0),
        "by_status": by_status,
        "by_usage": by_usage,
    }


# ==============================================================
# 标签管理
# ==============================================================

@router.get("/tags", response_model=List[schemas.TagOut])
def list_tags(db: Session = Depends(get_db), _=Depends(require_admin)):
    """返回所有标签（内置+自定义），按 ID 正序。"""
    return db.query(models.Tag).order_by(models.Tag.id).all()


@router.post("/tags", response_model=schemas.TagOut)
def create_tag(data: schemas.TagIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    """新建自定义标签。校验：名称唯一，重复返回 400。"""
    if db.query(models.Tag).filter(models.Tag.name == data.name).first():
        raise HTTPException(400, "标签名称已存在")
    t = models.Tag(name=data.name, color=data.color)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.put("/tags/{tid}", response_model=schemas.TagOut)
def update_tag(tid: int, data: schemas.TagIn, db: Session = Depends(get_db), _=Depends(require_admin)):
    """更新指定标签的名称和颜色。"""
    t = db.query(models.Tag).filter(models.Tag.id == tid).first()
    if not t:
        raise HTTPException(404, "标签不存在")
    t.name = data.name
    t.color = data.color
    db.commit()
    db.refresh(t)
    return t


@router.delete("/tags/{tid}")
def delete_tag(tid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    """删除指定标签（内置标签建议不删）。"""
    t = db.query(models.Tag).filter(models.Tag.id == tid).first()
    if not t:
        raise HTTPException(404, "标签不存在")
    db.delete(t)
    db.commit()
    return {"ok": True}


# ==============================================================
# 统计报表
# ==============================================================

def _range_start(rng: str) -> datetime:
    """将时间范围参数转为对应的统计起始时间（北京时间，带时区）。

    参数：rng = "today" / "yesterday" / "week" / "month"
    返回：对应时间范围的起始 datetime（含该日 0:00:00）
    """
    today = _today_start_bj()
    if rng == "today":
        return today
    if rng == "yesterday":
        return today - timedelta(days=1)
    if rng == "week":
        return today - timedelta(days=7)
    if rng == "month":
        return today - timedelta(days=30)
    return today


def _cnt_tag(name: str, records: list) -> int:
    """统计指定标签在 records 中的出现次数。

    同时识别：
      - 中文标签名称（如 "已加微信"）
      - Tag 表数字 ID（字符串，如 "3"）

    背景：老数据存的是 Tag.id 字符串，新数据已统一为名称。
    """
    # Tag 表 id → name 映射（用于把 id 转名称）
    name_to_id = {n.strip(): i for i, n in [(t.id, t.name) for t in _tag_cache()]}
    target_id = name_to_id.get(name.strip())
    n = 0
    for r in records:
        parts = [t.strip() for t in (r.tags or "").split(",")]
        for p in parts:
            if p == name:
                n += 1
            elif target_id is not None and p == str(target_id):
                n += 1
    return n


# Tag 表缓存（避免每次 _cnt_tag 都查数据库）
_tag_cache_value = None


def _tag_cache():
    """Tag 表缓存：全局单例，避免 N+1 查询。"""
    global _tag_cache_value
    if _tag_cache_value is None:
        from app.database import SessionLocal
        _db = SessionLocal()
        _tag_cache_value = _db.query(models.Tag).all()
        _db.close()
    return _tag_cache_value


def _resolve_tags_to_names(tag_items) -> str:
    """将 ["3"] / ["已加微信"] / ["3", "8"] 等格式转为逗号分隔的名称字符串。

    逻辑：
      - 数字字符串 → 查 Tag 表转名称
      - 已是名称 → 直接保留
    """
    tag_map = {t.id: t.name for t in _tag_cache()}
    out = []
    for t in tag_items:
        if t is None:
            continue
        s = str(t).strip()
        if not s:
            continue
        if s.isdigit() and int(s) in tag_map:
            out.append(tag_map[int(s)])
        else:
            out.append(s)
    return ",".join(out)


@router.get("/stats")
def get_stats(range: str = "today", db: Session = Depends(get_db), _=Depends(require_admin)):
    """统计报表：全局汇总 + 每位员工明细。

    参数：
      range: 时间范围 today / yesterday / week / month

    overview:
      - total_used: 期间所有使用记录条数
      - connected/unconnected/wechat_added: 含对应标签的记录数
      - pool_remaining: 当前号码池剩余数量（实时）
    details: 每位在职邀约员的统计明细
    """
    start = _range_start(range)
    end = _range_start("today") if range == "yesterday" else _now_bj()

    records = db.query(models.UsageRecord).filter(
        models.UsageRecord.used_at >= start,
        models.UsageRecord.used_at < end,
    ).all()

    overview = {
        "total_used": len(records),
        "connected": _cnt_tag("已接通", records),
        "unconnected": _cnt_tag("未接通", records),
        "wechat_added": _cnt_tag("已加微信", records),
        "pool_remaining": db.query(models.PhoneNumber).filter(models.PhoneNumber.status == "pool").count(),
    }

    agents = db.query(models.User).filter(
        models.User.role == "agent",
        models.User.is_active == True,
        models.User.deleted_at.is_(None)
    ).all()
    details = []
    for a in agents:
        a_recs = [r for r in records if r.user_id == a.id]
        details.append({
            "user_id": a.id,
            "real_name": a.real_name,
            "total_used": len(a_recs),
            "connected": _cnt_tag("已接通", a_recs),
            "unconnected": _cnt_tag("未接通", a_recs),
            "wechat_added": _cnt_tag("已加微信", a_recs),
        })

    return {"range": range, "overview": overview, "details": details}


# ==============================================================
# 管理员号码列表
# ==============================================================

# 状态语义映射：前端 Tab 值 → 数据库 status 列表
# 设计原因：
#   - 前端 Tab「可用」包含 pool 和 recycled（回收池号码重新可被分配）
#   - 前端 Tab「已分」包含 assigned/used/favorite（号码一旦分配给员工都属于「已分」）
#   - 这不是数据库状态机的 1:1 映射，需要语义聚合
STATUS_GROUPS = {
    "available": ["pool"],                                    # 可用：未分配
    "assigned":  ["assigned", "used", "favorite"],            # 已分：与「已分配」卡片一致（不含回收池）
    "recycled":  ["recycled"],                               # 已回收：与「已使用」卡片一致
}


@router.get("/numbers")
def list_all_numbers(
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    usage_filter: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """管理员视角：号码池全量列表（支持分页 + 多维筛选）。

    参数说明：
      - status:
          语义名（前端 Tab）→ available / assigned / recycled
          原始值（向后兼容）→ pool / assigned / used / favorite / recycled
      - usage_filter（SQL 层过滤，在分页前生效）:
          unused    → usage_count=0
          used_1/2/3 → usage_count=1/2/3
          used_4plus → usage_count>=4
      - keyword: 号码或归属地子串模糊匹配（SQL contains）
      - page/page_size: 分页参数

    响应额外返回：
      - total: 当前筛选条件下的总条数
      - status_counts: 各 status 的数量分布（facet 语义，前端 Tab 显示计数用）
    """
    q = db.query(models.PhoneNumber)

    # status 筛选：语义名展开或精确匹配
    if status:
        if status in STATUS_GROUPS:
            q = q.filter(models.PhoneNumber.status.in_(STATUS_GROUPS[status]))
        else:
            q = q.filter(models.PhoneNumber.status == status)

    # 关键字搜索：号码 OR 归属地（分页前生效）
    if keyword:
        kw = keyword.strip()
        q = q.filter(or_(
            models.PhoneNumber.number.contains(kw),
            models.PhoneNumber.region.contains(kw),
        ))

    # usage_filter SQL 层过滤（分页前生效）
    uc_col = func.coalesce(models.PhoneNumber.usage_count, 0)
    if usage_filter == "unused":
        q = q.filter(uc_col == 0)
    elif usage_filter == "used_1":
        q = q.filter(uc_col == 1)
    elif usage_filter == "used_2":
        q = q.filter(uc_col == 2)
    elif usage_filter == "used_3":
        q = q.filter(uc_col == 3)
    elif usage_filter == "used_4plus":
        q = q.filter(uc_col >= 4)

    # 按 updated_at 倒序（最近操作优先，如恢复号码）
    nums = q.order_by(
        models.PhoneNumber.updated_at.desc(),
        models.PhoneNumber.id.desc()
    ).offset((page - 1) * page_size).limit(page_size).all()

    total = q.count()

    # status 分组计数（facet，用于前端 Tab 计数）
    base_q = db.query(models.PhoneNumber.status, func.count(models.PhoneNumber.id))
    if status:
        if status in STATUS_GROUPS:
            base_q = base_q.filter(models.PhoneNumber.status.in_(STATUS_GROUPS[status]))
        else:
            base_q = base_q.filter(models.PhoneNumber.status == status)
    if usage_filter == "unused":
        base_q = base_q.filter(uc_col == 0)
    elif usage_filter == "used_1":
        base_q = base_q.filter(uc_col == 1)
    elif usage_filter == "used_2":
        base_q = base_q.filter(uc_col == 2)
    elif usage_filter == "used_3":
        base_q = base_q.filter(uc_col == 3)
    elif usage_filter == "used_4plus":
        base_q = base_q.filter(uc_col >= 4)
    if keyword:
        kw = keyword.strip()
        base_q = base_q.filter(or_(
            models.PhoneNumber.number.contains(kw),
            models.PhoneNumber.region.contains(kw),
        ))
    status_counts = {s: int(c) for s, c in base_q.group_by(models.PhoneNumber.status).all()}

    # 批量查询员工姓名（避免 N+1）
    result = []
    for n in nums:
        assigned_name = None
        if n.assigned_to:
            u = db.query(models.User).filter_by(id=n.assigned_to).first()
            if u:
                assigned_name = u.real_name
        status_map = {
            "pool": "待分配", "assigned": "已分配", "used": "已使用",
            "favorite": "收藏", "recycled": "已回收"
        }
        uc = n.usage_count or 0
        result.append({
            "id": n.id,
            "number": n.number,
            "number_plain": n.number,
            "number_masked": (n.number[:3] + "****" + n.number[7:]) if n.number and len(n.number) >= 11 else n.number,
            "carrier": n.carrier,
            "region": n.region,
            "status": n.status,
            "status_label": n.display_status or status_map.get(n.status, n.status),
            "assigned_to": n.assigned_to,
            "assigned_to_name": assigned_name,
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "used_at": n.used_at.isoformat() if n.used_at else None,
            "usage_count": uc,
        })
    return {"list": result, "total": total, "status_counts": status_counts}


# ==============================================================
# 号码回收池
# ==============================================================

# 回收池状态列表（仅 status='recycled' 进入回收池）
# 注意：新规则下 used/favorite 不再属于回收池，它们是号码留在员工名下的正常状态
REUSE_STATUSES = ["recycled"]


def _recycled_at():
    """号码"进入回收池的时间"表达式。

    优先级：updated_at（回收/恢复时刷新）> used_at（提交时记录）> created_at（导入时）
    用于按时间筛选回收池号码。
    """
    return func.coalesce(
        models.PhoneNumber.updated_at,
        models.PhoneNumber.used_at,
        models.PhoneNumber.created_at,
    )


def _recycle_owner():
    """号码"最后归属员工"表达式（用于 GROUP BY 员工统计）。

    说明：delete_usage / cancel_favorite 等操作会把 assigned_to 置 NULL，
    只留 recycled_by；若只用 assigned_to 聚合，这批号码会从"按员工筛选"中消失。
    故用 COALESCE 兜底。
    """
    return func.coalesce(models.PhoneNumber.assigned_to, models.PhoneNumber.recycled_by)


def _recycle_base_query(db: Session):
    """回收池基础查询：可重新分配的号码，排除软删除。"""
    return db.query(models.PhoneNumber).filter(
        models.PhoneNumber.status.in_(REUSE_STATUSES),
        models.PhoneNumber.deleted_at.is_(None),
    )


@router.get("/recycle/stats")
def get_recycle_stats(db: Session = Depends(get_db), _=Depends(require_admin)):
    """回收池统计：总可回收 / 今日 / 本周 / 本月（真实 SQL 聚合）。

    口径说明（新规则）：
      - 回收池 = status='recycled'（超窗淘汰 + 员工删除/取消收藏）
      - 不再包含 used/favorite（提交记录后号码留在号码池）
      - total 与 /recycle/numbers 列表保持一致
      - today/this_week/this_month 按"进回收池时间"（updated_at 为主）分档
    """
    PN = models.PhoneNumber
    rat = _recycled_at()

    day_start = _today_start_bj_naive()
    week_start = _week_start_bj_naive()
    month_start = _month_start_bj_naive()

    def _cnt(cutoff=None):
        q = _recycle_base_query(db)
        if cutoff is not None:
            q = q.filter(rat >= cutoff)
        return q.count()

    total = _cnt()
    today = _cnt(day_start)
    this_week = _cnt(week_start)
    this_month = _cnt(month_start)

    recycled_only = db.query(func.count(PN.id)).filter(
        PN.status == "recycled",
        PN.deleted_at.is_(None),
    ).scalar() or 0

    return {
        "total": total,
        "today": today,
        "this_week": this_week,
        "this_month": this_month,
        "week": this_week,          # 旧口径别名（兼容已上线前端）
        "month": this_month,        # 旧口径别名
        "recycled_only": int(recycled_only),
    }


def _recycle_cutoff(filter: str):
    """将时间筛选参数转为对应的回收时间下限（naive 北京时间）。"""
    return {
        "today": _today_start_bj_naive(),
        "week": _week_start_bj_naive(),
        "month": _month_start_bj_naive(),
    }.get(filter)


@router.get("/recycle/by-agent")
def get_recycle_by_agent(filter: str = "all", db: Session = Depends(get_db), _=Depends(require_admin)):
    """按员工统计回收池号码数量（单次 GROUP BY，与 /recycle/assignees 口径一致）。

    参数：
      filter: today / week / month / all（按"进回收池时间"筛选）
    """
    PN = models.PhoneNumber
    U = models.User
    cutoff = _recycle_cutoff(filter)
    owner = _recycle_owner()

    q = (
        db.query(owner.label("agent_id"), func.count(PN.id).label("cnt"))
        .filter(
            PN.status.in_(REUSE_STATUSES),
            PN.deleted_at.is_(None),
            owner.isnot(None),
        )
    )
    if cutoff is not None:
        q = q.filter(_recycled_at() >= cutoff)
    cnt_map = {r.agent_id: int(r.cnt or 0) for r in q.group_by(owner).all()}

    agents = db.query(U).filter(
        U.role == "agent",
        U.is_active == True,
        U.deleted_at.is_(None)
    ).all()
    result = [
        {
            "agent_id": a.id,
            "username": a.username,
            "real_name": a.real_name,
            "count": cnt_map.get(a.id, 0),
        }
        for a in agents
    ]
    result.sort(key=lambda x: x["count"], reverse=True)
    return result


@router.get("/recycle/numbers")
def get_recycle_numbers(
    filter: str = "all",
    agent_id: Optional[int] = None,
    assignee_id: Optional[int] = None,
    tags: Optional[str] = None,
    usage_bucket: Optional[str] = None,
    keyword: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """获取回收池号码列表（支持多维筛选 + 分页）。

    参数说明：
      - filter: today / week / month / all（按"进回收池时间"筛选）
      - agent_id / assignee_id: 按员工 ID 筛选（取 OR，兼容两个参数名）
      - tags: 逗号分隔标签，至少含其一即命中（OR，精确匹配拆分后的 tag）
      - usage_bucket: 0 / 1 / 2 / 3 / 4plus（按 usage_count 区间）
      - keyword: 号码子串模糊匹配
      - limit/offset: 分页，默认 limit=50

    非对称 facet 逻辑：
      - tag_facets：永远全量（不受任何筛选影响，facet 0）
      - usage_buckets：受 selectedTags + assignee_id + keyword + cutoff 影响，
        但不含 selectedBucket 自身（前端 bucket chip 显示"不含当前档位"的分布）
    """
    rat = _recycled_at()
    cutoff_map = {
        "today": _today_start_bj_naive(),
        "week": _week_start_bj_naive(),
        "month": _month_start_bj_naive(),
    }
    cutoff = cutoff_map.get(filter)

    q = _recycle_base_query(db)
    if cutoff is not None:
        q = q.filter(rat >= cutoff)

    # 兼容旧参数 agent_id 与新参数 assignee_id
    target_user_id = assignee_id or agent_id
    if target_user_id:
        q = q.filter(_recycle_owner() == target_user_id)

    if keyword:
        q = q.filter(models.PhoneNumber.number.contains(keyword))

    # tags OR 过滤：从 usage_records 聚合 tag 字段（精确匹配拆分后的 tag）
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        if tag_list:
            matched_ids = _number_ids_matching_tags(db, tag_list)
            q = q.filter(models.PhoneNumber.id.in_(matched_ids or [-1]))

    # 非对称 facet（见上方说明）
    q_full = _recycle_base_query(db)
    tag_facet_ids = [n.id for n in q_full.with_entities(models.PhoneNumber.id).all()]
    tag_facets = _split_tag_distinct_number_counter(db, tag_facet_ids)

    # usage_buckets：受 selectedTags + assignee_id + keyword + cutoff 影响，但不含 selectedBucket
    usage_buckets = _usage_buckets_from_query(q)

    # 实际列表 = q 应用 selectedBucket
    q = _apply_usage_bucket_filter(q, usage_bucket)
    total = q.count()
    numbers = q.order_by(rat.desc(), models.PhoneNumber.id.desc()).offset(offset).limit(limit).all()

    # 批量查员工姓名（避免 N+1）
    uids = {(n.assigned_to or n.recycled_by) for n in numbers}
    uids.discard(None)
    name_map = {}
    if uids:
        for uid, rname in db.query(models.User.id, models.User.real_name).filter(
            models.User.id.in_(uids)
        ).all():
            name_map[uid] = rname

    def _fmt(dt):
        return dt.strftime("%Y-%m-%d %H:%M") if dt else ""

    result = []
    for num in numbers:
        rec_at = num.updated_at or num.used_at or num.created_at
        owner_id = num.assigned_to or num.recycled_by
        result.append({
            "id": num.id,
            "number": num.number,
            "carrier": num.carrier or "unknown",
            "region": num.region or "unknown",
            "assigned_to_name": name_map.get(owner_id) or "unassigned",
            "assigned_to": owner_id,
            "deleted_at": _fmt(rec_at),
            "recycled_at": _fmt(rec_at),
            "used_at": _fmt(num.used_at),
            "status": num.status,
            "status_label": num.display_status or {
                "used": "已使用", "favorite": "收藏", "recycled": "已回收",
            }.get(num.status, "已回收"),
            "usage_count": num.usage_count or 0,
            "usage_bucket": _usage_bucket_key(num.usage_count),
        })
    return {
        "numbers": result,
        "list": result,              # 新口径别名（兼容）
        "total": total,
        "limit": limit,
        "offset": offset,
        "usage_buckets": usage_buckets,
        "tag_facets": tag_facets,
    }


@router.post("/recycle/restore/{num_id}")
def restore_number(num_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    """将回收池号码重置回号码池（可重新被分配）。

    操作：
      - status → pool
      - assigned_to / assigned_at / used_at / recycled_by → NULL
      - updated_at → 当前时间（用于排序）
      - display_status → "已回收"（前端可区分"原始待分配"和"恢复后再入池"）
    """
    num = db.query(models.PhoneNumber).filter(models.PhoneNumber.id == num_id).first()
    if not num:
        raise HTTPException(404, "号码不存在")
    if num.status not in REUSE_STATUSES:
        raise HTTPException(400, "该号码不在回收池中")
    num.status = "pool"
    num.assigned_to = None
    num.assigned_at = None
    num.used_at = None
    num.recycled_by = None
    num.updated_at = _now_bj()
    num.display_status = "已回收"
    db.commit()
    return {"ok": True, "message": "已恢复到号码池",
            "id": num.id, "status": "pool", "status_label": "已回收"}


@router.delete("/recycle/delete/{num_id}")
def delete_number_permanently(
    num_id: int, db: Session = Depends(get_db), _=Depends(require_admin)
):
    """永久删除回收池号码（物理删除，先删关联 usage_records 避免 FK 约束失败）。

    ⚠️ 此操作不可恢复，请确认号码确实不再需要。
    """
    num = db.query(models.PhoneNumber).filter(models.PhoneNumber.id == num_id).first()
    if not num:
        raise HTTPException(404, "号码不存在")
    # 先删关联 usage_records（外键约束）
    db.query(models.UsageRecord).filter(
        models.UsageRecord.number_id == num_id,
    ).delete(synchronize_session=False)
    db.delete(num)
    db.commit()
    return {"ok": True, "message": "已永久删除"}


@router.get("/recycle/export")
def export_recycle_xlsx(
    filter: str = "all",
    agent_id: Optional[int] = None,
    usage_bucket: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """导出回收池号码为 xlsx（流式下载）。

    参数：filter / agent_id / usage_bucket（与 get_recycle_numbers 一致）
    """
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook as XWorkbook

    cutoff = _recycle_cutoff(filter)
    rat = _recycled_at()

    q = _recycle_base_query(db)
    if cutoff is not None:
        q = q.filter(rat >= cutoff)
    if agent_id:
        q = q.filter(_recycle_owner() == agent_id)
    q = _apply_usage_bucket_filter(q, usage_bucket)
    numbers = q.order_by(rat.desc(), models.PhoneNumber.id.desc()).all()

    uids = {(n.assigned_to or n.recycled_by) for n in numbers}
    uids.discard(None)
    name_map = {}
    if uids:
        for uid, rname in db.query(models.User.id, models.User.real_name).filter(
            models.User.id.in_(uids)
        ).all():
            name_map[uid] = rname

    wb = XWorkbook()
    ws = wb.active
    ws.title = "Recycle"
    ws.append(["号码", "运营商", "归属地", "最后使用人", "使用次数", "回收时间"])
    for num in numbers:
        rec_at = num.updated_at or num.used_at or num.created_at
        ws.append([
            num.number,
            num.carrier or "",
            num.region or "",
            name_map.get(num.assigned_to or num.recycled_by) or "",
            num.usage_count or 0,
            rec_at.strftime("%Y-%m-%d %H:%M") if rec_at else "",
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="recycle.xlsx"'},
    )


@router.get("/batches/{bid}/numbers", response_model=List[schemas.NumberOut])
def get_batch_numbers(bid: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    """获取某批次的号码明细（最多返回 1000 条）。"""
    return db.query(models.PhoneNumber).filter(
        models.PhoneNumber.source_batch_id == bid
    ).order_by(models.PhoneNumber.id).limit(1000).all()


@router.post("/recycle/restore-batch")
def restore_batch(payload: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    """批量恢复号码到号码池。

    参数：{ids: [num_id1, num_id2, ...]}
    仅恢复 status='recycled' 的号码（已在池中则跳过）
    """
    ids = payload.get("ids", [])
    if not ids:
        return {"ok": True, "count": 0}
    n = db.query(models.PhoneNumber).filter(
        models.PhoneNumber.id.in_(ids),
        models.PhoneNumber.status.in_(REUSE_STATUSES),
    ).update({
        models.PhoneNumber.status: "pool",
        models.PhoneNumber.assigned_to: None,
        models.PhoneNumber.assigned_at: None,
        models.PhoneNumber.used_at: None,
        models.PhoneNumber.recycled_by: None,
        models.PhoneNumber.updated_at: _now_bj(),
        models.PhoneNumber.display_status: "已回收",
    }, synchronize_session=False)
    db.commit()
    return {"ok": True, "count": n, "status": "pool", "status_label": "已回收"}


@router.post("/recycle/delete-batch")
def delete_batch(payload: dict, db: Session = Depends(get_db), _=Depends(require_admin)):
    """批量永久删除回收池号码（同时清理关联 usage_records）。"""
    ids = payload.get("ids", [])
    if not ids:
        return {"ok": True, "count": 0}
    # 先删关联 usage_records（避免 FK 约束失败）
    db.query(models.UsageRecord).filter(
        models.UsageRecord.number_id.in_(ids),
    ).delete(synchronize_session=False)
    n = db.query(models.PhoneNumber).filter(
        models.PhoneNumber.id.in_(ids),
        models.PhoneNumber.status.in_(REUSE_STATUSES),
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "count": n}


@router.get("/recycle/assignees")
def get_recycle_assignees(db: Session = Depends(get_db), _=Depends(require_admin)):
    """返回回收池中所有去重员工列表（含号码数量）。

    单次 SQL：phone_numbers LEFT JOIN users GROUP BY assigned_to
    口径与 /recycle/numbers 保持一致（REUSE_STATUSES + 未软删除），
    保证下拉选一个员工后列表 total == 这里返回的 count。
    """
    PN = models.PhoneNumber
    U = models.User
    owner = _recycle_owner()
    rows = (
        db.query(
            owner.label("user_id"),
            U.real_name.label("real_name"),
            U.username.label("username"),
            func.count(PN.id).label("cnt"),
        )
        .outerjoin(U, U.id == owner)
        .filter(
            PN.status.in_(REUSE_STATUSES),
            PN.deleted_at.is_(None),
            owner.isnot(None),
        )
        .group_by(owner, U.real_name, U.username)
        .order_by(func.count(PN.id).desc())
        .all()
    )
    return [
        {
            "user_id": r.user_id,
            "real_name": r.real_name or r.username or "未知",
            "username": r.username or "",
            "count": int(r.cnt or 0),
        }
        for r in rows
    ]


# ==============================================================
# 标签拆分聚合（usage_records.tags 是逗号分隔 VARCHAR）
# ==============================================================

def _tag_string_counts(db: Session):
    """一次 GROUP BY tags 拿到所有不同 tag 字符串及其记录数。"""
    return (
        db.query(
            models.UsageRecord.tags,
            func.count(models.UsageRecord.id).label("cnt"),
        )
        .filter(models.UsageRecord.deleted_at.is_(None))
        .group_by(models.UsageRecord.tags)
        .all()
    )


def _split_tag_counter(db: Session) -> dict:
    """把逗号分隔的 tags 字符串拆开，统计每个 tag 名出现的记录数。

    同一条记录写了同一 tag 多次只算 1 次（用 set 去重）。
    修正了旧实现用 LIKE '%name%' 子串匹配导致的跨标签误计。
    """
    counter = {}
    for tags_str, cnt in _tag_string_counts(db):
        names = {t.strip() for t in (tags_str or "").split(",") if t and t.strip()}
        for name in names:
            counter[name] = counter.get(name, 0) + int(cnt or 0)
    return counter


def _split_tag_distinct_number_counter(db: Session, scope_ids: Optional[List[int]] = None) -> dict:
    """按 tag 名统计有多少不同的 number_id（去重口径）。

    scope_ids：限制只统计这些 number_id（如当前筛选条件下的号码集合），
    传 None 则统计全量。
    返回：{tag_name: 包含该 tag 的不同号码数量}
    """
    counter = {}
    q = db.query(
        models.UsageRecord.number_id,
        models.UsageRecord.tags,
    ).filter(models.UsageRecord.deleted_at.is_(None))
    if scope_ids is not None:
        if not scope_ids:
            return {}
        q = q.filter(models.UsageRecord.number_id.in_(scope_ids))
    rows = q.all()
    for number_id, tags_str in rows:
        names = {t.strip() for t in (tags_str or "").split(",") if t and t.strip()}
        for name in names:
            counter.setdefault(name, set()).add(number_id)
    return {k: len(v) for k, v in counter.items()}


def _number_ids_matching_tags(db: Session, tag_list: List[str]) -> List[int]:
    """返回 usage_records 中含任一指定 tag（精确匹配拆分后）的 number_id 列表。

    前端传来的 tag_list 是 Tag.id（以字符串形式）的列表，例如 ['7', '3']。
    UsageRecord.tags 列存的是 tag 名（逗号分隔，如 '已接通,已加微信'），不是 id。
    因此需先在 tags 表里把 id 映射到 name，再用 name 精确拆分匹配。

    优化：先用 LIKE 粗筛（走得动 SQL），再在 Python 做精确拆分校验。
    """
    # 解析传入的字符串，只保留可解析为 int 的作为 tag_id
    wanted_ids = set()
    for t in tag_list:
        s = (t or "").strip()
        if s.isdigit():
            wanted_ids.add(int(s))
    if not wanted_ids:
        return []

    # 一次性查 tags 表：id → name 映射
    rows = db.query(models.Tag.id, models.Tag.name).filter(models.Tag.id.in_(wanted_ids)).all()
    wanted_names = {name for _, name in rows}
    if not wanted_names:
        return []

    # LIKE 粗筛 + Python 精确拆分
    rough = db.query(models.UsageRecord.number_id, models.UsageRecord.tags).filter(
        models.UsageRecord.deleted_at.is_(None),
        or_(*[models.UsageRecord.tags.contains(n) for n in wanted_names]),
    ).all()
    out = set()
    for number_id, tags_str in rough:
        names = {t.strip() for t in (tags_str or "").split(",") if t and t.strip()}
        if names & wanted_names:
            out.add(number_id)
    return list(out)


@router.get("/tags/usage-frequency")
def get_tags_usage_frequency(
    mode: Optional[str] = "records",
    tags: Optional[str] = None,
    usage_bucket: Optional[str] = None,
    assignee_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """返回所有标签按使用频次降序排列。

    口径：先把 usage_records.tags（逗号分隔）**拆分**，再按 tag 名精确计数，
    不是 group by 整个 tags 字符串，也不是 LIKE 子串匹配。

    参数说明：
      - mode:
          records（默认）：统计包含该 tag 的"使用记录数"（同一号码多次使用可重复计数）
          numbers：统计包含该 tag 的"不同号码数"（每个号码最多计 1）
      - tags / usage_bucket / assignee_id：
          仅 numbers 模式生效，三者共同限定 scope（facet C 语义）
          三者都传 → tag chip scope = 号码列表 scope（严格 facet C）
          都不传   → 全量统计（原有行为）
    """
    scope_ids: Optional[List[int]] = None
    if mode == "numbers":
        # 构造与 numbers 接口完全一致的 scope
        # 无 facet 参数时默认用回收池 scope，与 tag_facets 口径一致
        sq = _recycle_base_query(db)
        if assignee_id:
            sq = sq.filter(_recycle_owner() == assignee_id)
        if tags:
            tag_list = [t.strip() for t in tags.split(",") if t.strip()]
            if tag_list:
                matched = _number_ids_matching_tags(db, tag_list)
                sq = sq.filter(models.PhoneNumber.id.in_(matched or [-1]))
        sq = _apply_usage_bucket_filter(sq, usage_bucket)
        scope_ids = [n.id for n in sq.with_entities(models.PhoneNumber.id).all()]

    if mode == "numbers":
        counter = _split_tag_distinct_number_counter(db, scope_ids)
    else:
        counter = _split_tag_counter(db)

    tags = db.query(models.Tag).order_by(models.Tag.id).all()
    result = [
        {
            "tag_id": t.id,
            "name": t.name,
            "color": t.color,
            "is_builtin": bool(t.is_builtin),
            "usage_count": int(counter.get(t.name, 0)),
        }
        for t in tags
    ]
    result.sort(key=lambda x: (-x["usage_count"], x["tag_id"]))
    return result
