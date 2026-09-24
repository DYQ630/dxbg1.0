"""FastAPI 应用入口。

创建并配置 FastAPI app，注册路由、中间件和静态文件服务。
启动时自动调用 seed.py 的 init() 完成数据库初始化。

⚠️ CORS 配置说明：
  - allow_origins=["*"] 在开发阶段允许所有来源跨域
  - 上云前必须收窄为实际前端域名，如 ["https://your-domain.com"]
  - 切勿在生产环境保持 "*" 通配符（存在安全风险）
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from .routers import auth_router, admin_router, agent_router
from .seed import init

# 创建 FastAPI 实例
# title：Swagger UI 页面标题
# version：API 版本号
# 生产环境（ENV=production）下关闭 Swagger/ReDoc/OpenAPI 文档，避免暴露 API 结构
_PROD = os.environ.get("ENV") == "production"
app = FastAPI(
    title="电销邀约系统",
    version="1.0",
    docs_url=None if _PROD else "/docs",
    redoc_url=None if _PROD else "/redoc",
    openapi_url=None if _PROD else "/openapi.json",
)


# ----------------------------------------------------------------
# CORS（跨域资源共享）中间件
# ⚠️ 上线前必须修改 allow_origins，禁止在生产环境使用 ["*"]
# ----------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    # ⚠️ 上云改造：已收窄为正式域名白名单（原 allow_origins=["*"] 通配符已禁用，生产禁止放开）。
    # 小程序走 api.yaoyuebao.cn，员工后台走 yaoyuebao.cn / www.yaoyuebao.cn。
    allow_origins=[
        "https://yaoyuebao.cn",
        "https://www.yaoyuebao.cn",
        "https://api.yaoyuebao.cn",
    ],
    allow_credentials=True,          # 允许携带 Cookie（登录态跨域）
    allow_methods=["*"],            # 允许所有 HTTP 方法
    allow_headers=["*"],            # 允许所有请求头
)


# ----------------------------------------------------------------
# 注册路由
# ----------------------------------------------------------------
app.include_router(auth_router.router)    # 登录/登出
app.include_router(admin_router.router)    # 管理员接口
app.include_router(agent_router.router)    # 邀约员接口


# ----------------------------------------------------------------
# 静态文件挂载（前端）
# 若同目录的 frontend/ 文件夹存在，则挂载为静态资源
# 前端访问路径：
#   /             → frontend/index.html
#   /static/...   → frontend/static/...
#   /assets/...   → frontend/assets/...
# ----------------------------------------------------------------
FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "frontend")
)
if os.path.isdir(FRONTEND_DIR):
    # 根路径返回 index.html（单页应用入口）
    @app.get("/")
    def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    # 挂载 /static 路径（如 CSS/JS）
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    # 挂载 /assets 路径（图片等资源）
    _assets_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")
else:
    # 前端不存在时，根路径返回 API 信息（开发调试用）
    @app.get("/")
    def root():
        return {"msg": "电销邀约系统 API", "docs": "/docs"}


# ----------------------------------------------------------------
# 启动事件：数据库初始化
# ----------------------------------------------------------------
@app.on_event("startup")
def _startup():
    """应用启动时执行一次数据库初始化（幂等操作）。\n
    详见 seed.py init() 的说明。
    """
    init()


# ----------------------------------------------------------------
# 健康检查端点（供 Nginx / 微信 / 运维探活使用）
# Nginx 配置中 location = /health 反代到此处；返回 200 即表示后端存活。
# ----------------------------------------------------------------
@app.get("/health", tags=["health"], summary="健康检查")
def health_check():
    return {"status": "ok", "service": "yaoyuebao-dialer", "version": "1.0"}


# ----------------------------------------------------------------
# 调试入口（直接运行 python -m app.main 时使用）
# ----------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
