# 电销邀约系统

## 启动步骤

### 1. 启动后端
双击 `run.bat`，首次会自动创建虚拟环境、安装依赖、初始化数据库。

启动成功后：
- 后端 API: http://localhost:8000
- 接口文档: http://localhost:8000/docs

默认管理员账号：`admin` / `admin123`

### 2. 启动前端
前端是纯静态文件，最简单的方式：
- 电脑上：双击 `frontend/index.html`，用浏览器打开（推荐 Chrome / Edge）
- 部署给员工：把 `frontend/` 整个目录放到内网服务器或云存储（腾讯云 COS / 阿里云 OSS）上，员工扫码访问

## 第一次使用流程
1. 管理员登录 → 进入「员工管理」→ 添加邀约员账号
2. 进入「规则设置」→ 调整全局规则（每日上限、记录数量、收藏数量、回收天数）
3. 进入「号码池」→ 下载 Excel 模板 → 填入手机号 → 上传导入
4. 邀约员登录 → 即可看到自己的当前号码

## 目录结构
```
dialer-backend/
├── app/
│   ├── main.py              # 入口
│   ├── seed.py              # 初始化
│   ├── database.py          # 数据库连接
│   ├── models.py            # ORM
│   ├── schemas.py           # 接口 schema
│   ├── auth.py              # 密码 + JWT
│   ├── deps.py              # 鉴权依赖
│   ├── phone_util.py        # 号段识别
│   └── routers/
│       ├── auth_router.py
│       ├── admin_router.py
│       └── agent_router.py
├── requirements.txt
├── run.bat                  # 一键启动
└── dialer.db                # 自动生成的数据库
```
