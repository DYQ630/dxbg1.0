"""登录 / 注销。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import get_current_user
from .. import models, auth, schemas

router = APIRouter(prefix="/api/auth", tags=["登录"])


@router.post("/login", response_model=schemas.TokenOut)
def login(data: schemas.LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == data.username).first()
    if not user or not auth.verify_pw(data.password, user.password_hash):
        raise HTTPException(401, "账号或密码错误")
    if not user.is_active:
        raise HTTPException(403, "账号已停职，请联系管理员")
    return {
        "access_token": auth.make_token(user.id, user.role),
        "role": user.role,
        "real_name": user.real_name,
        "user_id": user.id,
    }


@router.get("/me")
def me(user: models.User = Depends(get_current_user)):
    """验证 token 有效性，返回当前用户信息。"""
    return {
        "user_id": user.id,
        "username": user.username,
        "real_name": user.real_name,
        "role": user.role,
        "is_active": user.is_active,
        "phone": user.phone or "",
        "avatar": getattr(user, 'avatar', '') or "",
    }
