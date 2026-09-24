"""Pydantic schemas（请求/响应模型）。

集中定义前后端交互的数据结构：
  - 请求体（In）用于参数校验和反序列化；
  - 响应模型（Out）用于序列化输出；
  - from_attributes = True 使 ORM 对象可直接转换为响应模型。

命名规范：
  - In 结尾：客户端 → 服务端的请求体；
  - Out 结尾：服务端 → 客户端的响应体；
  - 无后缀：双向均可（如 GlobalRuleIn 既可接收请求，也可输出）。
"""
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ==============================================================
# 登录 / Token
# ==============================================================

class LoginIn(BaseModel):
    """登录请求体：账号 + 密码。
    - username: 登录账号（users.username）
    - password: 明文密码，后端用 bcrypt 校验
    """
    username: str
    password: str


class TokenOut(BaseModel):
    """登录成功响应：JWT Token + 用户基本信息。
    - access_token: JWT 令牌，客户端存入 Authorization: Bearer <token>
    - role: 用户角色，admin=管理员，agent=邀约员
    - real_name: 姓名，前端展示用
    - user_id: 用户 ID，用于前端路由鉴权
    """
    access_token: str
    role: str
    real_name: str
    user_id: int


# ==============================================================
# 用户
# ==============================================================

class UserCreate(BaseModel):
    """新建用户请求体（管理员创建员工账号）。
    - username: 登录账号，唯一
    - password: 初始密码（明文，后端自动哈希存储）
    - real_name: 真实姓名
    - phone: 手机号，可选
    - role: 角色，默认为 agent（邀约员），可设为 admin（管理员）
    """
    username: str
    password: str
    real_name: str
    phone: Optional[str] = ""
    role: str = "agent"   # 默认角色为邀约员


class UserOut(BaseModel):
    """用户信息响应（含个人规则字段，可覆盖全局规则）。
    - daily_limit / history_count / favorite_limit / recycle_days:
        若有个人规则（UserRule）则返回具体值；无个人规则则返回 None（前端应读全局规则）。
    - is_active: False 表示已停职，账号无法登录和分配号码
    """
    id: int
    username: str
    real_name: str
    role: str
    phone: Optional[str]
    is_active: bool
    daily_limit: Optional[int] = None      # None=使用全局规则
    history_count: Optional[int] = None    # None=使用全局规则
    favorite_limit: Optional[int] = None    # None=使用全局规则
    recycle_days: Optional[int] = None     # None=使用全局规则

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    """更新用户请求体（所有字段可选，按需提交）。
    - password: 非空时触发哈希更新
    - is_active: True=在职，False=停职（停职后该员工无法登录和获取号码）
    """
    real_name: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


# ==============================================================
# 规则
# ==============================================================

class GlobalRuleOut(BaseModel):
    """全局规则响应（所有邀约员的默认值）。
    - daily_limit: 每位邀约员每天最多分配的新号码数量
    - history_count: 滑动窗口上限（超出回收最旧号码）
    - favorite_limit: 收藏上限
    - recycle_days: 分配后超 N 天未提交则自动回收
    """
    daily_limit: int
    history_count: int
    favorite_limit: int
    recycle_days: int

    class Config:
        from_attributes = True


class GlobalRuleIn(BaseModel):
    """更新全局规则请求体（一次性提交四个字段）。"""
    daily_limit: int
    history_count: int
    favorite_limit: int
    recycle_days: int


class UserRuleIn(BaseModel):
    """设置个人规则请求体。
    - 每个字段为 None 表示删除覆盖（继承全局）；
    - 非 None 则覆盖全局对应字段。
    """
    daily_limit: Optional[int] = None
    history_count: Optional[int] = None
    favorite_limit: Optional[int] = None
    recycle_days: Optional[int] = None


class UserRuleOut(BaseModel):
    """个人规则响应（含 is_custom 标识）。
    - is_custom: True=本规则为个人自定义，False=无个人规则（使用全局）
    - 若 is_custom=False，四项字段值即为当前生效的全局值
    """
    user_id: int
    daily_limit: int
    history_count: int
    favorite_limit: int
    recycle_days: int
    is_custom: bool

    class Config:
        from_attributes = True


# ==============================================================
# 号码
# ==============================================================

class NumberOut(BaseModel):
    """号码输出：明文与打码分开返回，由前端按需展示。
    - number: 仅用于兼容旧端，实际用 number_plain 或 number_masked
    - number_plain: 明文号码（内部页面展示）
    - number_masked: 脱敏号码（138****8888，对外展示）
    """
    id: int
    number: str
    number_plain: Optional[str] = None
    number_masked: Optional[str] = None
    carrier: str           # 运营商：移动/联通/电信
    region: str            # 归属地
    status: str            # 状态：pool/assigned/used/favorite/recycled

    class Config:
        from_attributes = True


# ==============================================================
# 使用记录
# ==============================================================

class UsageIn(BaseModel):
    """提交号码使用记录请求体。
    - number_id: 号码 ID（必须在 assigned 状态且分配给当前用户）
    - tags: 标签 ID 或名称列表，如 [1, 3] 或 ["已接通", "已加微信"]
    - note: 备注文本
    - is_favorite: True=收藏，False=普通使用（受 favorite_limit 限制）
    """
    number_id: int
    tags: List[str] = []      # 可选标签，默认为空列表
    note: str = ""
    is_favorite: bool = False


class UsageUpdate(BaseModel):
    """更新使用记录请求体（全部可选，按需提交）。
    - 修改 is_favorite 会同步更新号码状态（favorite ↔ used）
    """
    tags: Optional[List[str]] = None
    note: Optional[str] = None
    is_favorite: Optional[bool] = None


class UsageOut(BaseModel):
    """使用记录输出（含号码详情与标签）。
    - tags: 解析后的标签名称列表，如 ["已接通", "已加微信"]
    - completed_at: None 表示未完成（仅收藏未提交）
    """
    id: int
    number: NumberOut              # 号码详情
    tags: List[str]               # 标签名称列表
    note: str
    is_favorite: bool
    is_completed: bool
    used_at: datetime
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ==============================================================
# 标签
# ==============================================================

class TagIn(BaseModel):
    """新建/更新标签请求体。
    - name: 标签名称，唯一
    - color: Hex 颜色值，如 "#5B8FF9"，默认蓝色
    """
    name: str
    color: str = "#5B8FF9"


class TagOut(BaseModel):
    """标签输出（is_builtin 标识系统内置标签）。
    - is_builtin=True 时不可删除，由 seed.py 保证存在
    """
    id: int
    name: str
    color: str
    is_builtin: bool

    class Config:
        from_attributes = True


# ==============================================================
# 导入批次
# ==============================================================

class ImportBatchOut(BaseModel):
    """Excel 导入批次输出。
    - total: 本次导入总行数（含无效格式行）
    - success: 成功入库的号码数
    - failed: 跳过的行数（重复或格式错误）
    """
    id: int
    filename: str
    total: int     # 总条数（含无效行）
    success: int   # 成功入库数
    failed: int    # 失败/跳过数
    created_at: datetime

    class Config:
        from_attributes = True


# ==============================================================
# 统计
# ==============================================================

class StatsOverview(BaseModel):
    """汇总数字（指定时间范围内的全局口径）。
    - total_used: 期间所有使用记录条数
    - connected: 含标签"已接通"的记录数
    - unconnected: 含标签"未接通"的记录数
    - wechat_added: 含标签"已加微信"的记录数
    - pool_remaining: 当前 status='pool' 的号码池剩余数量（实时）
    """
    total_used: int
    connected: int
    unconnected: int
    wechat_added: int
    pool_remaining: int


class StatsDetailItem(BaseModel):
    """单个员工的统计明细（指定时间范围内）。"""
    user_id: int
    real_name: str
    total_used: int
    connected: int              # 该员工含"已接通"的记录数
    unconnected: int           # 含"未接通"的记录数
    wechat_added: int         # 含"已加微信"的记录数


class StatsOut(BaseModel):
    """统计报表完整响应。
    - range: 时间范围参数，today/yesterday/week/month
    - overview: 全局汇总
    - details: 每位员工明细
    """
    range: str
    overview: StatsOverview
    details: List[StatsDetailItem]
