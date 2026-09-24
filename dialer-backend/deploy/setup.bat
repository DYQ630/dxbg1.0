@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: ============================================================
:: 邀约宝后端 - Windows Server 生产环境初始化脚本
:: 适用：腾讯云轻量应用服务器 Windows Server 2019/2022
:: 首次部署时运行一次即可
:: ============================================================

set PROJECT_ROOT=%~dp0..
set PROJECT_ROOT=%PROJECT_ROOT:~0,-1%

echo ==========================================
echo   邀约宝后端 - 生产环境初始化
echo ==========================================
echo.

:: -----------------------------------------------
:: 1. 检查管理员权限
:: -----------------------------------------------
echo [1/8] 检查管理员权限...
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [警告] 建议以管理员身份运行此脚本以确保所有操作正常
    echo  右键 PowerShell → 以管理员身份运行
    echo.
)

:: -----------------------------------------------
:: 2. 检查 Python
:: -----------------------------------------------
echo [2/8] 检查 Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo  [错误] 未找到 Python，请先安装 Python 3.9+
    echo  下载地址: https://www.python.org/downloads/
    echo  推荐安装 Python 3.11 或更高版本
    echo  安装时请勾选 "Add Python to PATH"
    echo.
    echo  腾讯云服务器可用以下命令安装:
    echo    winget install Python.Python.3.11
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%i in ('python --version 2^>^&1') do set PY_VER=%%i
echo  已安装: !PY_VER!

:: -----------------------------------------------
:: 3. 创建目录结构
:: -----------------------------------------------
echo [3/8] 创建目录结构...

set DIR_LIST=%PROJECT_ROOT%\app %PROJECT_ROOT%\data %PROJECT_ROOT%\logs %PROJECT_ROOT%\backups %PROJECT_ROOT%\certs

for %%d in (!DIR_LIST!) do (
    if not exist "%%d" (
        mkdir "%%d"
        echo  创建: %%d
    )
)

echo  目录结构准备完毕
echo.

:: -----------------------------------------------
:: 4. 创建 / 激活虚拟环境
:: -----------------------------------------------
echo [4/8] 配置虚拟环境...

if not exist "%PROJECT_ROOT%\venv" (
    echo  创建虚拟环境 venv...
    python -m venv venv
) else (
    echo  虚拟环境已存在，跳过
)

echo  激活虚拟环境并安装依赖...

call "%PROJECT_ROOT%\venv\Scripts\activate.bat"

:: 升级 pip
python -m pip install --upgrade pip --quiet

:: 安装依赖（国内镜像加速）
echo  安装 Python 依赖包...
pip install fastapi uvicorn[standard] sqlalchemy aiosqlite python-multipart --quiet
pip install openpyxl xlrd httpx pydantic-settings python-dotenv --quiet
pip install waitress --quiet
pip install psutil --quiet

:: 单独安装认证相关依赖
pip install "python-jose[cryptography]" "passlib[bcrypt]" --quiet

echo  依赖安装完成
echo.

:: -----------------------------------------------
:: 5. 创建 .env 配置文件
:: -----------------------------------------------
echo [5/8] 生成环境变量配置...

set ENV_FILE=%PROJECT_ROOT%\.env
if exist "!ENV_FILE!" (
    echo  .env 已存在，跳过（若需重新生成请先删除）
) else (
    echo  创建 .env 文件（请修改 SECRET_KEY 为随机字符串）...

    :: 生成随机密钥提示
    echo # ========================================== > "!ENV_FILE!"
    echo # 邀约宝后端 - 环境变量配置 >> "!ENV_FILE!"
    echo # 请务必修改 SECRET_KEY 为随机字符串 >> "!ENV_FILE!"
    echo # ========================================== >> "!ENV_FILE!"
    echo. >> "!ENV_FILE!"
    echo # 数据库（Windows路径） >> "!ENV_FILE!"
    echo DATABASE_URL=sqlite:///%PROJECT_ROOT:\=/%/data/dialer.db >> "!ENV_FILE!"
    echo. >> "!ENV_FILE!"
    echo # 安全密钥（请修改！） >> "!ENV_FILE!"
    echo # 推荐用以下命令生成随机密钥: >> "!ENV_FILE!"
    echo #   python -c "import secrets; print(secrets.token_hex(32))" >> "!ENV_FILE!"
    echo SECRET_KEY=change_me_to_a_random_32_char_secret_key >> "!ENV_FILE!"
    echo. >> "!ENV_FILE!"
    echo # 日志目录 >> "!ENV_FILE!"
    echo LOG_DIR=%PROJECT_ROOT:\=/%/logs >> "!ENV_FILE!"
    echo. >> "!ENV_FILE!"
    echo # 服务模式: development / production >> "!ENV_FILE!"
    echo ENV=production >> "!ENV_FILE!"
    echo. >> "!ENV_FILE!"
    echo # API 监听端口 >> "!ENV_FILE!"
    echo API_PORT=8000 >> "!ENV_FILE!"
    echo. >> "!ENV_FILE!"
    echo # CORS 允许来源（生产环境请填具体域名） >> "!ENV_FILE!"
    echo CORS_ORIGINS=* >> "!ENV_FILE!"
    echo. >> "!ENV_FILE!"
    echo  已创建 .env，请打开编辑 SECRET_KEY
    echo  文件位置: !ENV_FILE!
)

echo.

:: -----------------------------------------------
:: 6. 修改 app/auth.py - 改用环境变量
:: -----------------------------------------------
echo [6/8] 修改 auth.py 支持环境变量...

set AUTH_FILE=%PROJECT_ROOT%\app\auth.py
set AUTH_BACKUP=%PROJECT_ROOT%\app\auth.py.bak

if not exist "!AUTH_BACKUP!" (
    copy "!AUTH_FILE!" "!AUTH_BACKUP!" >nul
    echo  已备份原 auth.py 到 auth.py.bak
)

:: 用 Python 脚本修改 auth.py
call "%PROJECT_ROOT%\venv\Scripts\python.exe" -c "
import os, sys

auth_file = r'%AUTH_FILE:\\=\\%'
auth_backup = r'%AUTH_BACKUP:\\=\\%'

with open(auth_file, 'r', encoding='utf-8') as f:
    content = f.read()

# 检查是否已经修改过
if 'os.environ' in content and 'SECRET_KEY' in content:
    print('  auth.py 已配置环境变量，跳过')
    sys.exit(0)

# 替换硬编码的 SECRET
old_secret = 'SECRET = \"dialer-secret-key-change-me-in-prod\"'
new_secret = '''import os
# 生产环境从环境变量读取 SECRET_KEY（见 .env 文件）
SECRET = os.environ.get(\"SECRET_KEY\", \"dialer-secret-key-change-me-in-prod\")'''

if old_secret in content:
    content = content.replace(old_secret, new_secret)
    with open(auth_file, 'w', encoding='utf-8') as f:
        f.write(content)
    print('  已修改 auth.py，SECRET 改为从环境变量读取')
else:
    print('  auth.py 可能已被修改，跳过')
"

echo.

:: -----------------------------------------------
:: 7. 修改 app/database.py - 数据库路径可配置
:: -----------------------------------------------
echo [7/8] 修改 database.py 支持可配置数据库路径...

set DB_FILE=%PROJECT_ROOT%\app\database.py
set DB_BACKUP=%PROJECT_ROOT%\app\database.py.bak

if not exist "!DB_BACKUP!" (
    copy "!DB_FILE!" "!DB_BACKUP!" >nul
    echo  已备份原 database.py 到 database.py.bak
)

call "%PROJECT_ROOT%\venv\Scripts\python.exe" -c "
import os

db_file = r'%DB_FILE:\\=\\%'
db_backup = r'%DB_BACKUP:\\=\\%'

with open(db_file, 'r', encoding='utf-8') as f:
    content = f.read()

if 'os.environ' in content and 'DATABASE_URL' in content:
    print('  database.py 已配置环境变量，跳过')
    import sys; sys.exit(0)

old_db = '''# SQLite 本地文件，零配置
DB_PATH = os.path.join(os.path.dirname(__file__), \"dialer.db\")
SQLALCHEMY_DATABASE_URL = f\"sqlite:///{DB_PATH}\"'''

new_db = '''# 数据库配置（生产环境从环境变量读取，见 .env 文件）
# 开发环境默认使用当前目录的 dialer.db
# 生产环境设置 DATABASE_URL 环境变量，如：
#   Windows: set DATABASE_URL=sqlite:///D:/dialer/data/dialer.db
#   Linux:  export DATABASE_URL=sqlite://///opt/dialer/data/dialer.db
_db_url = os.environ.get(\"DATABASE_URL\", \"\")
if _db_url:
    SQLALCHEMY_DATABASE_URL = _db_url
else:
    # 回退到当前目录（开发环境）
    DB_PATH = os.path.join(os.path.dirname(__file__), \"dialer.db\")
    SQLALCHEMY_DATABASE_URL = f\"sqlite:///{DB_PATH}\"'''

if old_db in content:
    content = content.replace(old_db, new_db)
    with open(db_file, 'w', encoding='utf-8') as f:
        f.write(content)
    print('  已修改 database.py，DATABASE_URL 改为从环境变量读取')
else:
    print('  database.py 可能已被修改，跳过')
"

echo.

:: -----------------------------------------------
:: 8. 初始化数据库
:: -----------------------------------------------
echo [8/8] 初始化数据库...

call "%PROJECT_ROOT%\venv\Scripts\activate.bat"

call "%PROJECT_ROOT%\venv\Scripts\python.exe" -c "
import sys, os
sys.path.insert(0, r'%PROJECT_ROOT%')

# 加载 .env 环境变量
try:
    from dotenv import load_dotenv
    load_dotenv(r'%PROJECT_ROOT%\.env')
except:
    pass

try:
    from app.database import engine, Base
    from app.models import *   # 导入所有模型
    Base.metadata.create_all(bind=engine)
    print('  数据库初始化完成')
except Exception as e:
    print(f'  数据库初始化跳过（可能已有数据）: {e}')
"

echo.
echo ==========================================
echo   初始化完成！
echo ==========================================
echo.
echo  重要提醒：
echo  1. 修改 .env 文件中的 SECRET_KEY
echo     生成命令: python -c "import secrets; print(secrets.token_hex(32))"
echo  2. 上传 SSL 证书到 D:\dialer\certs\
echo  3. 配置 Nginx（参考 nginx-with-https.conf）
echo  4. 运行 start_production.bat 启动服务
echo.
echo  默认登录账号: admin / admin123
echo  （生产环境请立即修改密码！）
echo.
pause
