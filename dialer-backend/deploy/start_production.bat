@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: ============================================================
:: 邀约宝后端 - 生产环境启动脚本
:: 使用 waitress（Windows 生产推荐），不用 uvicorn
:: ============================================================

set PROJECT_ROOT=%~dp0..
set PROJECT_ROOT=%PROJECT_ROOT:~0,-1%

echo ==========================================
echo   邀约宝后端 - 生产启动
echo ==========================================
echo.

:: -----------------------------------------------
:: 加载 .env 环境变量
:: -----------------------------------------------
if exist "%PROJECT_ROOT%\.env" (
    echo [1/5] 加载环境变量...
    for /f "usebackq tokens=1,* delims==" %%a in ("%PROJECT_ROOT%\.env") do (
        set "%%a=%%b"
    )
    echo  DATABASE_URL=!DATABASE_URL!
    echo  ENV=!ENV!
) else (
    echo  [警告] .env 文件不存在，使用默认值
)

:: -----------------------------------------------
:: 2. 检查端口是否被占用
:: -----------------------------------------------
echo [2/5] 检查端口 8000...

netstat -ano | findstr ":8000 " >nul
if %errorlevel% equ 0 (
    echo  [警告] 端口 8000 已被占用！
    echo  请先关闭占用进程再启动:
    echo    netstat -ano ^| findstr ":8000"
    echo    taskkill /PID xxx /F
    echo.
    pause
    exit /b 1
)
echo  端口 8000 可用

:: -----------------------------------------------
:: 3. 激活虚拟环境
:: -----------------------------------------------
echo [3/5] 激活虚拟环境...
call "%PROJECT_ROOT%\venv\Scripts\activate.bat"

:: 设置环境变量给 waitress 用
if defined DATABASE_URL set "WAITRESS_DB=!DATABASE_URL!"
if defined SECRET_KEY  set "WAITRESS_SECRET=!SECRET_KEY!"
if defined LOG_DIR     set "WAITRESS_LOGDIR=!LOG_DIR!"

:: -----------------------------------------------
:: 4. 确保目录存在
:: -----------------------------------------------
echo [4/5] 确保数据目录存在...

for %%d in ("%PROJECT_ROOT%\data" "%PROJECT_ROOT%\logs" "%PROJECT_ROOT%\backups") do (
    if not exist "%%d" mkdir "%%d"
)

:: -----------------------------------------------
:: 5. 启动 Waitress 生产服务器
:: -----------------------------------------------
echo [5/5] 启动 Waitress 服务...
echo.
echo  ==============================================
echo   服务信息:
echo   - 监听端口: 8000
echo   - 进程管理: Waitress（Windows 生产级）
echo   - 日志文件: %PROJECT_ROOT%\logs\waitress.log
echo  ==============================================
echo.

:: 启动 waitress，输出写入日志文件
set LOG_FILE=%PROJECT_ROOT%\logs\waitress.log
echo [%date% %time%] === 启动 Waitress === >> "!LOG_FILE!"

:: Windows 环境变量传给 Python subprocess
set PYTHONPATH=%PROJECT_ROOT%

start "邀约宝后端服务" /min cmd /c ^
    "cd /d %PROJECT_ROOT% ^&^& ^
    venv\Scripts\python.exe -c ^
    \"import os, sys; os.chdir(r'%PROJECT_ROOT%'); [os.environ.update({k,v}) for k,v in {l.strip().split('=',1) for l in open(r'%PROJECT_ROOT%\.env') if '=' in l and not l.startswith('#')}] ^&^& ^
    from waitress import serve; from app.main import app; print('Waitress starting on port 8000...'); serve(app, host='127.0.0.1', port=8000, threads=6)\" >> %PROJECT_ROOT%\logs\waitress.log 2>&1"

:: 等待 3 秒检测启动
timeout /t 3 /nobreak >nul

:: 检查是否启动成功
netstat -ano | findstr ":8000 " >nul
if %errorlevel% equ 0 (
    echo.
    echo  [OK] 服务已启动，监听 127.0.0.1:8000
    echo.
    echo  API 地址:   http://127.0.0.1:8000
    echo  文档:       http://127.0.0.1:8000/docs
    echo  健康检查:   http://127.0.0.1:8000/health
    echo.
    echo  日志文件:   %PROJECT_ROOT%\logs\waitress.log
    echo.
    echo  按任意键打开日志...
    pause >nul
    type "%PROJECT_ROOT%\logs\waitress.log"
) else (
    echo.
    echo  [错误] 服务未能正常启动！
    echo  请检查日志: %PROJECT_ROOT%\logs\waitress.log
    echo.
    echo  常见问题:
    echo  1. 端口被占用: netstat -ano ^| findstr 8000
    echo  2. Python 环境: venv\Scripts\python.exe --version
    echo  3. 依赖缺失: venv\Scripts\pip list
    echo.
    pause
)
