# 邀约宝后端 - Ubuntu 22.04 部署指南（Linux 路线）

本指南串起 `deploy/` 下为 Ubuntu 服务器准备的脚本与配置，完成从"空服务器"到"可上线"的全流程。
路径约定（所有脚本/配置保持一致）：

| 用途 | 路径 |
|------|------|
| 代码根目录 | `/var/www/yaoyuebao` |
| 后端目录 | `/var/www/yaoyuebao/dialer-backend` |
| 前端目录 | `/var/www/yaoyuebao/frontend` |
| 数据库文件 | `/var/lib/yaoyuebao/dialer.db`（= `.env` 中 `DB_PATH`） |
| 备份目录 | `/var/backups/yaoyuebao` |
| 日志目录 | `/var/log/yaoyuebao` |
| 证书目录 | `/etc/nginx/ssl/yaoyuebao.cn/`、`/etc/nginx/ssl/api.yaoyuebao.cn/` |

> 前置依赖（非本指南范围，需提前完成）：ICP 备案、域名解析 A 记录指向服务器 IP、云安全组放行 80/443。

---

## Stage 1 · 上传代码

```bash
# 方式 A：git 仓库（推荐）
sudo mkdir -p /var/www/yaoyuebao
sudo git clone <你的仓库地址> /var/www/yaoyuebao

# 方式 B：本地 scp 上传（在开发机上执行）
scp -r dialer-backend frontend ubuntu@<服务器IP>:/var/www/yaoyuebao/
```

## Stage 2 · 一次性初始化（装依赖 / 建库 / 配权限）

```bash
sudo bash /var/www/yaoyuebao/dialer-backend/deploy/setup_ubuntu.sh
```

脚本会：装 python3/venv/nginx → 建目录 → 建 venv 并装 requirements.txt → 复制 `.env.example` 为 `.env` → 初始化数据库 → 设置 www-data 权限。

## Stage 3 · 填写生产密钥

```bash
sudo nano /var/www/yaoyuebao/dialer-backend/.env
# 至少修改：SECRET_KEY=（执行 openssl rand -hex 32 生成），确认 DB_PATH=/var/lib/yaoyuebao/dialer.db
```

## Stage 4 · 部署 Nginx（HTTPS 反代）

```bash
# 先把证书上传到（本地执行）：
#   yaoyuebao.cn_bundle.pem + yaoyuebao.cn.key  → /etc/nginx/ssl/yaoyuebao.cn/
#   api.yaoyuebao.cn_bundle.pem + .key          → /etc/nginx/ssl/api.yaoyuebao.cn/

sudo cp /var/www/yaoyuebao/dialer-backend/deploy/nginx-ubuntu.conf /etc/nginx/sites-available/yaoyuebao.conf
sudo ln -s /etc/nginx/sites-available/yaoyuebao.conf /etc/nginx/sites-enabled/
sudo nginx -t            # 校验配置语法
sudo systemctl reload nginx
```

## Stage 5 · 部署进程守护（systemd）

```bash
sudo cp /var/www/yaoyuebao/dialer-backend/deploy/yaoyuebao.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yaoyuebao
sudo systemctl status yaoyuebao     # 应显示 active (running)
sudo journalctl -u yaoyuebao -f     # 查看实时日志
```

> 若环境无 systemd，改用 Supervisor：参考 `deploy/supervisor.ini`（已与本路线路径/变量对齐）。

## Stage 6 · 配置每日数据库备份（cron）

```bash
sudo crontab -e
# 末尾追加（每日 02:00 执行）：
0 2 * * * /usr/bin/bash /var/www/yaoyuebao/dialer-backend/deploy/backup.sh >> /var/log/yaoyuebao/backup.cron.log 2>&1
```

## Stage 7 · 验证上线

```bash
# 后端健康检查（Nginx 443 → 127.0.0.1:8000）
curl -k https://api.yaoyuebao.cn/health
curl -k https://yaoyuebao.cn/health

# 浏览器访问
#   员工后台：https://yaoyuebao.cn
#   API 文档： https://api.yaoyuebao.cn/docs
```

- 用默认账号 `admin / admin123` 登录，**上线第一天必须修改密码**。
- 确认 CORS 白名单（`main.py` 已写死 `yaoyuebao.cn / www.yaoyuebao.cn / api.yaoyuebao.cn`）。

## Stage 8 · 微信小程序合法域名（备案通过后）

在微信公众平台 → 开发管理 → 开发设置 → 服务器域名，配置：
- request 合法域名：`https://api.yaoyuebao.cn`
- uploadFile / downloadFile 合法域名（如用到）：`https://api.yaoyuebao.cn`
- 同时确认小程序 AppID（`wxed06361472488dd8` 或 `wx65b4a0dacfb23ac4`）与发布主体一致。

---

## 文件清单（deploy/ 下本次新增/修正）

| 文件 | 作用 | 变更 |
|------|------|------|
| `nginx-ubuntu.conf` | Nginx HTTPS 反代（主站 + api 子域双证书） | 第一优先级新增 |
| `yaoyuebao.service` | systemd 进程守护（gunicorn） | 本次新增 |
| `setup_ubuntu.sh` | Ubuntu 初始化一键脚本 | 本次新增 |
| `backup.sh` | SQLite 每日热备 + 清理 | 本次新增（基于 Windows backup.bat 改写） |
| `supervisor.ini` | 进程守护备选方案 | 本次修正（waitress→gunicorn、DATABASE_URL→DB_PATH、路径对齐） |
| `.env.example` | 生产环境变量模板 | 本次修正（DATABASE_URL→DB_PATH，标注生效字段） |
| `DEPLOY_UBUNTU.md` | 本部署指南 | 本次新增 |
