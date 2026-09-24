"""数据库连接与初始化。

SQLite 本地文件存储，零配置，适合轻量级场景。
路径：与本文件同目录下的 dialer.db（如需迁移可改 DB_PATH）。

⚠️ 多线程注意：
  - check_same_thread=False 允许多线程共享同一连接（SQLite 默认不允许）
  - 生产环境若需高并发，建议迁移至 PostgreSQL/MySQL，DB_PATH 改为连接字符串
"""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
import os

# ⚠️ 上云改造：支持通过环境变量 DB_PATH 指定数据库位置（便于服务器统一备份、隔离代码与数据）。
# 未设置时回退到与本文件同目录的 dialer.db（兼容本地开发）。
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "dialer.db"))

# SQLAlchemy 连接字符串（SQLite 格式）
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

# 创建引擎
# check_same_thread=False: 允许 FastAPI 在不同线程中共享连接
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)


# 每次新建连接时自动开启外键约束
# ⚠️ 必须开启！SQLite 默认关闭外键约束，不开则 FK 字段形同虚设
@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


# SessionLocal：每次请求实例化一个 session，用完即关（见 get_db）
# autocommit=False：需手动 db.commit() 才写盘
# autoflush=False：需手动 db.flush() 或 db.commit() 才刷新待写对象
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# declarative_base：所有 ORM 模型的基类，提供 __tablename__ 和 Column 等定义
Base = declarative_base()


def get_db():
    """FastAPI 依赖注入：每次请求创建一个数据库 session。

    用法示例（路由函数参数）：
        def my_route(db: Session = Depends(get_db), user: User = Depends(get_current_user)):

    执行流程：
        1. 创建 SessionLocal()
        2. yield session（请求处理期间使用）
        3. 请求结束后 finally 关闭 session（无论成功或异常）
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
