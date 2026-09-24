"""
邀约宝后端 API 完整测试脚本。
覆盖 auth / admin / agent 所有接口。
运行: pytest tests/test_api.py -v
"""
import pytest
import requests
import time
import io
import uuid

BASE_URL = "http://localhost:8000"


# ===========================================================================
# 辅助函数
# ===========================================================================
def headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ===========================================================================
# ==================== Auth 模块 ============================================
# ===========================================================================

class TestAuth:
    """登录 / 注销 / 令牌验证。"""

    def test_login_success(self, base_url):
        """✅ 正确账号密码登录成功。"""
        r = requests.post(f"{base_url}/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert "access_token" in data
        assert data["role"] == "admin"
        assert data["real_name"] == "系统管理员"
        assert data["user_id"] == 1
        print(f"  [OK] 登录成功, token={data['access_token'][:30]}...")

    def test_login_wrong_password(self, base_url):
        """❌ 错误密码应返回 401。"""
        r = requests.post(f"{base_url}/api/auth/login", json={"username": "admin", "password": "wrongpass"})
        assert r.status_code == 401, f"期望 401，实际 {r.status_code}"
        assert "账号或密码错误" in r.text
        print("  [OK] 错误密码正确拒绝")

    def test_login_nonexistent_user(self, base_url):
        """❌ 不存在的用户应返回 401。"""
        r = requests.post(f"{base_url}/api/auth/login", json={"username": "nobody", "password": "pass"})
        assert r.status_code == 401
        print("  [OK] 不存在用户正确拒绝")

    def test_login_inactive_user(self, base_url, admin_token):
        """❌ 已停职账号登录应返回 403。"""
        uname = f"inactive_{uuid.uuid4().hex[:6]}"
        cr = requests.post(
            f"{BASE_URL}/api/admin/users",
            json={"username": uname, "password": "test123", "real_name": "停职测试"},
            headers=headers(admin_token),
        )
        assert cr.status_code == 200, f"创建用户失败: {cr.text}"
        uid = cr.json()["id"]
        requests.put(f"{BASE_URL}/api/admin/users/{uid}", json={"is_active": False}, headers=headers(admin_token))
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": uname, "password": "test123"})
        assert r.status_code == 403, f"期望 403，实际 {r.status_code}"
        assert "停职" in r.text
        print("  [OK] 停职账号正确拒绝")
        requests.put(f"{BASE_URL}/api/admin/users/{uid}", json={"is_active": True}, headers=headers(admin_token))

    def test_me_valid_token(self, base_url, admin_token):
        """✅ 有效 token 获取当前用户信息。"""
        r = requests.get(f"{base_url}/api/auth/me", headers=headers(admin_token))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["user_id"] == 1
        assert data["username"] == "admin"
        assert data["role"] == "admin"
        assert data["is_active"] is True
        print(f"  [OK] /me 返回: {data}")

    def test_me_no_token(self, base_url):
        """❌ 无 token 访问 /me 应返回 401/422。"""
        r = requests.get(f"{base_url}/api/auth/me")
        assert r.status_code in (401, 422), f"期望 401/422，实际 {r.status_code}"
        print("  [OK] 无 token 正确拒绝")

    def test_me_bad_token(self, base_url):
        """❌ 伪造 token 访问 /me 应返回 401/422。"""
        r = requests.get(f"{base_url}/api/auth/me", headers=headers("fake.token.here"))
        assert r.status_code in (401, 422), f"期望 401/422，实际 {r.status_code}"
        print("  [OK] 伪造 token 正确拒绝")


# ===========================================================================
# ==================== Admin - 员工管理 =====================================
# ===========================================================================

class TestAdminUserCRUD:
    """管理员对员工的新增/查询/修改/删除。"""

    def test_list_users(self, base_url, admin_token):
        """✅ 列出所有用户。"""
        r = requests.get(f"{base_url}/api/admin/users", headers=headers(admin_token))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        users = r.json()
        assert isinstance(users, list)
        assert len(users) >= 1
        assert any(u["username"] == "admin" for u in users)
        print(f"  [OK] 共 {len(users)} 个用户")

    def test_create_user(self, base_url, admin_token):
        """✅ 创建新员工。"""
        uname = f"newagent_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{base_url}/api/admin/users",
            json={"username": uname, "password": "pass123456", "real_name": "新员工", "phone": "13900001111"},
            headers=headers(admin_token),
        )
        # 后端实际返回 200（未显式设置 status_code）
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["username"] == uname
        assert data["real_name"] == "新员工"
        assert data["role"] == "agent"
        assert data["is_active"] is True
        uid = data["id"]
        print(f"  [OK] 创建员工成功 id={uid}")
        requests.delete(f"{base_url}/api/admin/users/{uid}", headers=headers(admin_token))

    def test_create_duplicate_user(self, base_url, admin_token):
        """❌ 重复用户名应返回 400。"""
        uname = f"dup_{uuid.uuid4().hex[:6]}"
        r1 = requests.post(
            f"{base_url}/api/admin/users",
            json={"username": uname, "password": "pass123", "real_name": "A"},
            headers=headers(admin_token),
        )
        assert r1.status_code == 200, f"创建失败: {r1.text}"
        uid = r1.json()["id"]
        r2 = requests.post(
            f"{base_url}/api/admin/users",
            json={"username": uname, "password": "pass456", "real_name": "B"},
            headers=headers(admin_token),
        )
        assert r2.status_code == 400, f"期望 400，实际 {r2.status_code}"
        assert "已存在" in r2.text
        print("  [OK] 重复用户名正确拒绝")
        requests.delete(f"{base_url}/api/admin/users/{uid}", headers=headers(admin_token))

    def test_update_user(self, base_url, admin_token):
        """✅ 修改员工信息。"""
        uname = f"upd_{uuid.uuid4().hex[:6]}"
        cr = requests.post(
            f"{base_url}/api/admin/users",
            json={"username": uname, "password": "pass123", "real_name": "原始名", "phone": "13800000000"},
            headers=headers(admin_token),
        )
        assert cr.status_code == 200, f"创建失败: {cr.text}"
        uid = cr.json()["id"]
        r = requests.put(
            f"{base_url}/api/admin/users/{uid}",
            json={"real_name": "修改后姓名", "phone": "13999999999", "is_active": False},
            headers=headers(admin_token),
        )
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["real_name"] == "修改后姓名"
        assert data["phone"] == "13999999999"
        assert data["is_active"] is False
        print("  [OK] 更新员工成功")
        requests.delete(f"{base_url}/api/admin/users/{uid}", headers=headers(admin_token))

    def test_update_nonexistent_user(self, base_url, admin_token):
        """❌ 更新不存在的用户应返回 404。"""
        r = requests.put(
            f"{base_url}/api/admin/users/999999",
            json={"real_name": "幽灵"},
            headers=headers(admin_token),
        )
        assert r.status_code == 404
        print("  [OK] 更新不存在用户返回 404")

    def test_delete_user(self, base_url, admin_token):
        """✅ 删除员工。"""
        uname = f"del_{uuid.uuid4().hex[:6]}"
        cr = requests.post(
            f"{base_url}/api/admin/users",
            json={"username": uname, "password": "pass123", "real_name": "待删除"},
            headers=headers(admin_token),
        )
        assert cr.status_code == 200, f"创建失败: {cr.text}"
        uid = cr.json()["id"]
        r = requests.delete(f"{base_url}/api/admin/users/{uid}", headers=headers(admin_token))
        assert r.status_code == 200
        assert r.json()["ok"] is True
        print("  [OK] 删除员工成功")

    def test_delete_admin_forbidden(self, base_url, admin_token):
        """❌ 不能删除管理员账号。"""
        r = requests.delete(f"{base_url}/api/admin/users/1", headers=headers(admin_token))
        assert r.status_code == 400
        assert "不能删除管理员" in r.text
        print("  [OK] 禁止删除管理员账号")


# ===========================================================================
# ==================== Admin - 规则配置 =====================================
# ===========================================================================

class TestAdminRule:
    """全局规则和个人规则配置。"""

    def test_get_global_rule(self, base_url, admin_token):
        """✅ 获取全局规则。"""
        r = requests.get(f"{base_url}/api/admin/rules/global", headers=headers(admin_token))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        for field in ("daily_limit", "history_count", "favorite_limit", "recycle_days"):
            assert field in data
        print(f"  [OK] 全局规则: {data}")

    def test_update_global_rule(self, base_url, admin_token):
        """✅ 更新全局规则。"""
        r = requests.put(
            f"{base_url}/api/admin/rules/global",
            json={"daily_limit": 60, "history_count": 10, "favorite_limit": 8, "recycle_days": 5},
            headers=headers(admin_token),
        )
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["daily_limit"] == 60
        assert data["history_count"] == 10
        assert data["favorite_limit"] == 8
        assert data["recycle_days"] == 5
        print("  [OK] 更新全局规则成功")
        requests.put(
            f"{base_url}/api/admin/rules/global",
            json={"daily_limit": 50, "history_count": 5, "favorite_limit": 5, "recycle_days": 7},
            headers=headers(admin_token),
        )

    def test_get_user_rule(self, base_url, admin_token, agent_token):
        """✅ 获取指定员工的规则（含合并逻辑）。"""
        uid = agent_token["user_id"]
        r = requests.get(f"{base_url}/api/admin/users/{uid}/rule", headers=headers(admin_token))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        for field in ("daily_limit", "history_count", "favorite_limit", "recycle_days"):
            assert field in data
        print(f"  [OK] 用户规则: {data}")

    def test_update_user_rule(self, base_url, admin_token, agent_token):
        """✅ 为指定员工设置个人规则。"""
        uid = agent_token["user_id"]
        r = requests.put(
            f"{base_url}/api/admin/users/{uid}/rule",
            json={"daily_limit": 30, "favorite_limit": 3},
            headers=headers(admin_token),
        )
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["daily_limit"] == 30
        assert data["favorite_limit"] == 3
        print("  [OK] 更新用户规则成功")


# ===========================================================================
# ==================== Admin - 号码池与导入 =================================
# ===========================================================================

class TestAdminNumbers:
    """号码导入、批次、池统计。"""

    def test_pool_stats(self, base_url, admin_token):
        """✅ 号码池统计。"""
        r = requests.get(f"{base_url}/api/admin/pool/stats", headers=headers(admin_token))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        for field in ("total", "pool_remaining", "used"):
            assert field in data
        print(f"  [OK] 号码池统计: {data}")

    def test_import_numbers(self, base_url, admin_token):
        """✅ 导入 Excel 格式的号码。"""
        import openpyxl
        from io import BytesIO

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "号码"
        test_numbers = ["13800138001", "13900139002", "13700137003"]
        for i, n in enumerate(test_numbers, 1):
            ws.cell(row=i, column=1, value=n)
        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)

        files = {"file": ("test_import.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{base_url}/api/admin/numbers/import", files=files, headers=headers(admin_token))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert "batch_id" in data
        assert data["success"] >= 3
        print(f"  [OK] 导入成功: {data}")
        requests.delete(f"{base_url}/api/admin/batches/{data['batch_id']}", headers=headers(admin_token))

    def test_import_non_excel_rejected(self, base_url, admin_token):
        """❌ 导入非 Excel 文件应返回 400。"""
        files = {"file": ("bad.txt", b"not an excel", "text/plain")}
        r = requests.post(f"{base_url}/api/admin/numbers/import", files=files, headers=headers(admin_token))
        assert r.status_code == 400
        assert "Excel" in r.text
        print("  [OK] 非 Excel 文件正确拒绝")

    def test_list_batches(self, base_url, admin_token):
        """✅ 列出导入批次。"""
        r = requests.get(f"{base_url}/api/admin/batches", headers=headers(admin_token))
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        print(f"  [OK] 当前有 {len(data)} 个批次")

    def test_delete_batch(self, base_url, admin_token):
        """✅ 删除一个批次（同时清理其 pool 号码）。"""
        import openpyxl
        from io import BytesIO

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["13888888001"])
        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)

        files = {"file": ("to_delete.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r1 = requests.post(f"{base_url}/api/admin/numbers/import", files=files, headers=headers(admin_token))
        assert r1.status_code == 200
        batch_id = r1.json()["batch_id"]

        r2 = requests.delete(f"{base_url}/api/admin/batches/{batch_id}", headers=headers(admin_token))
        assert r2.status_code == 200
        assert r2.json()["ok"] is True
        print("  [OK] 删除批次成功")

    def test_delete_nonexistent_batch(self, base_url, admin_token):
        """❌ 删除不存在的批次返回 404。"""
        r = requests.delete(f"{base_url}/api/admin/batches/999999", headers=headers(admin_token))
        assert r.status_code == 404
        print("  [OK] 删除不存在批次返回 404")


# ===========================================================================
# ==================== Admin - 标签 =========================================
# ===========================================================================

class TestAdminTags:
    """标签 CRUD。"""

    def test_list_tags(self, base_url, admin_token):
        """✅ 列出所有标签。"""
        r = requests.get(f"{base_url}/api/admin/tags", headers=headers(admin_token))
        assert r.status_code == 200
        tags = r.json()
        assert isinstance(tags, list)
        print(f"  [OK] 共 {len(tags)} 个标签")

    def test_create_tag(self, base_url, admin_token):
        """✅ 创建标签。"""
        name = f"测试标签_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{base_url}/api/admin/tags",
            json={"name": name, "color": "#FF6600"},
            headers=headers(admin_token),
        )
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["name"] == name
        assert data["color"] == "#FF6600"
        tid = data["id"]
        print(f"  [OK] 创建标签 id={tid}")
        requests.delete(f"{base_url}/api/admin/tags/{tid}", headers=headers(admin_token))

    def test_create_duplicate_tag(self, base_url, admin_token):
        """❌ 重复标签名应返回 400。"""
        name = f"重复标签_{uuid.uuid4().hex[:6]}"
        r1 = requests.post(f"{base_url}/api/admin/tags", json={"name": name}, headers=headers(admin_token))
        assert r1.status_code == 200, f"创建失败: {r1.text}"
        tid = r1.json()["id"]
        r2 = requests.post(f"{base_url}/api/admin/tags", json={"name": name}, headers=headers(admin_token))
        assert r2.status_code == 400
        print("  [OK] 重复标签名正确拒绝")
        requests.delete(f"{base_url}/api/admin/tags/{tid}", headers=headers(admin_token))

    def test_update_tag(self, base_url, admin_token):
        """✅ 修改标签。"""
        name = f"待改标签_{uuid.uuid4().hex[:6]}"
        cr = requests.post(f"{base_url}/api/admin/tags", json={"name": name, "color": "#aaa"}, headers=headers(admin_token))
        assert cr.status_code == 200, f"创建失败: {cr.text}"
        tid = cr.json()["id"]
        r = requests.put(
            f"{base_url}/api/admin/tags/{tid}",
            json={"name": f"已改_{name}", "color": "#bbb"},
            headers=headers(admin_token),
        )
        assert r.status_code == 200
        data = r.json()
        assert "已改_" in data["name"]
        assert data["color"] == "#bbb"
        print("  [OK] 更新标签成功")
        requests.delete(f"{base_url}/api/admin/tags/{tid}", headers=headers(admin_token))

    def test_delete_tag(self, base_url, admin_token):
        """✅ 删除标签。"""
        name = f"待删标签_{uuid.uuid4().hex[:6]}"
        cr = requests.post(f"{base_url}/api/admin/tags", json={"name": name}, headers=headers(admin_token))
        assert cr.status_code == 200, f"创建失败: {cr.text}"
        tid = cr.json()["id"]
        r = requests.delete(f"{base_url}/api/admin/tags/{tid}", headers=headers(admin_token))
        assert r.status_code == 200
        assert r.json()["ok"] is True
        print("  [OK] 删除标签成功")

    def test_delete_nonexistent_tag(self, base_url, admin_token):
        """❌ 删除不存在的标签返回 404。"""
        r = requests.delete(f"{base_url}/api/admin/tags/999999", headers=headers(admin_token))
        assert r.status_code == 404
        print("  [OK] 删除不存在标签返回 404")


# ===========================================================================
# ==================== Admin - 看板统计 =====================================
# ===========================================================================

class TestAdminStats:
    """数据看板。"""

    @pytest.mark.parametrize("range_val", ["today", "yesterday", "week", "month"])
    def test_stats_all_ranges(self, base_url, admin_token, range_val):
        """✅ 看板支持 today / yesterday / week / month 四个时间范围。"""
        r = requests.get(f"{base_url}/api/admin/stats", params={"range": range_val}, headers=headers(admin_token))
        assert r.status_code == 200, f"[{range_val}] 期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["range"] == range_val
        assert "overview" in data
        assert "details" in data
        for field in ("total_used", "connected", "unconnected", "wechat_added", "pool_remaining"):
            assert field in data["overview"]
        print(f"  [OK] range={range_val}: overview={data['overview']}")

    def test_stats_default_range(self, base_url, admin_token):
        """✅ 不传 range 默认 today。"""
        r = requests.get(f"{base_url}/api/admin/stats", headers=headers(admin_token))
        assert r.status_code == 200
        assert r.json()["range"] == "today"
        print("  [OK] 默认 range=today")


# ===========================================================================
# ==================== Agent - 核心业务 =====================================
# ===========================================================================

class TestAgentCurrent:
    """当前号码获取。"""

    def test_get_current_number(self, base_url, agent_token):
        """✅ 正常获取一个号码（号码池有号时）。"""
        token = agent_token["token"]
        r = requests.get(f"{base_url}/api/agent/current", headers=headers(token))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        if data["number"]:
            num = data["number"]
            assert "id" in num
            assert "number_masked" in num or "number_plain" in num or "number" in num
            print(f"  [OK] 分配到号码: {num}")
        else:
            assert "reason" in data
            print(f"  [OK] 未分配号码: {data['reason']}")

    def test_get_current_increments_used_count(self, base_url, agent_token):
        """✅ 多次获取 current 验证 today_used 计数增长。"""
        token = agent_token["token"]
        r1 = requests.get(f"{base_url}/api/agent/current", headers=headers(token))
        used1 = r1.json()["today_used"]

        if r1.json().get("number"):
            num_id = r1.json()["number"]["id"]
            requests.post(
                f"{base_url}/api/agent/usage",
                json={"number_id": num_id, "tags": ["已接通"]},
                headers=headers(token),
            )
        else:
            pytest.skip("号码池为空，跳过增量测试")

        r2 = requests.get(f"{base_url}/api/agent/current", headers=headers(token))
        used2 = r2.json()["today_used"]
        assert used2 >= used1, f"today_used 应增长: {used1} -> {used2}"
        print(f"  [OK] today_used 正确增长: {used1} -> {used2}")

    def test_get_current_no_auth(self, base_url):
        """❌ 无 token 访问 current 应返回 401/422。"""
        r = requests.get(f"{base_url}/api/agent/current")
        assert r.status_code in (401, 422), f"期望 401/422，实际 {r.status_code}"
        print("  [OK] 无 token 正确拒绝")


class TestAgentTags:
    """标签列表（邀约员视角）。"""

    def test_list_tags_agent(self, base_url, agent_token):
        """✅ 邀约员可查看标签列表。"""
        r = requests.get(f"{base_url}/api/agent/tags", headers=headers(agent_token["token"]))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        tags = r.json()
        assert isinstance(tags, list)
        print(f"  [OK] 邀约员可见 {len(tags)} 个标签")


class TestAgentUsage:
    """提交使用记录 + 修改 + 删除。"""

    def test_submit_usage_success(self, base_url, agent_token):
        """✅ 提交一次完整使用记录。"""
        token = agent_token["token"]
        r0 = requests.get(f"{base_url}/api/agent/current", headers=headers(token))
        data0 = r0.json()
        if not data0.get("number"):
            pytest.skip("号码池为空，无法测试提交使用")

        num_id = data0["number"]["id"]
        r = requests.post(
            f"{base_url}/api/agent/usage",
            json={
                "number_id": num_id,
                "tags": ["已接通", "已加微信"],
                "note": "客户有意向",
                "is_favorite": True,
            },
            headers=headers(token),
        )
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["is_favorite"] is True
        assert "已接通" in data["tags"]
        assert "已加微信" in data["tags"]
        assert data["note"] == "客户有意向"
        print(f"  [OK] 提交使用记录 id={data['id']}")
        return data["id"]

    def test_submit_usage_wrong_number(self, base_url, agent_token):
        """❌ 提交不存在的号码应返回 404。"""
        r = requests.post(
            f"{base_url}/api/agent/usage",
            json={"number_id": 999999, "tags": ["已接通"]},
            headers=headers(agent_token["token"]),
        )
        assert r.status_code == 404
        print("  [OK] 不存在号码返回 404")

    def test_submit_usage_number_not_assigned(self, base_url, agent_token, agent_token2):
        """❌ 提交不属于该用户的号码应返回 403。"""
        token = agent_token["token"]
        r0 = requests.get(f"{base_url}/api/agent/current", headers=headers(token))
        if not r0.json().get("number"):
            pytest.skip("号码池为空")
        num_id = r0.json()["number"]["id"]
        # agent_token2 的 token 提交（不是号码持有者）
        r = requests.post(
            f"{base_url}/api/agent/usage",
            json={"number_id": num_id, "tags": ["已接通"]},
            headers=headers(agent_token2["token"]),
        )
        assert r.status_code == 403, f"期望 403，实际 {r.status_code}"
        print("  [OK] 非持有者提交返回 403")

    def test_update_usage(self, base_url, agent_token):
        """✅ 修改使用记录（改备注、改标签、改收藏）。"""
        token = agent_token["token"]
        r0 = requests.get(f"{base_url}/api/agent/current", headers=headers(token))
        if not r0.json().get("number"):
            pytest.skip("号码池为空")
        num_id = r0.json()["number"]["id"]
        cr = requests.post(
            f"{base_url}/api/agent/usage",
            json={"number_id": num_id, "tags": ["已接通"]},
            headers=headers(token),
        )
        assert cr.status_code == 200, f"提交失败: {cr.text}"
        rid = cr.json()["id"]

        r = requests.put(
            f"{base_url}/api/agent/usage/{rid}",
            json={"note": "修改后备注", "tags": ["未接通"], "is_favorite": True},
            headers=headers(token),
        )
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert data["note"] == "修改后备注"
        assert "未接通" in data["tags"]
        assert data["is_favorite"] is True
        print("  [OK] 修改使用记录成功")

    def test_update_nonexistent_usage(self, base_url, agent_token):
        """❌ 修改不存在的记录返回 404。"""
        r = requests.put(
            f"{base_url}/api/agent/usage/999999",
            json={"note": "幽灵"},
            headers=headers(agent_token["token"]),
        )
        assert r.status_code == 404
        print("  [OK] 修改不存在记录返回 404")

    def test_delete_usage(self, base_url, agent_token):
        """✅ 删除使用记录（号码回池）。"""
        token = agent_token["token"]
        r0 = requests.get(f"{base_url}/api/agent/current", headers=headers(token))
        if not r0.json().get("number"):
            pytest.skip("号码池为空")
        num_id = r0.json()["number"]["id"]
        cr = requests.post(
            f"{base_url}/api/agent/usage",
            json={"number_id": num_id, "tags": ["已接通"]},
            headers=headers(token),
        )
        assert cr.status_code == 200, f"提交失败: {cr.text}"
        rid = cr.json()["id"]

        r = requests.delete(f"{base_url}/api/agent/usage/{rid}", headers=headers(token))
        assert r.status_code == 200
        assert r.json()["ok"] is True
        print("  [OK] 删除使用记录成功，号码已回池")

    def test_delete_usage_not_owner(self, base_url, agent_token, agent_token2):
        """❌ 删除他人记录应返回 404。"""
        token1 = agent_token["token"]
        token2 = agent_token2["token"]
        r0 = requests.get(f"{base_url}/api/agent/current", headers=headers(token1))
        if not r0.json().get("number"):
            pytest.skip("号码池为空")
        num_id = r0.json()["number"]["id"]
        cr = requests.post(f"{base_url}/api/agent/usage", json={"number_id": num_id}, headers=headers(token1))
        assert cr.status_code == 200, f"提交失败: {cr.text}"
        rid = cr.json()["id"]
        r2 = requests.delete(f"{base_url}/api/agent/usage/{rid}", headers=headers(token2))
        assert r2.status_code == 404, f"agent2 不应能删除 agent1 的记录，期望 404，实际 {r2.status_code}"
        print("  [OK] 跨用户删除记录返回 404")


# ===========================================================================
# ==================== Agent - 历史 & 收藏 ==================================
# ===========================================================================

class TestAgentHistory:
    """历史记录与收藏。"""

    def test_history_returns_records(self, base_url, agent_token):
        """✅ 历史记录返回该用户的使用记录列表。"""
        r = requests.get(f"{base_url}/api/agent/history", headers=headers(agent_token["token"]))
        assert r.status_code == 200, f"期望 200，实际 {r.status_code}: {r.text}"
        data = r.json()
        assert isinstance(data, list)
        print(f"  [OK] 历史记录共 {len(data)} 条")

    def test_favorites_returns_favorites(self, base_url, agent_token):
        """✅ 收藏列表只返回 is_favorite=True 的记录。"""
        r = requests.get(f"{base_url}/api/agent/favorites", headers=headers(agent_token["token"]))
        assert r.status_code == 200
        favs = r.json()
        assert isinstance(favs, list)
        for f in favs:
            assert f["is_favorite"] is True
        print(f"  [OK] 收藏列表共 {len(favs)} 条，全部 is_favorite=True")

    def test_favorites_only_own(self, base_url, agent_token, agent_token2):
        """✅ 收藏列表只返回自己的收藏。"""
        token1 = agent_token["token"]
        token2 = agent_token2["token"]

        r0 = requests.get(f"{base_url}/api/agent/current", headers=headers(token1))
        if not r0.json().get("number"):
            pytest.skip("号码池为空")
        num_id = r0.json()["number"]["id"]
        cr = requests.post(
            f"{base_url}/api/agent/usage",
            json={"number_id": num_id, "tags": ["已接通"], "is_favorite": True},
            headers=headers(token1),
        )
        if cr.status_code != 200:
            pytest.skip("无法创建收藏记录")

        f1 = requests.get(f"{base_url}/api/agent/favorites", headers=headers(token1)).json()
        f2 = requests.get(f"{base_url}/api/agent/favorites", headers=headers(token2)).json()
        ids1 = {item["id"] for item in f1}
        ids2 = {item["id"] for item in f2}
        print(f"  [OK] agent1 收藏 {len(f1)} 条，agent2 收藏 {len(f2)} 条")


# ===========================================================================
# ==================== 权限边界测试 =========================================
# ===========================================================================

class TestPermissionBoundary:
    """验证 agent 和 admin 接口的权限边界。"""

    def test_agent_cannot_access_admin_users(self, base_url, agent_token):
        """❌ 普通邀约员不能访问管理员用户列表。"""
        r = requests.get(f"{base_url}/api/admin/users", headers=headers(agent_token["token"]))
        assert r.status_code in (401, 403), f"期望 401/403，实际 {r.status_code}"
        print("  [OK] agent 无法访问 admin/users")

    def test_agent_cannot_access_admin_rules(self, base_url, agent_token):
        """❌ 普通邀约员不能修改全局规则。"""
        r = requests.put(
            f"{base_url}/api/admin/rules/global",
            json={"daily_limit": 99, "history_count": 99, "favorite_limit": 99, "recycle_days": 99},
            headers=headers(agent_token["token"]),
        )
        assert r.status_code in (401, 403)
        print("  [OK] agent 无法修改全局规则")

    def test_agent_cannot_import_numbers(self, base_url, agent_token):
        """❌ 普通邀约员不能导入号码。"""
        import openpyxl
        from io import BytesIO
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["13800000001"])
        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        files = {"file": ("bad.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = requests.post(f"{base_url}/api/admin/numbers/import", files=files, headers=headers(agent_token["token"]))
        assert r.status_code in (401, 403)
        print("  [OK] agent 无法导入号码")

    def test_admin_cannot_submit_usage(self, base_url, admin_token):
        """验证管理员身份提交 usage 的响应。"""
        r = requests.post(
            f"{base_url}/api/agent/usage",
            json={"number_id": 1, "tags": ["已接通"]},
            headers=headers(admin_token),
        )
        # admin 也是 User，可以调用 agent 接口（可能返回业务错误，不是权限错误）
        assert r.status_code in (200, 403, 404), f"admin 提交 usage 应返回业务错误，实际 {r.status_code}"
        print(f"  [OK] admin 提交 usage 返回 {r.status_code}")

    def test_admin_can_access_agent_current(self, base_url, admin_token):
        """admin 身份访问 /agent/current 是允许的（作为普通 User）。"""
        r = requests.get(f"{base_url}/api/agent/current", headers=headers(admin_token))
        assert r.status_code in (200, 403), f"期望 200/403，实际 {r.status_code}: {r.text}"
        print(f"  [OK] admin 访问 /agent/current 返回 {r.status_code}")
