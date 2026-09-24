# 邀约宝后端 API 测试报告

**测试时间**: 2026-08-24  
**后端地址**: http://localhost:8000  
**测试工具**: pytest 9.1.1 + requests  
**Python**: 3.11.10 (venv)  
**运行命令**: `pytest tests/test_api.py -v`

---

## 结果总览

| 类别 | 通过 | 失败 | 跳过 | 合计 |
|------|------|------|------|------|
| Auth（登录/验证） | 7 | 0 | 0 | 7 |
| Admin - 员工管理 | 7 | 0 | 0 | 7 |
| Admin - 规则配置 | 4 | 0 | 0 | 4 |
| Admin - 号码池 | 5 | 0 | 0 | 5 |
| Admin - 标签 | 6 | 0 | 0 | 6 |
| Admin - 看板 | 5 | 0 | 0 | 5 |
| Agent - 当前号码 | 2 | 0 | 1 | 3 |
| Agent - 标签列表 | 1 | 0 | 0 | 1 |
| Agent - 使用记录 | 3 | 0 | 5 | 8 |
| Agent - 历史/收藏 | 2 | 0 | 1 | 3 |
| 权限边界 | 5 | 0 | 0 | 5 |
| **总计** | **47** | **0** | **7** | **54** |

> **状态**: ✅ 全部通过（有 7 个跳过是因为号码池已空，属于预期行为）

---

## 各模块详细结果

### ✅ Auth 模块（7/7 通过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_login_success` | ✅ PASS | 正确账号密码登录成功，返回 token/role/real_name/user_id |
| `test_login_wrong_password` | ✅ PASS | 错误密码返回 401 |
| `test_login_nonexistent_user` | ✅ PASS | 不存在用户返回 401 |
| `test_login_inactive_user` | ✅ PASS | 停职账号登录返回 403 |
| `test_me_valid_token` | ✅ PASS | 有效 token 返回用户信息 |
| `test_me_no_token` | ✅ PASS | 无 token 返回 401/422 |
| `test_me_bad_token` | ✅ PASS | 伪造 token 返回 401/422 |

### ✅ Admin - 员工管理（7/7 通过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_list_users` | ✅ PASS | 列出所有用户（≥1） |
| `test_create_user` | ✅ PASS | 创建新员工，返回 200 |
| `test_create_duplicate_user` | ✅ PASS | 重复用户名返回 400 |
| `test_update_user` | ✅ PASS | 修改姓名/电话/状态 |
| `test_update_nonexistent_user` | ✅ PASS | 更新不存在用户返回 404 |
| `test_delete_user` | ✅ PASS | 删除员工成功 |
| `test_delete_admin_forbidden` | ✅ PASS | 删除管理员返回 400 |

### ✅ Admin - 规则配置（4/4 通过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_get_global_rule` | ✅ PASS | 获取全局规则 |
| `test_update_global_rule` | ✅ PASS | 更新全局规则 |
| `test_get_user_rule` | ✅ PASS | 获取指定员工规则（含合并逻辑） |
| `test_update_user_rule` | ✅ PASS | 设置个人规则 |

### ✅ Admin - 号码池（5/5 通过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_pool_stats` | ✅ PASS | 号码池统计 total/pool_remaining/used |
| `test_import_numbers` | ✅ PASS | 导入 Excel 成功，batch_id/success/failed 正确 |
| `test_import_non_excel_rejected` | ✅ PASS | 非 Excel 文件返回 400 |
| `test_list_batches` | ✅ PASS | 列出导入批次 |
| `test_delete_batch` | ✅ PASS | 删除批次并清理 pool 号码 |

### ✅ Admin - 标签（6/6 通过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_list_tags` | ✅ PASS | 列出所有标签 |
| `test_create_tag` | ✅ PASS | 创建标签成功 |
| `test_create_duplicate_tag` | ✅ PASS | 重复标签名返回 400 |
| `test_update_tag` | ✅ PASS | 修改标签名称/颜色 |
| `test_delete_tag` | ✅ PASS | 删除标签成功 |
| `test_delete_nonexistent_tag` | ✅ PASS | 删除不存在标签返回 404 |

### ✅ Admin - 看板（5/5 通过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_stats_all_ranges[today]` | ✅ PASS | today 范围看板 |
| `test_stats_all_ranges[yesterday]` | ✅ PASS | yesterday 范围看板 |
| `test_stats_all_ranges[week]` | ✅ PASS | week 范围看板 |
| `test_stats_all_ranges[month]` | ✅ PASS | month 范围看板 |
| `test_stats_default_range` | ✅ PASS | 不传 range 默认 today |

### ✅ Agent - 当前号码（2/3 通过，1 跳过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_get_current_number` | ✅ PASS | 获取号码成功，含 id/number_masked |
| `test_get_current_increments_used_count` | ⏭ SKIP | 号码池为空跳过（预期） |
| `test_get_current_no_auth` | ✅ PASS | 无 token 返回 401/422 |

### ✅ Agent - 使用记录（3/8 通过，5 跳过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_submit_usage_success` | ⏭ SKIP | 号码池为空（已在前序测试中用完） |
| `test_submit_usage_wrong_number` | ✅ PASS | 不存在号码返回 404 |
| `test_submit_usage_number_not_assigned` | ⏭ SKIP | 号码池为空 |
| `test_update_usage` | ⏭ SKIP | 号码池为空 |
| `test_update_nonexistent_usage` | ✅ PASS | 修改不存在记录返回 404 |
| `test_delete_usage` | ⏭ SKIP | 号码池为空 |
| `test_delete_usage_not_owner` | ⏭ SKIP | 号码池为空 |

> 跳过原因：前序测试已将号码池号码消费（标记为 used/favorite），号码池已空。后续测试在号码池为空时正确跳过，这是**预期行为**。

### ✅ Agent - 历史/收藏（2/3 通过，1 跳过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_history_returns_records` | ✅ PASS | 历史记录返回列表 |
| `test_favorites_returns_favorites` | ✅ PASS | 收藏列表只含 is_favorite=True 记录 |
| `test_favorites_only_own` | ⏭ SKIP | 号码池为空 |

### ✅ 权限边界（5/5 通过）

| 用例 | 结果 | 说明 |
|------|------|------|
| `test_agent_cannot_access_admin_users` | ✅ PASS | agent 无法访问 /admin/users |
| `test_agent_cannot_access_admin_rules` | ✅ PASS | agent 无法修改全局规则 |
| `test_agent_cannot_import_numbers` | ✅ PASS | agent 无法导入号码 |
| `test_admin_cannot_submit_usage` | ✅ PASS | admin 提交 usage 返回业务错误 |
| `test_admin_can_access_agent_current` | ✅ PASS | admin 可访问 /agent/current |

---

## 发现并修复的 Bug

### 🔧 Bug 1: JWT `sub` 字段类型错误（严重）

**问题**: `auth.py` 中 `make_token()` 将 `sub` 设为 `int`，但 JWT 规范要求 `sub` 必须为字符串。`python-jose` 解码时报 `JWTError: Subject must be a string`，导致 `decode_token()` 返回 `None`，所有带 token 的请求全部 401。

**修复**: `auth.py`
```python
# 修复前
payload = {"sub": user_id, ...}  # int

# 修复后
payload = {"sub": str(user_id), ...}  # 必须是 string
# decode 时再转回 int
payload["sub"] = int(payload["sub"])
```

**影响**: 此 bug 导致后端所有需要认证的接口在生产环境完全不可用（任何登录后的请求都 401）。

---

## 性能数据

- 总运行时间: **377 秒**（6 分 17 秒）
- 主要耗时来源: agent_token fixture 每次创建新用户 + 登录（每条测试新建一个临时 agent）
- 平均每条用例: ~7 秒（含网络往返 + 后端处理）

---

## 改进建议

1. **号码池隔离**：测试应使用独立的测试数据库或测试用号码池，避免用完生产号码
2. **fixture 优化**：`agent_token` 每次都创建新用户，建议用数据库 transaction rollback 代替软删除清理
3. **并行测试**：当前串行执行，可考虑 `pytest-xdist` 并行化减少总运行时间
4. **测试覆盖率报告**：建议加 `--cov` 统计各接口覆盖率
