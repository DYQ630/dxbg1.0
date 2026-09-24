"""ORM 模型（SQLAlchemy）。

定义数据库表结构，与 schemas.py（Pydantic 数据模型）共同构成前后端数据交互的基础。
所有模型继承 Base，由 database.py 的 engine 在 startup 时通过 seed.py 自动建表。

业务规则说明：
- 软删除：所有含 deleted_at 字段的表均支持软删除（deleted_at=None 为正常，否则已删除）。
- 号码状态机：pool → assigned → used/favorite → recycled，详见 PhoneNumber.status。
- usage_count：为不同邀约员分配该号码的总次数（distinct 计数），用于识别"热号"。
- 规则覆盖：UserRule 字段若为 None 则继承 GlobalRule，否则以个人规则为准。
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, DateTime, Boolean, ForeignKey, Float, Text, Index
)
from sqlalchemy.orm import relationship
from .database import Base


class User(Base):
    """用户表：管理员（admin）和邀约员（agent）共用一张表。"""
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)                          # 主键自增
    username = Column(String(64), unique=True, index=True, nullable=False)      # 登录账号，唯一
    password_hash = Column(String(256), nullable=False)                        # bcrypt 哈希后的密码（不存明文）
    real_name = Column(String(64), nullable=False)                              # 真实姓名，用于显示
    role = Column(String(16), nullable=False)                                   # 角色：admin=管理员，agent=邀约员
    phone = Column(String(20), default="")                                      # 手机号（个人联系方式，非必填）
    avatar = Column(String(255), default="")                                    # 头像 URL 地址
    is_active = Column(Boolean, default=True)                                   # 是否在职；False=已停职，无法登录和分配号码
    deleted_at = Column(DateTime, nullable=True)                               # 软删除时间；None=正常，datetime=已删除
    created_at = Column(DateTime, default=datetime.utcnow)                      # 账号创建时间

    # 与个人规则表 一对一关联（uselist=False）
    rules = relationship("UserRule", back_populates="user", uselist=False)
    # 与号码表 一对多关联（只看该员工当前分到的号码）
    phone_numbers = relationship(
        "PhoneNumber",
        foreign_keys="PhoneNumber.assigned_to",
        back_populates="assigned_user",
    )


class GlobalRule(Base):
    """全局规则：整表仅存一条记录（id=1 固定），作为所有邀约员的默认规则上限。
    个人规则（UserRule）通过将字段设为非 None 来覆盖本表的默认值。
    """
    __tablename__ = "global_rule"
    id = Column(Integer, primary_key=True)                                 # 固定为 1，不可改变
    daily_limit = Column(Integer, default=50)                              # 每位邀约员每天最多分配的新号码数量
    history_count = Column(Integer, default=5)                            # 滑动窗口：每位邀约员最多保留的历史记录条数（超出则回收最旧号码）
    favorite_limit = Column(Integer, default=5)                            # 每位邀约员最多同时收藏的号码数量
    recycle_days = Column(Integer, default=7)                             # 分配后超过 N 天未提交记录则自动回收（自动分配时触发）


class UserRule(Base):
    """个人规则：每个字段若为 None 则继承 GlobalRule，否则以本表为准（覆盖全局）。"""
    __tablename__ = "user_rule"
    id = Column(Integer, primary_key=True)                                 # 主键
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)         # 关联用户，OneToOne
    daily_limit = Column(Integer, nullable=True)                            # None=继承全局；非 None=个人每日上限
    history_count = Column(Integer, nullable=True)                          # None=继承全局；非 None=个人滑动窗口上限
    favorite_limit = Column(Integer, nullable=True)                       # None=继承全局；非 None=个人收藏上限
    recycle_days = Column(Integer, nullable=True)                           # None=继承全局；非 None=个人回收天数

    user = relationship("User", back_populates="rules")                  # 反向关联到 User


class PhoneNumber(Base):
    """号码池：存放所有导入的手机号码及其当前生命周期状态。

    状态机（严格单向，除非管理员恢复）：
      pool → assigned → used / favorite → recycled
      pool → assigned → (超 recycle_days 未提交) → pool（自动回收，不写记录）
      used/fav → (管理员恢复) → pool（号码可重新被分配）

    关键字段说明：
      - usage_count：被多少个不同邀约员领取过（distinct user_id 计数），每次新组合首次出现时 +1。
        用于识别"热号"（多人用过的号码质量可能下降）。
      - display_status：前端 Tab 显示用的语义化文案，None 时回退 status 字段。
        主要区分两种 pool："待分配"（原始导入）和"已回收"（管理员恢复后再次进入池）。
    """
    __tablename__ = "phone_numbers"
    id = Column(Integer, primary_key=True, index=True)                                                     # 主键
    number = Column(String(20), unique=True, index=True, nullable=False)                                    # 手机号，唯一索引
    carrier = Column(String(16), default="")                                                                # 运营商：移动/联通/电信
    region = Column(String(64), default="")                                                                 # 归属地（省/市）
    status = Column(String(16), default="pool", index=True)                                                 # 状态：pool=池中待分配，assigned=已分配，used=已使用，favorite=收藏，recycled=回收池
    usage_count = Column(Integer, default=0)                                                                 # 被多少个不同员工领取过（distinct 计数，越高说明越多人用过）
    assigned_to = Column(Integer, ForeignKey("users.id", use_alter=True), nullable=True)                  # 当前分配给的员工 ID（仅 status=assigned 时有效）
    assigned_at = Column(DateTime, nullable=True)                                                           # 分配时间（用于计算是否超 recycle_days）
    used_at = Column(DateTime, nullable=True, index=True)                                                   # 首次提交使用记录的时间
    source_batch_id = Column(Integer, ForeignKey("import_batches.id"), nullable=True)                     # 来源导入批次 ID
    created_at = Column(DateTime, default=datetime.utcnow)                                                   # 首次导入时间
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)                       # 最后修改时间（回收/恢复时会刷新，用于排序）
    recycled_by = Column(Integer, ForeignKey("users.id", use_alter=True), nullable=True)                    # 将号码送入回收池的员工 ID（用于按员工统计回收数量）
    deleted_at = Column(DateTime, nullable=True)                                                            # 软删除时间；None=正常，datetime=已从数据库物理删除
    display_status = Column(String(20), nullable=True)                                                       # 前端显示语义：None=按 status 回退；"待分配"=原始导入；"已回收"=恢复后重新入池

    # 高频过滤字段索引（assigned_to / status+used_at 是列表页常用条件）
    __table_args__ = (
        Index("ix_phone_numbers_assigned_to", "assigned_to"),                              # 按员工查当前持有号码
        Index("ix_phone_numbers_status_used_at", "status", "used_at"),                   # 状态+时间联合索引
    )

    # relationships
    assigned_user = relationship(
        "User", foreign_keys=[assigned_to], back_populates="phone_numbers", post_update=True
    )                                                                                      # assigned_to 指向的用户
    usage_records = relationship("UsageRecord", back_populates="number")                  # 该号码的所有使用记录（一对多）
    batch = relationship("ImportBatch", back_populates="phone_numbers")                   # 来源批次


class ImportBatch(Base):
    """导入批次：记录每次 Excel 导入的时间、文件名和成功/失败数量。
    仅保留最近 10 条（由 admin_router.import_numbers 在提交后自动清理旧批次）。
    """
    __tablename__ = "import_batches"
    id = Column(Integer, primary_key=True, index=True)              # 主键
    filename = Column(String(255), nullable=False)                   # 原始 Excel 文件名
    total = Column(Integer, default=0)                               # 本次导入总行数（含无效行）
    success = Column(Integer, default=0)                            # 成功入库的号码数量
    failed = Column(Integer, default=0)                              # 跳过/失败的行数（重复/格式错误）
    created_by = Column(Integer, ForeignKey("users.id"))           # 执行导入的管理员 ID
    created_at = Column(DateTime, default=datetime.utcnow)           # 导入时间

    phone_numbers = relationship("PhoneNumber", back_populates="batch")  # 该批次导入的所有号码


class UsageRecord(Base):
    """号码使用记录：邀约员每次对分配的号码提交使用结果时生成一条记录。

    tags 字段存储说明：
      - 老数据：存储 Tag 表数字 ID（字符串，如 "3"）
      - 新数据：后端已统一转为 Tag 名称（如 "已加微信"）
      - 均为逗号分隔，如 "已接通,已加微信" 或 "3,8"
      - 统计时需同时识别两种格式（_cnt_tag / _resolve_tags_to_names 做了兼容）。
    """
    __tablename__ = "usage_records"
    id = Column(Integer, primary_key=True, index=True)                                 # 主键
    number_id = Column(Integer, ForeignKey("phone_numbers.id"), nullable=False)     # 对应号码 ID
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)               # 提交记录的邀约员 ID
    tags = Column(String(255), default="")                                           # 标签列表，逗号分隔（新版存名称如"已接通"，旧版存 id 如"3"）
    note = Column(Text, default="")                                                   # 备注文本
    is_favorite = Column(Boolean, default=False)                                       # 是否收藏（由 favorite_limit 独立管控，不受历史窗口影响）
    is_completed = Column(Boolean, default=False)                                    # 是否已完成跟进（submit_usage 时置 True）
    used_at = Column(DateTime, default=datetime.utcnow)                               # 首次提交时间（用于滑动窗口和时间范围统计）
    completed_at = Column(DateTime, nullable=True)                                    # 标记完成的时间
    deleted_at = Column(DateTime, nullable=True)                                      # 软删除时间；None=正常

    number = relationship("PhoneNumber", back_populates="usage_records")             # 对应号码
    user = relationship("User")                                                       # 提交人


class Tag(Base):
    """标签库：邀约员提交使用记录时可选的标签集合。

    内置标签（is_builtin=True）由 seed.py 初始化创建，名称固定，不可删除。
    自定义标签可由管理员增删，颜色可自定义。
    """
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)                     # 主键
    name = Column(String(32), unique=True, nullable=False)                  # 标签名称，唯一（如"已接通"）
    color = Column(String(16), default="#5B8FF9")                         # 前端展示颜色（Hex 色值）
    is_builtin = Column(Boolean, default=False)                             # 是否系统内置；True=不可删除，由 seed.py 保证存在
