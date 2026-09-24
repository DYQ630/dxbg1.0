"""密码哈希 + JWT 认证。

提供两类核心能力：
1. 密码安全：使用 passlib + bcrypt 对密码做不可逆哈希存储与校验；
2. 会话令牌：签发 / 解析 JWT（HS256），载荷含用户 id 与角色，有效期 7 天。

⚠️ 上云改造已完成（2026-09-04）：
  - SECRET  → 已改为优先从环境变量 SECRET_KEY 读取，未设置时回退开发默认密钥（见下方 SECRET 定义）
  - 建议同时切换 ALGO 为 HS256/HS512 或迁移至 RS256（后续可优化，非上线阻塞项）
"""
import os  # ⚠️ 上云改造：用于从环境变量读取生产密钥 SECRET_KEY
from passlib.context import CryptContext
from jose import jwt, JWTError
from datetime import datetime, timedelta

# bcrypt 密码哈希上下文
# deprecated="auto"：自动处理算法降级（bcrypt 新旧版本兼容）
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ⚠️ 上云改造：优先从环境变量 SECRET_KEY 读取随机密钥；未设置时回退到开发默认密钥（仅本地调试用，生产必须设置）。
# 生成随机密钥命令：python -c "import secrets; print(secrets.token_hex(32))"
SECRET = os.environ.get("SECRET_KEY", "dialer-secret-key-change-me-in-prod")

# JWT 签名算法：HS256（对称算法，SECRET 须保密）
# ⚠️ 上云前建议评估是否迁移至非对称算法（如 RS256）
ALGO = "HS256"


def hash_pw(p: str) -> str:
    """对明文密码做 bcrypt 哈希，返回可入库的哈希串（不可逆）。"""
    return pwd_ctx.hash(p)


def verify_pw(p: str, h: str) -> bool:
    """校验明文密码是否与哈希匹配。成功返回 True，失败返回 False。"""
    return pwd_ctx.verify(p, h)


def make_token(user_id: int, role: str) -> str:
    """签发 JWT Token。

    参数：
        user_id: 用户 ID
        role: 角色字符串，"admin" 或 "agent"

    返回：
        JWT 字符串，载荷包含 sub（用户ID）、role、exp（7天后过期）

    注意：JWT payload 中 sub 必须为字符串，decode 时会转回 int
    """
    payload = {
        "sub": str(user_id),   # JWT spec 要求 sub 为字符串
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=7),  # 7 天有效期
    }
    return jwt.encode(payload, SECRET, algorithm=ALGO)


def decode_token(token: str):
    """解析 JWT Token。

    参数：
        token: JWT 字符串（不含 "Bearer " 前缀）

    返回：
        成功：{"sub": int, "role": str, "exp": datetime}
        失败（过期/签名错误/格式错误）：None
    """
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGO])
        payload["sub"] = int(payload["sub"])   # 转回 int，供调用方使用
        return payload
    except JWTError:
        return None
