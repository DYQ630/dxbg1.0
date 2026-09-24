# 邀约宝后端 — 生产环境部署指南

> 目标：将 FastAPI 后端部署到腾讯云轻量应用服务器，域名 HTTPS 访问，支持微信小程序调用。  
> 适用人群：有基本服务器操作经验，想一次性搞定备案+SSL+部署的开发者。

---

## 目录

1. [服务器选购](#1-服务器选购)
2. [域名购买与解析](#2-域名购买与解析)
3. [HTTPS 证书申请](#3-https-证书申请)
4. [ICP 备案完整流程](#4-icp-备案完整流程)
5. [备案后小程序域名配置](#5-备案后小程序域名配置)
6. [服务器端环境初始化](#6-服务器端环境初始化)
7. [后端部署步骤](#7-后端部署步骤)
8. [Nginx 反向代理配置](#8-nginx-反向代理配置)
9. [进程守护配置](#9-进程守护配置)
10. [每日自动备份](#10-每日自动备份)
11. [验证部署是否成功](#11-验证部署是否成功)

---

## 1. 服务器选购

### 1.1 推荐配置

| 项目 | 推荐值 |
|------|--------|
| 厂商 | 腾讯云轻量应用服务器（Lighthouse） |
| 地域 | **广州** 或 **上海**（备案需与域名注册商一致） |
| 系统 | **Windows Server 2022 中文版**（或 2019） |
| 套餐 | 4 核 CPU / 4 GB 内存 / 80 GB SSD / 4 Mbps 流量 |
| 带宽计费模式 | 包年包月（年付约 600~800 元） |
| 促销活动 | 腾讯云新用户首单 100~200 元/年，关注官网活动页 |

### 1.2 购买步骤（图文级）

1. 访问 [腾讯云轻量应用服务器购买页](https://cloud.tencent.com/product/lighthouse)
2. 点击 **立即选购**
3. 选择：
   - **地域**：广州 / 上海（备案用户推荐）
   - **应用镜像**：选择 Windows Server 2022（含中文）
   - **套餐**：选择 4C4G 那档
   - **购买时长**：1 年（享折扣）
4. 设置 **登录密码**（务必记录！）
5. 点击 **立即购买 → 支付**
6. 购买成功后，进入 **[云服务器控制台](https://console.cloud.tencent.com/lighthouse)**
7. 找到刚买的服务器，点击右侧 **登录**（用 admin 账号 + 刚才设置的密码）

### 1.3 服务器准备（登录后第一件事）

打开 PowerShell（管理员），执行：

```powershell
# 更新系统
sconfig

# 或直接在 PowerShell 里执行：
sfc /scannow
DISM /Online /Cleanup-Image /RestoreHealth
```

### 1.4 开放防火墙端口

> ⚠️ 重要！腾讯云有**两层防火墙**：
> - Windows 防火墙（服务器内）
> - 腾讯云安全组（云端控制台）

**腾讯云安全组配置（必须做）：**

1. 进入 [云服务器控制台](https://console.cloud.tencent.com/lighthouse) → 点击服务器 → **防火墙**
2. 点击 **添加规则**，开放以下端口：

| 协议 | 端口 | 说明 |
|------|------|------|
| TCP | 80 | HTTP |
| TCP | 443 | HTTPS |
| TCP | 3389 | 远程桌面 RDP |
| TCP | 8000 | 后端 API 端口（仅内网/白名单访问）|

> 💡 生产环境建议 8000 端口只允许 `127.0.0.1` 访问，通过 Nginx 对外暴露 443。

---

## 2. 域名购买与解析

### 2.1 购买域名

推荐在**腾讯云**购买（方便后续一站式备案）：

1. 访问 [腾讯云域名注册](https://console.cloud.tencent.com/domain)
2. 搜索想注册的域名（如 `yaoyuebao.cn`）
3. `.cn` 域名首年约 **30 元**，选择一年购买
4. 实名认证（个人用身份证，企业用营业执照）

### 2.2 域名解析配置

1. 进入 [DNS 解析 DNSPod 控制台](https://console.cloud.tencent.com/dns)
2. 点击 **添加域名**，填入你买的域名
3. 添加记录：

| 主机记录 | 记录类型 | 记录值 | TTL |
|----------|----------|--------|-----|
| `@` | A | 你的服务器公网 IP | 600 |
| `www` | A | 你的服务器公网 IP | 600 |
| `api` | A | 你的服务器公网 IP | 600 |

> 如何查服务器公网 IP：  
> 腾讯云控制台 → 轻量应用服务器 → 点击实例 → 查看 **公网 IP**

---

## 3. HTTPS 证书申请

### 3.1 使用腾讯云免费 SSL 证书

腾讯云提供 **TrustAsia DV SSL 证书（免费版）**，有效期 1 年，自动续期。

#### 申请步骤：

1. 进入 [腾讯云 SSL 证书控制台](https://console.cloud.tencent.com/ssl)
2. 点击 **申请免费证书**
3. 填写信息：
   - 证书绑定域名：填你的域名（如 `yaoyuebao.cn`，不含 www）
   - 所属域名分组：默认
   - 证书请求方式：**自动 DNS 验证**（推荐）
   - 联系人：填自己信息
4. 点击 **提交审核**
5. 等待约 **5 分钟**，证书自动签发

#### 下载证书（用于 Nginx）：

1. 证书签发后，在证书列表找到该证书
2. 点击 **下载** → 选择 **Nginx** 版本
3. 下载后得到一个 `.zip` 包，解压后包含：
   ```
   你的域名_ssl/
   ├── 你的域名.key      ← 私钥（绝对保密！）
   └── 你的域名.pem      ← 证书
   ```
4. 把这两个文件上传到服务器 `D:\dialer\certs\` 目录

---

## 4. ICP 备案完整流程

> 这是最重要的环节！没有备案，域名就无法通过 HTTPS 对国内小程序开放。

### 4.1 前置条件

- ✅ 域名已完成实名认证（个人或企业）
- ✅ 服务器购买时长 ≥ 3 个月（腾讯云要求）
- ✅ 主体（个人/企业）未在其他平台有备案或已完成备案接入

### 4.2 备案入口

进入 [腾讯云备案控制台](https://console.cloud.tencent.com/beian)，点击 **开始备案**。

### 4.3 备案材料清单

#### 个人备案需要：
| 材料 | 说明 |
|------|------|
| 身份证正反面照片 | 清晰、无反光 |
| 域名证书 | 从腾讯云域名控制台下载 |
| 幕布照片 | 腾讯云提供免费幕布，邮寄或自取 |
| 手机号 | 需接收验证码 |
| 应急联系电话 | 填亲友手机号 |

#### 企业备案需要：
| 材料 | 说明 |
|------|------|
| 营业执照副本照片 | 复印件加盖公章也可以 |
| 法人身份证正反面 | 清晰 |
| 网站负责人身份证 | 可以同法人 |
| 域名证书 | 从腾讯云域名控制台下载 |
| 幕布照片 | 腾讯云提供 |
| 手机号 | 网站负责人手机 |

### 4.4 详细备案步骤

#### 第一步：填写主体信息

1. 选择备案地区：**省 / 市**（选你服务器所在地）
2. 选择备案性质：**个人** 或 **企业**
3. 填写主办单位信息：
   - 个人：姓名、手机、身份证、紧急联系电话
   - 企业：企业名称、统一社会信用代码、法人姓名、法人手机、法人身份证

#### 第二步：填写网站信息

- 网站名称：填你小程序的名称（如「邀约宝」），不要带「官网」「论坛」等限定词
- 网站首页 URL：`https://yaoyuebao.cn`
- 网站服务内容：选择「生活服务」或「商务服务」
- 是否有前置审批：无
- 网站语言：简体中文

#### 第三步：上传材料

1. 上传身份证正反面（个人）或营业执照+法人身份证（企业）
2. 电子化幕布拍照：腾讯云 app 扫码，实时拍照上传
3. 下载《网站备案信息真实性承诺书》，电子签名上传

#### 第四步：短信核验

腾讯云提交后，工信部会发短信到你手机，回复短信验证码完成核验。

#### 第五步：初审

- 腾讯云审核：约 **1 个工作日**，客服会打电话核实
- 如有问题，按客服要求修改后重新提交

#### 第六步：管局审核

- 初审通过后提交至通信管理局
- 审核时间：**7~20 个工作日**（各省份不同，广东约 10 天）
- 期间网站不可访问，但服务器可以正常ping通

#### 第七步：备案成功

收到短信/邮件通知后，备案号会挂在工信部网站查询：
https://beian.miit.gov.cn

> ⚠️ 备案成功后，记得把备案号放在小程序底部「关于我们」页面。

---

## 5. 备案后小程序域名配置

### 5.1 登录微信公众平台

访问 https://mp.weixin.qq.com → 登录小程序账号

### 5.2 配置服务器域名

1. 进入 **开发管理** → **开发设置**
2. 找到 **服务器域名** → 点击 **修改**
3. 添加以下合法域名：

| 域名类型 | 填写内容 |
|----------|----------|
| request 合法域名 | `https://api.yaoyuebao.cn` |
| uploadFile 合法域名 | `https://api.yaoyuebao.cn` |
| downloadFile 合法域名 | `https://api.yaoyuebao.cn` |

3. 点击 **保存**（需管理员扫码确认）

### 5.3 配置业务域名（WebView）

如果小程序有 webview 页面（嵌入网页），还需配置**业务域名**：

1. 在 `业务域名` 栏点击 **添加**
2. 填入：`api.yaoyuebao.cn`（只需填域名，不需要 https://）
3. 下载验证文件，上传到服务器 Nginx 对应目录

---

## 6. 服务器端环境初始化

### 6.1 安装 Python 3.11+

在 Windows Server 上通过 PowerShell 安装：

```powershell
# 用 winget 安装 Python（推荐）
winget install Python.Python.3.11

# 或者下载安装包：
# 访问 https://www.python.org/downloads/
# 下载 Windows installer (64-bit)
# 安装时勾选 "Add Python to PATH"

# 验证
python --version
# 应显示 Python 3.11.x 或更高
```

### 6.2 创建项目目录

```powershell
# 创建目录结构
New-Item -ItemType Directory -Path "D:\dialer" -Force
New-Item -ItemType Directory -Path "D:\dialer\app" -Force
New-Item -ItemType Directory -Path "D:\dialer\data" -Force
New-Item -ItemType Directory -Path "D:\dialer\logs" -Force
New-Item -ItemType Directory -Path "D:\dialer\certs" -Force
New-Item -ItemType Directory -Path "D:\dialer\deploy" -Force
```

### 6.3 创建虚拟环境

```powershell
cd D:\dialer

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
.\venv\Scripts\Activate.ps1

# 升级 pip
python -m pip install --upgrade pip
```

### 6.4 安装依赖

```powershell
pip install fastapi uvicorn[standard] sqlalchemy aiosqlite python-multipart
pip install openpyxl xlrd                           # Excel 导入
pip install pydantic-settings                       # 环境变量
pip install httpx                                  # HTTP 客户端
pip install waitress                                # Windows 生产服务器
pip install python-dotenv                          # .env 文件支持
pip install gunicorn                               # Linux 备选（Windows 忽略）
pip install psutil                                  # 系统监控
```

---

## 7. 后端部署步骤

### 7.1 上传代码到服务器

**方式一：FTP 上传（推荐）**

1. 在腾讯云控制台安装 FTP 服务：
   ```powershell
   # 在服务器上安装 FileZilla Server（自行搜索安装包）
   # 配置 FTP 用户：dialer_user，目录：D:\dialer
   ```
2. 用 FileZilla Client 连接，上传整个后端项目

**方式二：Git 拉取（推荐）**

```powershell
cd D:\dialer
git clone https://your-git-repo/dialer-backend.git .
```

### 7.2 配置环境变量

在 `D:\dialer` 目录创建 `.env` 文件：

```env
# 数据库配置（Windows 路径）
DATABASE_URL=sqlite:///D:/dialer/data/dialer.db

# 安全密钥（务必修改为随机字符串！）
SECRET_KEY=change_me_to_a_random_32_char_string_here

# 日志目录
LOG_DIR=D:/dialer/logs

# 服务模式
ENV=production

# API 服务端口
API_PORT=8000
```

### 7.3 初始化数据库

```powershell
cd D:\dialer
.\venv\Scripts\Activate.ps1
python -c "from app.database import engine, Base; Base.metadata.create_all(bind=engine)"
echo "数据库初始化完成"
```

---

## 8. Nginx 反向代理配置

### 8.1 Windows 安装 Nginx

1. 下载 [Nginx for Windows](https://nginx.org/en/download.html)（选择最新稳定版）
2. 解压到 `D:\nginx`
3. 将 SSL 证书文件放入 `D:\nginx\conf\certs\`

### 8.2 关键配置说明

配置文件为 `dialer-backend/deploy/nginx-with-https.conf`，核心逻辑如下：

```
用户请求 (HTTPS 443)
       ↓
   Nginx（反向代理）
    - 验证 SSL 证书
    - 处理 HTTP 自动跳转 HTTPS
    - 反代到 localhost:8000
       ↓
   Waitress（FastAPI 后端，端口 8000）
```

### 8.3 启动 Nginx

```powershell
# 检查配置语法
D:\nginx\nginx.exe -t

# 启动 Nginx
D:\nginx\nginx.exe

# 重载配置
D:\nginx\nginx.exe -s reload
```

---

## 9. 进程守护配置

### 方案一：Windows 服务（推荐）

用 `NSSM`（Non-Sucking Service Manager）将 Waitress 注册为 Windows 服务：

```powershell
# 下载 nssm：https://nssm.cc/download
# 解压到 D:\tools\nssm

# 注册服务
D:\tools\nssm\nssm.exe install DialerBackend "D:\dialer\venv\Scripts\waitress-serve.exe"
D:\tools\nssm\nssm.exe set DialerBackend AppParameters " --port=8000 app.main:app"
D:\tools\nssm\nssm.exe set DialerBackend AppDirectory "D:\dialer"
D:\tools\nssm\nssm.exe set DialerBackend AppEnvironmentExtra "DATABASE_URL=D:/dialer/data/dialer.db;SECRET_KEY=your_secret;LOG_DIR=D:/dialer/logs"

# 启动服务
net start DialerBackend
```

### 方案二：PM2（需 Node.js）

```powershell
# 安装 Node.js
winget install OpenJS.NodeJS

# 全局安装 pm2
npm install -g pm2

# 启动（用 pm2 ecosystem file）
pm2 start dialer-backend/deploy/pm2-start.json
pm2 save
pm2 startup
```

---

## 10. 每日自动备份

### 10.1 手动备份

```powershell
# 在 PowerShell 中
$date = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item "D:\dialer\data\dialer.db" "D:\dialer\backups\dialer_$date.db"
echo "备份完成: dialer_$date.db"
```

### 10.2 配置 Windows 任务计划程序

1. 打开 **任务计划程序**（开始菜单搜索「任务计划程序」）
2. 点击右侧 **创建基本任务**
3. 填写：
   - 名称：`每日数据库备份`
   - 触发器：每天，凌晨 2:00
4. 操作：启动程序
   - 程序：`powershell.exe`
   - 参数：`-ExecutionPolicy Bypass -File "D:\dialer\deploy\backup.bat"`
5. 完成后点击 **确定**，输入服务器登录密码

详细步骤见：`dialer-backend/deploy/BACKUP_TASK_WINDOWS.md`

---

## 11. 验证部署是否成功

### 11.1 检查服务状态

```powershell
# 检查 Waitress 进程
tasklist | findstr waitress

# 检查端口占用
netstat -ano | findstr ":8000"
netstat -ano | findstr ":443"
netstat -ano | findstr ":80"

# 检查 Nginx
tasklist | findstr nginx
```

### 11.2 访问测试

| 测试地址 | 预期结果 |
|----------|----------|
| `http://api.yaoyuebao.cn/health` | HTTP 302 → 跳转到 HTTPS |
| `https://api.yaoyuebao.cn/health` | 返回 `{"status":"ok"}` |
| `https://api.yaoyuebao.cn/docs` | Swagger API 文档 |
| `https://api.yaoyuebao.cn/api/v1/contacts` | API 正常响应 |

### 11.3 小程序端测试

在微信开发者工具中，关闭「不校验合法域名」选项，测试接口调用是否正常。

---

## 附录：常见问题排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 备案期间 80/443 无法访问 | 管局要求 | 备案成功前用 IP+端口测试后端 |
| HTTPS 证书不生效 | Nginx 配置错误 | `nginx -t` 检查语法，确认证书路径正确 |
| 小程序报「域名不在合法列表」 | 未配置 request 域名 | 在小程序后台开发设置添加域名 |
| 数据库报错「路径不存在」 | 目录未创建 | 先手动创建 `D:\dialer\data` 目录 |
| Waitress 启动失败 | 端口被占用 | `netstat -ano \| findstr 8000` 查进程，关闭占用程序 |
| 备份脚本不执行 | 任务计划程序权限 | 任务属性中勾选「使用最高权限运行」 |

---

> 📞 腾讯云技术支持：拨打 400-9100-100（7×24）  
> 微信小程序客服：在小程序后台右下角联系客服  
> 工信部备案查询：https://beian.miit.gov.cn
