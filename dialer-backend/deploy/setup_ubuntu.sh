#!/usr/bin/env bash
# ============================================================
# 邀约宝后端 - Ubuntu 22.04 服务器初始化脚本（一次性的）
# 功能：装系统依赖 / 建目录 / 建虚拟环境 / 装 Python 依赖 / 配 .env / 初始化数据库 / 设权限
# 用法（在服务器上，以 sudo 执行）：
#   sudo bash /var/www/yaoyuebao/dialer-backend/deploy/setup_ubuntu.sh
# 前置条件：代码已上传到 /var/www/yaoyuebao（见下方"上传代码"说明）
# ============================================================

set -euo pipefail

# ---------- 路径约定（必须与 nginx-ubuntu.conf / yaoyuebao.service 一致） ----------
CODE_DIR="/var/www/yaoyuebao"                     # 代码根目录（git clone 目标）
BACKEND_DIR="${CODE_DIR}/dialer-backend"          # 后端目录
DATA_DIR="/var/lib/yaoyuebao"                     # 数据库目录（DB_PATH 指向此处）
BACKUP_DIR="/var/backups/yaoyuebao"               # 备份目录
LOG_DIR="/var/log/yaoyuebao"                      # 日志目录
SERVICE_USER="www-data"                           # 运行进程的系统用户
# ---------------------------------------------------------------------------------

echo "=========================================="
echo "  邀约宝后端 - Ubuntu 初始化"
echo "=========================================="

# ---------- 0. 权限检查：本脚本必须 root 执行（涉及 apt / 建目录 / chown） ----------
if [ "$(id -u)" -ne 0 ]; then
    echo "[错误] 请使用 sudo 运行此脚本"
    exit 1
fi

# ---------- 1. 安装系统依赖 ----------
echo "[1/6] 安装系统依赖（python3 / venv / nginx）..."
apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx

# ---------- 2. 创建目录结构 ----------
echo "[2/6] 创建目录结构..."
mkdir -p "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR"
# SSL 证书目录（部署 Nginx 前需将证书上传到这两个目录）
mkdir -p /etc/nginx/ssl/yaoyuebao.cn /etc/nginx/ssl/api.yaoyuebao.cn

# ---------- 3. 创建 Python 虚拟环境并安装依赖 ----------
echo "[3/6] 创建虚拟环境并安装依赖..."
if [ ! -d "${BACKEND_DIR}/venv" ]; then
    python3 -m venv "${BACKEND_DIR}/venv"
fi
# 使用腾讯云 PyPI 镜像加速（服务器在国内）
PIP_INDEX="https://mirrors.cloud.tencent.com/pypi/simple"
"${BACKEND_DIR}/venv/bin/pip" install --upgrade pip -i "$PIP_INDEX"
"${BACKEND_DIR}/venv/bin/pip" install -r "${BACKEND_DIR}/requirements.txt" -i "$PIP_INDEX"

# ---------- 4. 生成 .env 生产环境变量 ----------
echo "[4/6] 配置 .env 环境变量..."
if [ -f "${BACKEND_DIR}/.env" ]; then
    echo "  .env 已存在，跳过（如需重置请先删除该文件）"
else
    cp "${BACKEND_DIR}/.env.example" "${BACKEND_DIR}/.env"
    echo "  已复制 .env.example → .env"
    echo "  ⚠️ 请编辑 ${BACKEND_DIR}/.env，至少修改 SECRET_KEY（命令：openssl rand -hex 32）"
fi

# ---------- 5. 初始化数据库（建表 + 初始数据，幂等安全） ----------
echo "[5/6] 初始化数据库（建表 + 种子数据）..."
cd "${BACKEND_DIR}"
# 通过 venv 的 python 执行 seed.init()；DB_PATH 注入环境变量，database.py 导入时即读取
# 若数据库已存在，init() 幂等跳过，异常不阻断后续步骤
DB_PATH="${DATA_DIR}/dialer.db" \
"${BACKEND_DIR}/venv/bin/python" -c "from app.seed import init; init()" \
    || echo "  [提示] 初始化异常，请检查日志（可能数据库已存在或依赖缺失）"
echo "  数据库目标位置：${DATA_DIR}/dialer.db"

# ---------- 6. 设置目录权限（归属 www-data，符合最小权限） ----------
echo "[6/6] 设置目录权限（归属 ${SERVICE_USER}）..."
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$DATA_DIR" "$LOG_DIR" "$BACKUP_DIR"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$BACKEND_DIR"
# .env 含密钥，限制仅 owner 可读写
chmod 600 "${BACKEND_DIR}/.env"
# 脚本赋予可执行权限，便于直接调用
chmod +x "${BACKEND_DIR}/deploy/backup.sh" "${BACKEND_DIR}/deploy/setup_ubuntu.sh"

echo "=========================================="
echo "  初始化完成！后续还需手动操作："
echo "=========================================="
echo "  1) 上传 SSL 证书到 /etc/nginx/ssl/<域名>/"
echo "     （yaoyuebao.cn_bundle.pem + .key → /etc/nginx/ssl/yaoyuebao.cn/）"
echo "     （api.yaoyuebao.cn_bundle.pem + .key → /etc/nginx/ssl/api.yaoyuebao.cn/）"
echo "  2) 部署 Nginx："
echo "     sudo cp ${BACKEND_DIR}/deploy/nginx-ubuntu.conf /etc/nginx/sites-available/yaoyuebao.conf"
echo "     sudo ln -s /etc/nginx/sites-available/yaoyuebao.conf /etc/nginx/sites-enabled/"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo "  3) 部署服务守护："
echo "     sudo cp ${BACKEND_DIR}/deploy/yaoyuebao.service /etc/systemd/system/"
echo "     sudo systemctl daemon-reload && sudo systemctl enable --now yaoyuebao"
echo "  4) 配置每日备份："
echo "     sudo crontab -e  →  加：0 2 * * * bash ${BACKEND_DIR}/deploy/backup.sh"
echo "  5) 改默认密码：登录 admin/admin123 后立即修改（上线第一天必须做）"
echo ""
echo "  默认账号：admin / admin123（务必上线第一天修改！）"
