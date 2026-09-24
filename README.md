# 邀约宝（Yaoyuebao）

> 企业电销号码管理系统 · 微信小程序 + Web 管理端 + FastAPI 后端

邀约宝是一套面向中小企业销售团队的**号码池外呼管理系统**。管理员批量导入客户号码，系统按规则把号码分配给销售；销售在小程序端领取号码、拨号、标记结果（已接通 / 未接通 / 加微信），数据实时回流到管理看板。

---

## ✨ 功能特性

### 管理员端（Web / 小程序共用）
- 📞 **号码池管理**：Excel 批量导入、按状态筛选、搜索、删除
- 🔄 **回收池**：超时未用号码自动回收，支持单个/批量恢复与彻底删除
- 👥 **员工管理**：邀约员账号增删改、启停、独立每日上限
- 🎯 **规则配置**：全局每日上限 / 历史条数 / 收藏上限 / 回收天数，支持按人覆盖
- 🏷️ **标签体系**：自定义标签，按标签统计跟进频次
- 📊 **数据看板**：今日 / 本周 / 本月已用、接通率、加微数，按人员明细

### 邀约员端（微信小程序）
- 📱 **当前号码**：一键领取、明文/掩码切换、一键拨号
- 📝 **跟进记录**：标签多选 + 备注 + 收藏，编辑 / 删除
- ⭐ **收藏夹**：高意向客户标记，便于二次跟进
- 🕐 **历史记录**：分页查询，按状态筛选

---

## 📸 功能截图

截图统一放在 `docs/screenshots/` 目录下：

```
docs/screenshots/
├── 01-admin-home.png      # 管理员首页看板
├── 02-admin-pool.png      # 号码池批量导入
├── 03-admin-users.png     # 员工管理
├── 04-admin-stats.png    # 数据统计
├── 05-agent-current.png   # 销售端当前号码
├── 06-agent-history.png   # 销售端历史记录
└── 07-agent-favorite.png  # 销售端收藏
```

> 部署后把对应截图放入该目录，在下方插入：
>
> ![管理员首页](docs/screenshots/01-admin-home.png)

---

## 🏗️ 技术架构

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  微信小程序   │     │  Web 管理端   │     │   Nginx :443     │
│  (原生 WXML)  │     │  (Vue3 SPA)  │────▶│  反向代理 + HTTPS │
└──────┬───────┘     └──────┬───────┘     └────────┬─────────┘
       │                    │                       │
       └──────────┬─────────┘                       │
                  ▼                                 ▼
        ┌─────────────────────────────────────────────────┐
        │          FastAPI + gunicorn (ASGI)              │
        │   /api/auth  /api/admin/*  /api/agent/*         │
        └────────────────────────┬────────────────────────┘
                                 ▼
                        ┌──────────────────┐
                        │  SQLite (dialer.db)│
                        └──────────────────┘
```

| 层 | 技术 |
|---|---|
| 后端框架 | FastAPI 0.110 + Pydantic v2 |
| ASGI 服务器 | Uvicorn（开发）/ Gunicorn（生产） |
| ORM | SQLAlchemy 2.0 |
| 数据库 | SQLite（零运维，单文件） |
| 鉴权 | JWT（python-jose）+ bcrypt 密码哈希 |
| Web 前端 | 单文件 Vue 3 + axios（无构建步骤） |
| 小程序 | 原生微信小程序（WXML/WXSS/JS） |
| 反代 / TLS | Nginx + Let's Encrypt / 免费证书 |
| Excel 导入 | openpyxl |

---

## 📁 项目结构

```
.
├── dialer-backend/            # FastAPI 后端
│   ├── app/
│   │   ├── main.py            # 入口
│   │   ├── models.py          # SQLAlchemy 模型
│   │   ├── schemas.py         # Pydantic 校验
│   │   ├── auth.py            # JWT 登录/改密
│   │   ├── database.py        # 引擎与会话
│   │   ├── phone_util.py     # 号段/运营商解析
│   │   ├── seed.py            # 初始化管理员账号
│   │   └── routers/
│   │       ├── auth_router.py
│   │       ├── admin_router.py
│   │       └── agent_router.py
│   ├── deploy/                # 部署脚本与 nginx 配置
│   ├── requirements.txt
│   └── .env.example
├── miniprogram/               # 微信小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── pages/
│   │   ├── login/
│   │   ├── admin-*/           # 管理员页
│   │   └── agent-*/           # 邀约员页
│   └── utils/api.js           # 统一请求封装
├── frontend/                  # Web 管理端（单文件 index.html）
│   └── assets/                # 图标/logo
├── tests/                     # API 自动化测试
└── project.config.json        # 微信开发者工具项目配置
```

---

## 🚀 本地开发

### 1. 后端

```bash
cd dialer-backend
python -m venv venv
# Windows: venv\Scripts\activate
# Linux:   source venv/bin/activate
pip install -r requirements.txt

# 初始化数据库（自动创建 admin 账号）
python app/seed.py   # 或 python -m app.seed

# 启动开发服务器
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

访问 http://127.0.0.1:8000/docs 查看 Swagger 接口文档。

### 2. Web 前端

`frontend/index.html` 是单文件 Vue 应用，默认请求同源 API。开发时可：

```bash
cd frontend
python -m http.server 5500
# 然后把 utils/api.js 里的 BASE_URL 改成 http://127.0.0.1:8000
```

### 3. 微信小程序

1. 用**微信开发者工具**打开项目根目录（不是 `miniprogram/` 子目录）
2. 填入自己的 AppID
3. 把 `miniprogram/utils/api.js` 里的 `BASE_URL` 改成 `http://127.0.0.1:8000`
4. 开发者工具右上角「详情 → 本地设置」勾选**不校验合法域名**（仅开发用）

---

## 📦 生产部署

完整步骤见 [`dialer-backend/deploy/DEPLOY_UBUNTU.md`](dialer-backend/deploy/DEPLOY_UBUNTU.md)，摘要：

```bash
# 后端
pip install -r requirements.txt
gunicorn -w 2 -k uvicorn.workers.UvicornWorker \
  -b 127.0.0.1:8000 app.main:app

# Nginx 反代 + HTTPS，参考 deploy/nginx-with-https.conf
# systemd 服务单元参考 deploy/yaoyuebao.service（开机自启 + 崩溃自动重启）
```

环境变量（`.env`）：

| 变量 | 说明 |
|---|---|
| `DB_PATH` | SQLite 文件路径 |
| `SECRET_KEY` | JWT 签名密钥（务必改成随机 32 位字符串） |
| `ENV` | `production` |
| `UPLOAD_DIR` | Excel 上传临时目录 |

---

## 🔐 默认账号

首次启动后用 seed 脚本创建的管理员账号：

```
用户名: admin
密码:   admin123
```

> ⚠️ **生产环境务必第一时间登录后修改密码。**

