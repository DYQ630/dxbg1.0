"""pytest 全局配置和共享 fixtures。"""
import pytest
import requests
import time
import uuid

BASE_URL = "http://localhost:8000"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def admin_token(base_url):
    """获取 admin token（只登录一次）。"""
    r = requests.post(f"{base_url}/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200, f"admin 登录失败: {r.text}"
    data = r.json()
    return data["access_token"]


@pytest.fixture(scope="session")
def admin_user(base_url, admin_token):
    """获取 admin 用户信息。"""
    r = requests.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert r.status_code == 200, f"获取 admin 信息失败: {r.text}"
    return r.json()


@pytest.fixture
def agent_token(base_url):
    """创建临时 agent 并返回其 token。"""
    username = f"test_agent_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{base_url}/api/admin/users",
        json={"username": username, "password": "test123456", "real_name": "测试员工", "phone": "13800138000"},
        headers={"Authorization": f"Bearer {requests.post(f'{base_url}/api/auth/login', json={'username':'admin','password':'admin123'}).json()['access_token']}"},
    )
    if r.status_code == 200:
        agent_data = r.json()
    else:
        # 可能是用户名重复，再试一次
        username = f"ta_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{base_url}/api/admin/users",
            json={"username": username, "password": "test123456", "real_name": "测试员工", "phone": "13800138000"},
            headers={"Authorization": f"Bearer {requests.post(f'{base_url}/api/auth/login', json={'username':'admin','password':'admin123'}).json()['access_token']}"},
        )
        assert r.status_code == 200, f"创建 agent 失败: {r.text}"
        agent_data = r.json()

    # 登录获取 token
    r2 = requests.post(f"{base_url}/api/auth/login", json={"username": username, "password": "test123456"})
    assert r2.status_code == 200, f"agent 登录失败: {r2.text}"
    token = r2.json()["access_token"]

    yield {"token": token, "user_id": agent_data["id"], "username": username}

    # 清理：停用该 agent（软删除）
    admin_t = requests.post(f"{base_url}/api/auth/login", json={"username": "admin", "password": "admin123"}).json()["access_token"]
    requests.put(
        f"{base_url}/api/admin/users/{agent_data['id']}",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {admin_t}"},
    )


@pytest.fixture
def agent_token2(base_url, admin_token):
    """第二个 agent（用于测试均分等场景）。"""
    username = f"ta2_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{base_url}/api/admin/users",
        json={"username": username, "password": "test123456", "real_name": "测试员工2"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    if r.status_code != 200:
        username = f"tb_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{base_url}/api/admin/users",
            json={"username": username, "password": "test123456", "real_name": "测试员工2"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
    assert r.status_code == 200, f"创建第二个 agent 失败: {r.text}"
    agent_data = r.json()
    r2 = requests.post(f"{base_url}/api/auth/login", json={"username": username, "password": "test123456"})
    assert r2.status_code == 200
    token = r2.json()["access_token"]
    yield {"token": token, "user_id": agent_data["id"], "username": username}
    requests.put(
        f"{base_url}/api/admin/users/{agent_data['id']}",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {admin_token}"},
    )


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
