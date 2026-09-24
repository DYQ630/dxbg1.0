"""FastAPI 依赖注入：当前登录用户解析。

提供路由级依赖注入，从请求头解析 Bearer Token 并还原当前登录用户，
供需要鉴权的接口复用；require_admin 在此基础上二次校验管理员权限。

⚠️ 注意：deleted_at=非 None（软删除）的用户视为无效，即使 is_active=True 也无法登录
"""
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from .database import get_db
from . import models, auth


def get_current_user(
    authorization: str = Header(...),
    db: Session = Depends(get_db),
) -> models.User:
    """从 Authorization 头解析 Bearer Token，返回当前登录用户。

    HTTP 401 触发条件（未认证）：
        1. 请求头无 Authorization 字段（Header(...) 缺失）
        2. Authorization 不以 "Bearer " 开头
        3. JWT 签名校验失败（SECRET 不匹配或算法错误）
        4. JWT 已过期（exp 时间早于当前）
        5. 令牌中 sub 对应的用户不存在（数据库中已删）
        6. 用户存在但 is_active=False（已停职）

    正常返回：models.User 对象（包含完整用户信息）
    """
    # 1. 检查是否携带 Authorization 头
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "未登录")

    # 2. 解析 JWT（失败返回 None）
    payload = auth.decode_token(authorization[7:])
    if not payload:
        raise HTTPException(401, "token 无效")

    # 3. 查询用户（deleted_at=非 None 或 is_active=False 均视为无效）
    user = db.query(models.User).filter(models.User.id == payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(401, "用户不存在或已停职")

    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    """在 get_current_user 基础上要求管理员角色，否则返回 403。

    HTTP 403 触发条件：
        用户已登录（通过 get_current_user），但 user.role != "admin"

    正常返回：models.User 对象（role="admin"）
    """
    if user.role != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user
