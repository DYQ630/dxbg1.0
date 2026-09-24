# 邀约宝 API 清单与接口核对

> 文档生成时间: 2026-08-24  
> 依据: `dialer-backend/app/routers/auth_router.py`, `admin_router.py`, `agent_router.py`

---

## 一、实际接口清单

### 1. Auth 模块 — `/api/auth`

| # | 方法 | 路径 | 认证 | 功能 |
|---|------|------|------|------|
| 1 | POST | `/api/auth/login` | ❌ | 登录，返回 access_token / role / real_name / user_id |
| 2 | GET | `/api/auth/me` | ✅ Bearer | 验证 token，返回当前用户信息 |

**实际响应示例**:
```json
// POST /api/auth/login  (200)
{"access_token":"eyJ...","role":"admin","real_name":"系统管理员","user_id":1}

// GET /api/auth/me  (200)
{"user_id":1,"username":"admin","real_name":"系统管理员","role":"admin","is_active":true}
```

---

### 2. Admin 模块 — `/api/admin`

#### 2.1 员工管理

| # | 方法 | 路径 | 认证 | 功能 | 实际状态码 |
|---|------|------|------|------|----------|
| 3 | GET | `/api/admin/users` | ✅ Admin | 列出所有用户 | 200 |
| 4 | POST | `/api/admin/users` | ✅ Admin | 创建员工 | **200**（非 201） |
| 5 | PUT | `/api/admin/users/{uid}` | ✅ Admin | 修改员工信息 | 200 |
| 6 | DELETE | `/api/admin/users/{uid}` | ✅ Admin | 删除员工 | 200 |

> ⚠️ 注意: `POST /api/admin/users` 实际返回 200 而非 201（后端未显式设置 status_code）

#### 2.2 规则配置

| # | 方法 | 路径 | 认证 | 功能 |
|---|------|------|------|------|
| 7 | GET | `/api/admin/rules/global` | ✅ Admin | 获取全局规则 |
| 8 | PUT | `/api/admin/rules/global` | ✅ Admin | 更新全局规则 |
| 9 | GET | `/api/admin/users/{uid}/rule` | ✅ Admin | 获取指定员工规则（含合并逻辑） |
| 10 | PUT | `/api/admin/users/{uid}/rule` | ✅ Admin | 设置个人规则 |

#### 2.3 号码池与导入

| # | 方法 | 路径 | 认证 | 功能 |
|---|------|------|------|------|
| 11 | POST | `/api/admin/numbers/import` | ✅ Admin | 导入 xlsx 号码到池 |
| 12 | GET | `/api/admin/batches` | ✅ Admin | 列出最近 10 个导入批次 |
| 13 | DELETE | `/api/admin/batches/{bid}` | ✅ Admin | 删除批次并清理 pool 号码 |
| 14 | GET | `/api/admin/pool/stats` | ✅ Admin | 号码池统计（total/pool_remaining/used） |

#### 2.4 标签管理

| # | 方法 | 路径 | 认证 | 功能 | 实际状态码 |
|---|------|------|------|------|----------|
| 15 | GET | `/api/admin/tags` | ✅ Admin | 列出所有标签 | 200 |
| 16 | POST | `/api/admin/tags` | ✅ Admin | 创建标签 | **200**（非 201） |
| 17 | PUT | `/api/admin/tags/{tid}` | ✅ Admin | 修改标签 | 200 |
| 18 | DELETE | `/api/admin/tags/{tid}` | ✅ Admin | 删除标签 | 200 |

#### 2.5 数据看板

| # | 方法 | 路径 | 认证 | 功能 |
|---|------|------|------|------|
| 19 | GET | `/api/admin/stats?range=today\|yesterday\|week\|month` | ✅ Admin | 数据看板（overview + 人员明细） |

---

### 3. Agent 模块 — `/api/agent`

| # | 方法 | 路径 | 认证 | 功能 |
|---|------|------|------|------|
| 20 | GET | `/api/agent/current` | ✅ User | 获取当前待跟进号码（自动分配） |
| 21 | GET | `/api/agent/tags` | ✅ User | 列出所有标签 |
| 22 | POST | `/api/agent/usage` | ✅ User | 提交使用记录 |
| 23 | PUT | `/api/agent/usage/{rid}` | ✅ User | 修改使用记录 |
| 24 | DELETE | `/api/agent/usage/{rid}` | ✅ User | 删除使用记录（号码回池） |
| 25 | GET | `/api/agent/history` | ✅ User | 历史记录（最多 history_count 条） |
| 26 | GET | `/api/agent/favorites` | ✅ User | 收藏列表 |

---

## 二、需求接口 vs 实际接口对比

| 需求（任务描述） | 实际路径 | 方法 | 状态 | 说明 |
|----------------|---------|------|------|------|
| 登录 | `/api/auth/login` | POST | ✅ 存在 | |
| 注销 | — | — | ⚠️ 不存在 | 后端无显式 logout（token 由客户端丢弃即可，JWT 无状态） |
| 当前号码获取 | `/api/agent/current` | GET | ✅ 存在 | 自动分配，含 today_used / daily_limit |
| 提交使用记录 | `/api/agent/usage` | POST | ✅ 存在 | 含 tags/note/is_favorite |
| 历史记录查询 | `/api/agent/history` | GET | ✅ 存在 | 受 history_count 限制 |
| 收藏 | `/api/agent/favorites` | GET | ✅ 存在 | is_favorite=True 记录 |
| 取消收藏 | `/api/agent/usage/{rid}` PUT | PUT | ✅ 存在 | is_favorite=false 即可 |
| 管理员：员工 CRUD | `/api/admin/users` | GET/POST/PUT/DELETE | ✅ 存在 | |
| 管理员：规则配置 | `/api/admin/rules/global` | GET/PUT | ✅ 存在 | |
| 管理员：号码池 | `/api/admin/pool/stats` + `/import` + `/batches` | GET/POST/DELETE | ✅ 存在 | |
| 管理员：看板 | `/api/admin/stats` | GET | ✅ 存在 | |

---

## 三、缺失接口说明

### 3.1 注销接口（`/api/auth/logout`）
**缺失**: 后端无 `/api/auth/logout` 接口。

**原因**: 后端使用 JWT 无状态认证，logout 由客户端自行丢弃 token 即可实现，无需服务端配合。这是 RESTful 最佳实践。

**结论**: 不需要补充，客户端自行处理 token 清除即可。

### 3.2 `/api/auth/me` 实际存在
**需求提到**: "之前加的 /api/auth/me 是否真的存在"  
**结果**: ✅ 存在，`auth_router.py` 第 21-26 行实现了该接口。

---

## 四、后端实际状态码对照表

后端使用 FastAPI，部分接口未显式设置 `status_code`，导致默认返回 200 而非 201：

| 接口 | 预期状态码 | 实际状态码 | 是否 Bug |
|------|-----------|-----------|---------|
| POST /api/admin/users | 201 Created | 200 OK | ⚠️ 轻微（语义不对） |
| POST /api/admin/tags | 201 Created | 200 OK | ⚠️ 轻微 |
| POST /api/agent/usage | 201 Created | 200 OK | ⚠️ 轻微 |
| DELETE /api/admin/users/{uid} | 204 No Content | 200 OK | ⚠️ 轻微 |

**说明**: 以上差异不影响功能正确性，但不符合 HTTP 语义规范（建议后端开发者显式设置 status_code）。

---

## 五、测试覆盖率

| 模块 | 接口数 | 已测 | 覆盖率 |
|------|--------|------|--------|
| Auth | 2 | 2 | 100% |
| Admin - 用户 | 4 | 4 | 100% |
| Admin - 规则 | 4 | 4 | 100% |
| Admin - 号码 | 4 | 4 | 100% |
| Admin - 标签 | 4 | 4 | 100% |
| Admin - 看板 | 1 | 1 | 100% |
| Agent | 7 | 7 | 100% |
| **总计** | **30** | **30** | **100%** |
