# ============================================================
# 邀约宝后端 - Waitress 生产配置
# Windows Server 推荐使用 Waitress 作为 ASGI 服务器
# Linux Server 可用 Gunicorn
#
# 启动命令（Windows）：
#   venv\Scripts\waitress-serve.exe --configpython waitress_config.py app.main:app
#
# 启动命令（Linux）：
#   gunicorn -c gunicorn.conf.py app.main:app
#
# ============================================================

import os

# ---------- 从环境变量读取配置 ----------
DATABASE_URL = os.environ.get("DATABASE_URL", "")
SECRET_KEY   = os.environ.get("SECRET_KEY", "dialer-secret-key-change-me-in-prod")
LOG_DIR      = os.environ.get("LOG_DIR", "D:/dialer/logs")
ENV          = os.environ.get("ENV", "production")
API_PORT     = int(os.environ.get("API_PORT", "8000"))

# ---------- Waitress 核心配置 ----------
# 线程数：一般设为 CPU 核心数 × 2~4
# 4核服务器推荐 8~16 线程
HOST = "127.0.0.1"      # 只监听本地，Nginx 反代，不对外暴露
PORT = API_PORT
THREADS = 12            # 线程池大小（根据 CPU 调整）

# ---------- 请求处理 ----------
# 单连接最大请求数（超过后关闭连接并重开）
MAX_REQUESTS = 1000
MAX_REQUESTS_JITTER = 50   # 随机抖动，防止所有 worker 同时重启

# ---------- 连接队列 ----------
# Nginx 反代时队列长度（适当放大防止丢包）
LISTEN_QUEUE = 128

# ---------- 超时配置（秒）----------
# 普通请求超时
TIMEOUT_SECS = 60

# ---------- 日志 ----------
# Waitress 启动日志文件（生产环境关闭 console 输出）
LOG_SOCKET = "D:/dialer/logs/waitress.log"
LOG_LEVEL = "info"

# ---------- 启动信息 ----------
if __name__ == "__main__":
    print(f"Waitress Config:")
    print(f"  Host:      {HOST}")
    print(f"  Port:      {PORT}")
    print(f"  Threads:   {THREADS}")
    print(f"  Timeout:   {TIMEOUT_SECS}s")
    print(f"  Log:       {LOG_SOCKET}")
    print(f"  Env:       {ENV}")
