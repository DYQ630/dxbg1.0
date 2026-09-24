# ============================================================
# 邀约宝后端 - Gunicorn 生产配置（Linux 专用）
# Windows 不支持 Gunicorn，仅作 Linux 部署备选
#
# 启动命令（Linux）：
#   gunicorn -c gunicorn.conf.py app.main:app
#
# 后台运行：
#   nohup gunicorn -c gunicorn.conf.py app.main:app >> /var/log/dialer/gunicorn.log 2>&1 &
# ============================================================

import os
import multiprocessing

# ---------- 从环境变量读取 ----------
bind           = os.environ.get("GUNICORN_BIND", "127.0.0.1:8000")
workers        = int(os.environ.get("GUNICORN_WORKERS", multiprocessing.cpu_count() * 2 + 1))
threads        = int(os.environ.get("GUNICORN_THREADS", "4"))
timeout        = int(os.environ.get("GUNICORN_TIMEOUT", "60"))
keepalive      = int(os.environ.get("GUNICORN_KEEPALIVE", "5"))

# ---------- 日志 ----------
accesslog      = "/var/log/dialer/access.log"
errorlog       = "/var/log/dialer/error.log"
loglevel       = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# ---------- 进程名 ----------
proc_name      = "dialer-backend"

# ---------- 进程管理 ----------
# 最大请求数后重启 worker（防止内存泄漏）
max_requests           = 1000
max_requests_jitter    = 50
worker_class           = "sync"           # 或 "uvicorn.workers.UvicornWorker"（ASGI）
worker_tmp_dir         = "/dev/shm"       # Linux 内存文件系统，加速

# ---------- 预加载 ----------
# True：所有 worker 共享同一个内存中的 app（节省内存）
# False：每个 worker 独立加载（调试用）
preload_app            = True

# ---------- 安全 ----------
limit_request_line     = 4094
limit_request_fields   = 100
limit_request_field_size = 8190

# ---------- 启动钩子 ----------
def on_starting(server):
    """Gunicorn 启动前"""
    print(f"[Gunicorn] Starting on {bind}")

def on_reload(server):
    """热重载时"""
    print(f"[Gunicorn] Reloading workers...")

def worker_int(worker):
    """Worker 收到 SIGINT"""
    print(f"[Gunicorn] Worker {worker.pid} interrupted")

def worker_exit(worker, req):
    """Worker 退出"""
    print(f"[Gunicorn] Worker {worker.pid} exited")
