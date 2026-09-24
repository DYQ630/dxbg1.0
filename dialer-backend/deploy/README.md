# 邀约宝后端 - 部署脚本目录

本目录包含 Windows Server 生产环境部署所需的所有脚本和配置文件。

---

## 文件清单

| 文件 | 说明 | 平台 |
|------|------|------|
| `setup.bat` | 环境初始化脚本（安装 Python、依赖、修改配置） | Windows |
| `start_production.bat` | 生产环境启动脚本（Waitress） | Windows |
| `backup.bat` | SQLite 数据库每日备份脚本 | Windows |
| `BACKUP_TASK_WINDOWS.md` | Windows 任务计划程序配置教程 | Windows |
| `nginx.conf.example` | Nginx 反向代理配置示例 | Windows |
| `nginx-with-https.conf` | HTTPS + 反向代理完整配置 | Windows |
| `pm2-start.json` | PM2 进程守护配置（需 Node.js） | Windows |
| `supervisor.ini` | Supervisor 配置（Linux 专用） | Linux |

---

## 快速开始（Windows Server）

### 第一步：上传代码到服务器

```powershell
# 用 FTP 或 Git 把 dialer-backend 上传到 D:\dialer
# 或直接在服务器上 git clone
```

### 第二步：初始化环境（首次运行一次）

```powershell
cd D:\dialer\dialer-backend\deploy
setup.bat
```

> ⚠️ setup.bat 会：
> 1. 检查/安装 Python 环境
> 2. 创建目录结构（data/、logs/、backups/、certs/）
> 3. 创建虚拟环境并安装依赖
> 4. 生成 `.env` 配置文件
> 5. 自动修改 `app/auth.py` 和 `app/database.py` 支持环境变量
> 6. 初始化数据库

### 第三步：上传 SSL 证书

从腾讯云 SSL 证书控制台下载 Nginx 版证书，解压后上传到：
```
D:\nginx\conf\certs\
  ├── api.yaoyuebao.cn.pem
  └── api.yaoyuebao.cn.key
```

### 第四步：修改 Nginx 配置

编辑 `nginx-with-https.conf`，将所有 `YOUR_DOMAIN` 替换为实际域名：
```
ssl_certificate     D:/nginx/conf/certs/你的域名.pem;
ssl_certificate_key D:/nginx/conf/certs/你的域名.key;
server_name         api.yaoyuebao.cn;
```

复制到 `D:\nginx\conf\nginx.conf`，启动 Nginx。

### 第五步：启动后端服务

```powershell
cd D:\dialer\dialer-backend\deploy
start_production.bat
```

### 第六步：配置每日备份

1. 打开「任务计划程序」
2. 创建基本任务，命名为「邀约宝-每日数据库备份」
3. 触发器：每天凌晨 2:00
4. 操作：启动程序 `powershell.exe`，参数：
   ```
   -ExecutionPolicy Bypass -File "D:\dialer\dialer-backend\deploy\backup.bat"
   ```
5. 勾选「使用最高权限运行」，完成

详细图文步骤见 `BACKUP_TASK_WINDOWS.md`。

---

## Linux 部署（可选）

如果使用 Linux 服务器，参考 `supervisor.ini` 配置进程守护。

---

## 架构图

```
微信小程序
    │
    ▼ HTTPS:443
Nginx（Windows Server）
    │
    ├── HTTP 跳转 HTTPS
    ├── SSL 终止
    └── 反向代理到 localhost:8000
            │
            ▼
    Waitress ASGI Server
            │
            ├── /api/v1/contacts
            ├── /api/v1/agent/dial
            └── /health
                    │
                    ▼
            SQLite: D:\dialer\data\dialer.db
```

---

## 关键端口

| 端口 | 用途 | 外部访问 |
|------|------|----------|
| 80 | HTTP（跳转 HTTPS） | 是 |
| 443 | HTTPS（Nginx → 后端） | 是（小程序） |
| 8000 | Waitress 后端 | 否（仅 Nginx 访问）|
| 3389 | 远程桌面 | 可选 |

---

## 环境变量说明

`.env` 文件位于 `D:\dialer\.env`，生产环境必须修改：

| 变量 | 说明 | 必须修改 |
|------|------|---------|
| SECRET_KEY | JWT 签名密钥 | ✅ 必须 |
| DATABASE_URL | 数据库路径 | 建议确认 |
| LOG_DIR | 日志目录 | 默认即可 |
| ENV | 模式（production） | 默认即可 |

---

## 故障排查

```powershell
# 1. 检查端口占用
netstat -ano | findstr ":8000"

# 2. 查看 Waitress 日志
type D:\dialer\logs\waitress.log

# 3. 查看 Nginx 错误日志
type D:\nginx\logs\ssl_error.log

# 4. 重启 Nginx
D:\nginx\nginx.exe -s stop
D:\nginx\nginx.exe

# 5. 重启后端（先杀掉再启动）
taskkill /F /IM python.exe
start_production.bat
```
