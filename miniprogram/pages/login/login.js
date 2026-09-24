/**
 * ============================================================
 * pages/login/login.js - 登录页
 * ============================================================
 * 【模块职责】
 *   账号密码输入 → 调后端 /api/auth/login → 保存 token/role → 按角色跳转
 *
 * 【页面逻辑】
 *   - onLoad: 若本地已有有效 token，自动按角色跳转（静默登录）
 *   - onLogin: 表单非空校验 → 调 api.login() → 持久化存储 → 跳转首页
 *   - redirectByRole: role === 'admin' → 管理端首页（switchTab）；
 *                     role === 'agent' → 邀约员首页（reLaunch，agent 必须从当前号码页进入）
 *
 * 【登录态持久化】
 *   后端返回 { access_token, role }，
 *   token 存 wx.setStorageSync('token')，role 存 wx.setStorageSync('role')
 *   → app.js onLaunch 时自动恢复，无需每次启动重新输入密码
 */
const api = require('../../utils/api.js');
const app = getApp();

Page({
  data: {
    username: '',  // 账号输入框绑定的值
    password: '',  // 密码输入框绑定的值
    loading: false, // 登录请求中标记，防止用户双击重复提交
  },

  // ============================================================
  // onLoad：页面初次加载
  // 【功能】检查本地是否已有有效登录态（token + role），有则静默跳转
  // 【场景】用户首次打开小程序，或小程序冷启动时直接进入登录页
  // 【逻辑】读取 wx.getStorageSync('token') 和 'role'，
  //         两者同时存在说明上次已登录，直接 redirectByRole 跳转
  // ============================================================
  onLoad() {
    const token = wx.getStorageSync('token');
    const role = wx.getStorageSync('role');
    if (token && role) {
      this.redirectByRole(role);
    }
  },

  // ============================================================
  // onUsernameInput：账号输入框实时同步到 data.username
  // ============================================================
  onUsernameInput(e) {
    this.setData({ username: e.detail.value });
  },

  // ============================================================
  // onPasswordInput：密码输入框实时同步到 data.password
  // ============================================================
  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  // ============================================================
  // onLogin：点击登录按钮
  // 【功能】表单验证 → 调 api.login() → 持久化存储 → 按角色跳转
  //
  // 【表单验证】username 和 password 均为必填，空则弹窗提示并中断
  //
  // 【成功流程】
  //   1. 后端返回 { access_token, role }，
  //   2. token 写入 wx.setStorageSync（持久化，重启后恢复）
  //   3. role   写入 wx.setStorageSync（持久化）
  //   4. app.globalData 同步写入（内存，供本次运行期间各页面读取）
  //   5. 500ms 延迟后跳转首页（等待 Toast 显示）
  //
  // 【失败流程】
  //   - 展示 e.errMsg（后端 FastAPI HTTPException detail），
  //     多条错误用分号连接；超长时截断到 30 字符
  // ============================================================
  async onLogin() {
    const { username, password } = this.data;
    // 非空校验
    if (!username || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    try {
      const res = await api.login({ username, password });
      // 持久化登录态
      wx.setStorageSync('token', res.access_token);
      wx.setStorageSync('role', res.role);
      app.globalData.token = res.access_token;
      app.globalData.role = res.role;
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => this.redirectByRole(res.role), 500);
    } catch (e) {
      // 登录失败：展示后端返回的错误信息（截断过长的提示）
      console.error('[LOGIN] failed', e);
      const msg = e.errMsg || e.message || '登录失败';
      wx.showToast({ title: msg.slice(0, 30), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // ============================================================
  // redirectByRole：根据用户角色跳转到对应首页
  // 【参数】role: 'admin' | 'agent'（理论上也可能是其他值，但业务只有这两种）
  //
  // 【跳转方式区别】
  //   - switchTab : 用于 tabBar 页面（admin-home 在 tabBar.list 中），
  //                 可保留页面栈，用户可按 tab 切换
  //   - reLaunch  : 关闭所有页面重新打开，用于 agent，因为邀约员
  //                 应从"当前号码"页作为唯一入口，reLaunch 可防止
  //                 用户按返回键回到登录页
  // ============================================================
  redirectByRole(role) {
    if (role === 'admin') {
      wx.switchTab({ url: '/pages/admin-home/admin-home' });
    } else {
      wx.reLaunch({ url: '/pages/agent-current/agent-current' });
    }
  },
});
