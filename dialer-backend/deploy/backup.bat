@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

:: ============================================================
:: 邀约宝后端 - SQLite 数据库每日备份脚本
:: 功能：备份数据库文件，保留最近 7 天
:: 配合 Windows 任务计划程序每日自动执行
:: ============================================================

:: 配置区（修改这里以匹配你的安装路径）
set PROJECT_ROOT=D:\dialer
set DB_FILE=%PROJECT_ROOT%\data\dialer.db
set BACKUP_DIR=%PROJECT_ROOT%\backups
set RETAIN_DAYS=7

:: 日志文件
set LOG_FILE=%PROJECT_ROOT%\logs\backup.log

:: ============================================================

echo [%date% %time%] === 数据库备份开始 === >> "!LOG_FILE!"

:: 1. 检查数据库文件是否存在
if not exist "!DB_FILE!" (
    echo [%date% %time%] [错误] 数据库文件不存在: !DB_FILE! >> "!LOG_FILE!"
    echo [错误] 数据库文件不存在: !DB_FILE!
    exit /b 1
)

:: 2. 确保备份目录存在
if not exist "!BACKUP_DIR!" (
    mkdir "!BACKUP_DIR!"
    echo [%date% %time%] 创建备份目录: !BACKUP_DIR! >> "!LOG_FILE!"
)

:: 3. 生成备份文件名（时间戳格式：20240824_023000）
for /f "tokens=1,2 delims= " %%a in ("%date% %time%") do (
    set BACKUP_DATE=%%a
    set BACKUP_TIME=%%b
)

:: 转换日期格式：2024/08/24 → 20240824
set BACKUP_DATE=!BACKUP_DATE:/=!
set BACKUP_TIME=!BACKUP_TIME::=!
set BACKUP_TIME=!BACKUP_TIME: =0!
set BACKUP_NAME=dialer_!BACKUP_DATE:_=!_!BACKUP_TIME!.db
set BACKUP_PATH=!BACKUP_DIR!\!BACKUP_NAME!

:: 4. 执行 SQLite 在线备份（使用 Python + sqlite3）
call "%PROJECT_ROOT%\venv\Scripts\activate.bat" >nul 2>&1

"%PROJECT_ROOT%\venv\Scripts\python.exe" -c "
import sqlite3, shutil, os, sys
db_file = r'%DB_FILE%'
backup_path = r'%BACKUP_PATH%'
try:
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    cursor.execute('PRAGMA integrity_check;')
    result = cursor.fetchone()
    if result[0] == 'ok':
        conn.close()
        shutil.copy2(db_file, backup_path)
        print(f'OK: {backup_path}')
        sys.exit(0)
    else:
        print('WARN: integrity_check failed, still backing up...')
        conn.close()
        shutil.copy2(db_file, backup_path)
        sys.exit(0)
except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
"

if %errorlevel% neq 0 (
    echo [%date% %time%] [错误] 备份失败 >> "!LOG_FILE!"
    echo [错误] 备份失败，请检查日志
    exit /b 1
)

:: 5. 写入日志
echo [%date% %time%] [OK] 备份成功: !BACKUP_NAME! >> "!LOG_FILE!"
echo [OK] 备份完成: !BACKUP_NAME!

:: 6. 删除超过保留天数的旧备份
echo [%date% %time%] 开始清理旧备份（保留 !RETAIN_DAYS! 天）>> "!LOG_FILE!"

forfiles /p "!BACKUP_DIR!" /m *.db /d -!RETAIN_DAYS! /c "cmd /c del @path" 2>nul

:: 统计备份文件数量
for /f %%c in ('dir /b /a-d "!BACKUP_DIR!\dialer_*.db" 2^>nul ^| find /c /v ""') do set FILE_COUNT=%%c
echo [%date% %time%] 当前备份数量: !FILE_COUNT! 个 >> "!LOG_FILE!"
echo 当前保留 !FILE_COUNT! 个备份文件（最多 !RETAIN_DAYS! 个）

:: 7. 备份 .env 文件（勿删！生产重要配置）
if exist "%PROJECT_ROOT%\.env" (
    copy "%PROJECT_ROOT%\.env" "!BACKUP_DIR!\.env.backup" /Y >nul 2>&1
    echo [%date% %time%] .env 备份更新 >> "!LOG_FILE!"
)

echo [%date% %time%] === 数据库备份完成 === >> "!LOG_FILE!"
echo.
echo 备份完成！文件位置: !BACKUP_PATH!
echo.

:: ============================================================
:: 手动恢复方法（生产故障时用）：
:: 1. 停止服务: taskkill /F /IM python.exe
:: 2. 复制备份文件覆盖: copy backup_path !DB_FILE!
:: 3. 重启服务: start_production.bat
:: ============================================================
