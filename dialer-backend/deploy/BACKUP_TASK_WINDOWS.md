# Windows 任务计划程序配置 - 每日自动备份

> 本指南教你在 Windows Server 上配置**每日凌晨 2:00 自动备份**数据库，全程图形界面操作，无需写代码。

---

## 前置条件

1. 服务器上已完成 `dialer-backend/deploy/setup.bat` 初始化
2. `backup.bat` 脚本位于 `D:\dialer\deploy\backup.bat`
3. 服务器开启**任务计划程序**服务

---

## 第一步：打开任务计划程序

### 方法一（推荐）
1. 按 `Win + R`，输入 `taskschd.msc`，回车

### 方法二
1. 开始菜单 → 搜索「任务计划程序」→ 打开

---

## 第二步：创建基本任务

1. 右侧操作面板 → 点击 **「创建基本任务」**
2. 弹出向导，按以下步骤操作

---

## 第三步：填写任务基本信息

```
名称(N):   邀约宝 - 每日数据库备份
描述(D):   每日凌晨2点自动备份SQLite数据库，保留7天
```

点击 **下一步**。

---

## 第四步：设置触发器（执行时间）

```
触发时机:   每天
开始时间:   2:00:00
间隔:       1 天
```

点击 **下一步**。

---

## 第五步：设置操作（执行什么）

```
操作:      启动程序
```

点击 **下一步**，填写：

```
程序或脚本:  powershell.exe
添加参数:    -ExecutionPolicy Bypass -File "D:\dialer\deploy\backup.bat"
起始位置:    D:\dialer\deploy
```

> ⚠️ 路径必须用**双引号**括起来（如果路径有空格）
> ⚠️ 建议先用记事本打开 `backup.bat` 确认内容无误

---

## 第六步：确认完成

勾选两项：
- ☑ **打开此任务属性对话框**（立即配置权限）
- ☑ **当用户登录或开机时运行**（服务器建议勾选）

点击 **完成**。

---

## 第七步：配置任务属性（关键！）

在打开的属性对话框中：

### 7.1 设置「用户账户」（重要）

```
用户账户:   SYSTEM（本地系统）
☑ 不管是否登录都运行
☑ 运行最高权限
```

> 如果没有 SYSTEM 选项，选择 ** Administrators ** 组，确保勾选「☑ 运行最高权限」

### 7.2 设置「条件」

```
☑ 只在启用网络连接时开始    ← 取消勾选（或保留）
☑ 如果挂起则停止              ← 建议勾选（省资源）
```

### 7.3 设置「设置」

```
☑ 允许按需启动任务
☑ 如果任务失败，每隔1分钟重启，重试3次
☑ 如果任务在计划时间后100分钟内未启动，则重启
```

点击 **确定**。

---

## 第八步：输入密码（如果选择了特定用户）

如果选择了 `SYSTEM` 账户，不需要密码（系统内置）。

如果选择了你的管理员账户，会弹出要求输入密码的对话框。

---

## 验证任务是否创建成功

1. 在任务计划程序库中找到 **「邀约宝 - 每日数据库备份」**
2. 右键 → **运行**，立即测试一次
3. 查看 `D:\dialer\logs\backup.log` 确认备份成功

---

## 查看备份日志

```powershell
# 实时查看备份日志
Get-Content "D:\dialer\logs\backup.log" -Wait -Tail 20

# 查看备份目录
Get-ChildItem "D:\dialer\backups" | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, LastWriteTime
```

---

## 常见问题排查

### Q1: 任务不执行，没有任何反应

检查：
1. 任务计划程序服务是否运行？
   ```powershell
   Get-Service "Task Scheduler"
   # 如果是 Stopped，启动它：
   Start-Service "Task Scheduler"
   Set-Service "Task Scheduler" -StartupType Automatic
   ```

2. 任务历史记录是否开启？
   ```powershell
   # 开启步骤：事件查看器 → 应用程序和服务日志 → Microsoft → Windows → TaskScheduler
   ```

### Q2: 任务执行了但报错

错误常见原因：
- `backup.bat` 路径错误 → 检查脚本路径是否正确
- 数据库文件被占用 → 先停止后端服务再备份
- 权限不足 → 确保任务以 SYSTEM 或 Administrator 运行

### Q3: 备份成功但旧文件没删除

`forfiles` 命令在部分 Windows Server 版本有权限问题，替代方案：

编辑 `backup.bat`，在第 6 步删除旧备份部分替换为：

```powershell
:: 删除超过7天的备份（PowerShell版）
call "%PROJECT_ROOT%\venv\Scripts\python.exe" -c "
import os, time
backup_dir = r'%BACKUP_DIR%'
retain_days = %RETAIN_DAYS%
cutoff = time.time() - retain_days * 86400
for f in os.listdir(backup_dir):
    if f.startswith('dialer_') and f.endswith('.db'):
        full = os.path.join(backup_dir, f)
        if os.path.getmtime(full) < cutoff:
            os.remove(full)
            print(f'Deleted: {f}')
"
```

### Q4: 手动运行正常，定时任务不执行

原因：定时任务没有加载用户环境变量，导致 `venv\Scripts\activate.bat` 找不到。

解决方案：使用 Python 虚拟环境的**完整绝对路径**执行：

```powershell
# 修改 backup.bat 中的这行
# 原来：call "%PROJECT_ROOT%\venv\Scripts\activate.bat" >nul 2>&1
# 改为（直接在 venv python 执行备份逻辑）：
"%PROJECT_ROOT%\venv\Scripts\python.exe" "%PROJECT_ROOT%\deploy\backup.py"
```

---

## 进阶：备份到云存储

### 备份到腾讯云 COS（可选）

安装腾讯云 COS SDK：
```powershell
pip install cos-python-sdk-v5
```

在 backup.bat 中加入上传逻辑：
```python
from qcloud_cos import CosConfig, CosS3Client

# 上传到腾讯云 COS
config = CosConfig(Region='ap-guangzhou', SecretId='your_id', SecretKey='your_key')
client = CosS3Client(config)
client.upload_file(
    Bucket='dialer-backup-1250000000',
    Key=f'dialer_backup/{backup_name}',
    LocalFilePath=backup_path
)
```

---

## 一键删除备份任务

如果以后想删除这个定时任务：

```powershell
Unregister-ScheduledTask -TaskName "邀约宝 - 每日数据库备份" -Confirm:$false
```
