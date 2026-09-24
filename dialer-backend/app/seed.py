"""初始化：建表 + 内置标签 + 默认管理员。

应用启动时（main.py startup 事件）调用 init()，确保：
  1. 数据库表结构存在（自动 CREATE TABLE IF NOT EXISTS）
  2. 内置标签已创建（若不存在则创建，已存在跳过）
  3. 默认管理员账号存在（若不存在则创建，已存在跳过）

幂等性：所有操作均为"存在则跳过，不存在才创建"，重复调用安全无副作用。
"""
from .database import Base, engine, SessionLocal
from . import models
from .auth import hash_pw


# ----------------------------------------------------------------
# 内置标签常量
# 与小程序端 BUILTIN_TAGS 保持名称一致，避免标签名称不匹配导致统计失效
# ----------------------------------------------------------------
BUILTIN_TAGS = [
    ("已接通",   "#67C23A"),   # 绿色 - 成功接通
    ("未接通",   "#F56C6C"),   # 红色 - 接通失败
    ("已加微信", "#5B8FF9"),   # 蓝色 - 添加微信
    ("已约见",   "#E6A23C"),   # 橙色 - 约见成功
    ("已成交",   "#9B59B6"),   # 紫色 - 成交转化
    ("暂时搁置", "#909399"),   # 灰色 - 暂时搁置
]


def init():
    """建表 + 幂等种子数据：默认管理员、全局规则、内置标签。

    执行步骤（均为幂等）：
      Step 1: Base.metadata.create_all()
              → 自动建表（已存在则跳过），包括 users / global_rule / user_rule /
                phone_numbers / import_batches / usage_records / tags
      Step 2: 创建默认管理员 admin / admin123（若不存在）
      Step 3: 创建全局规则行（id=1，若不存在，使用默认值）
      Step 4: 创建内置标签（按名称幂等，名称冲突则跳过）

    异常处理：使用 try/finally 确保 db.close() 执行，session 不会泄漏。
    """
    # Step 1: 建表（SQLAlchemy 自动跳过已存在的表）
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Step 2: 默认管理员账号（仅当用户名 "admin" 不存在时创建）
        # ⚠️ 生产环境应强制要求修改初始密码
        if not db.query(models.User).filter(models.User.username == "admin").first():
            db.add(models.User(
                username="admin",
                password_hash=hash_pw("admin123"),
                real_name="系统管理员",
                role="admin",
            ))

        # Step 3: 全局规则行（仅当表为空时创建，默认值由模型定义）
        # id=1 固定，若已存在则跳过
        if not db.query(models.GlobalRule).first():
            db.add(models.GlobalRule(id=1))

        # Step 4: 内置标签（按名称幂等，名称重复则跳过）
        for name, color in BUILTIN_TAGS:
            if not db.query(models.Tag).filter(models.Tag.name == name).first():
                db.add(models.Tag(name=name, color=color, is_builtin=True))

        db.commit()
        print("[OK] 数据库初始化完成")
        print("   默认管理员账号: admin / admin123")
        print("   内置标签: 已接通 / 未接通 / 已加微信 / 已约见 / 已成交 / 暂时搁置")
    finally:
        db.close()


if __name__ == "__main__":
    init()
