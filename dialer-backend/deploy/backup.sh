#!/usr/bin/env bash
# ============================================================
# 邀约宝后端 - SQLite 数据库每日备份脚本（Linux 版）
# 功能：
#   1. 对运行中的 SQLite 做在线热备（不影响线上服务）
#   2. 备份文件名带时间戳：dialer_20260904_020000.db
#   3. 自动清理超过保留天数的旧备份
#   4. 顺带备份 .env（含生产密钥，丢失将影响 JWT 校验）
# 用法：
#   bash /var/www/yaoyuebao/dialer-backend/deploy/backup.sh
# 建议配合 cron 每日凌晨执行（见脚本底部 cron 示例）
# ============================================================

set -euo pipefail  # 任一命令失败即退出，避免产生不完整备份

# ---------- 配置区（按需修改，路径与 .env / yaoyuebao.service 保持一致） ----------
DB_PATH="/var/lib/yaoyuebao/dialer.db"                 # 数据库实际路径（= .env 中 DB_PATH）
BACKUP_DIR="/var/backups/yaoyuebao"                    # 备份存放目录
ENV_FILE="/var/www/yaoyuebao/dialer-backend/.env"      # 一并备份的生产环境变量
LOG_FILE="/var/log/yaoyuebao/backup.log"               # 执行日志
RETAIN_DAYS=7                                          # 备份保留天数（超过则删除）
# ---------- 配置区结束 ----------

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_NAME="dialer_${TIMESTAMP}.db"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# 简易日志函数：同时输出到终端与日志文件
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "=== 数据库备份开始 ==="

# 1. 校验数据库文件是否存在
if [ ! -f "$DB_PATH" ]; then
    log "[错误] 数据库文件不存在: $DB_PATH"
    exit 1
fi

# 2. 确保备份目录存在（不存在则创建）
mkdir -p "$BACKUP_DIR"

# 3. 执行在线热备
#    使用 Python sqlite3 连接级 backup() 方法：在源库连接打开状态下把数据写入目标，
#    避免直接 cp 可能读到一个"写一半"的文件；备份前先做 integrity_check 完整性校验。
python3 - "$DB_PATH" "$BACKUP_PATH" <<'PYEOF'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
con = sqlite3.connect(src)
try:
    cur = con.cursor()
    cur.execute("PRAGMA integrity_check;")
    row = cur.fetchone()
    if row is not None and row[0] != "ok":
        print(f"[WARN] integrity_check={row[0]}，仍继续备份")
    dst_con = sqlite3.connect(dst)
    try:
        con.backup(dst_con)   # 在线热备核心调用
    finally:
        dst_con.close()
finally:
    con.close()
print(f"OK: {dst}")
PYEOF

if [ $? -ne 0 ]; then
    log "[错误] 备份失败"
    exit 1
fi
log "[OK] 备份成功: $BACKUP_NAME"

# 4. 清理超过保留天数的旧备份
#    find -mtime +N 匹配"修改时间早于 N*24 小时"的文件
find "$BACKUP_DIR" -name 'dialer_*.db' -type f -mtime +"$RETAIN_DAYS" -delete
COUNT=$(find "$BACKUP_DIR" -name 'dialer_*.db' -type f | wc -l)
log "当前保留备份数量: $COUNT 个（保留 ${RETAIN_DAYS} 天）"

# 5. 备份 .env（生产密钥等重要配置，单独留存，便于灾难恢复）
if [ -f "$ENV_FILE" ]; then
    cp -f "$ENV_FILE" "${BACKUP_DIR}/.env.backup"
    log ".env 已一并备份"
fi

log "=== 数据库备份完成 ==="

# ============================================================
# 配置 cron（每日 02:00 自动备份）示例，以 root 身份：
#   sudo crontab -e
#   0 2 * * * /usr/bin/bash /var/www/yaoyuebao/dialer-backend/deploy/backup.sh >> /var/log/yaoyuebao/backup.cron.log 2>&1
# 手动恢复方法（生产故障时）：
#   1) 停止服务： sudo systemctl stop yaoyuebao
#   2) 覆盖：     cp /var/backups/yaoyuebao/dialer_YYYYMMDD_HHMMSS.db /var/lib/yaoyuebao/dialer.db
#   3) 重启：     sudo systemctl start yaoyuebao
# ============================================================
