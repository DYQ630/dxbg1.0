/**
 * ============================================================
 * 邀约宝小程序 - 全局应用入口（app.js）
 * ============================================================
 * 【模块职责】
 * - 管理全局共享数据（登录用户信息、Token、角色权限）
 * - 小程序生命周期：启动时恢复登录态、页面切换时鉴权守卫
 * - 退出登录：清空所有本地缓存并跳转登录页
 * - 屏幕保护：防止客户电话号码等敏感信息被截屏或录屏外泄
 *
 * 【全局数据 globalData 结构】
 * - userInfo    : 后端返回的当前用户详细信息对象
 * - token       : JWT Bearer Token，后端接口鉴权凭证
 * - role        : 'admin'（管理员）或 'agent'（邀约员），决定首页入口
 * - revealedId  : 当前打码/明文展示的号码 ID（仅邀约员端使用）
 *
 * 【本地缓存 key】
 * - wx.setStorageSync('token') : JWT Token 持久化存储
 * - wx.setStorageSync('role')  : 角色持久化存储（用于启动时快速恢复登录态）
 * - 注意：password 永远不存本地，避免泄露风险
 */

App({
  // ============================================================
  // globalData：全局共享数据，整个小程序生命周期内有效
  // ============================================================
  // - userInfo   : 后端 /api/auth/me 返回的当前用户详细信息
  // - token      : JWT Bearer Token，后端所有接口的鉴权凭证（由 logout 清除）
  // - role       : 'admin'（管理员）或 'agent'（邀约员），决定登录后跳转的首页
  // - revealedId : 邀约员端当前明文展示的号码 ID（打码/明文切换状态）
  globalData: {
    userInfo: null,
    token: null,
    role: null,
    revealedId: null,
  },

  // ============================================================
  // onLaunch：小程序冷启动（首次打开或从后台切回）时触发
  // 职责：① 恢复本地缓存的登录态 ② 开启屏幕保护
  // ============================================================
  onLaunch() {
    this.checkLoginStatus();
    this.enableScreenProtection();
  },

  // ============================================================
  // onShow：每次小程序显示时触发（切换前台时调用）
  // 用途：可在此补充每次回前台时的状态检查（如 Token 过期检测）
  // ============================================================
  onShow(options) {
    // console.log('[App] onShow', options);
  },

  // ============================================================
  // onHide：小程序隐藏（切换到后台）时触发
  // 用途：可在此保存临时状态（如表单草稿），本次实现暂不处理
  // ============================================================
  onHide() {
    // console.log('[App] onHide');
  },

  // ============================================================
  // checkLoginStatus
  // 【功能】启动时从本地缓存（wx.getStorageSync）恢复登录态到 globalData
  // 【逻辑】若本地存有 token + role 两个 key，说明用户上次已登录，
  //         将其同步写入 globalData，后续接口请求可直接读取。
  //         若缓存为空（首次打开或退出后），globalData 保持 null。
  // ============================================================
  checkLoginStatus() {
    const token = wx.getStorageSync('token');
    const role = wx.getStorageSync('role');
    if (token && role) {
      this.globalData.token = token;
      this.globalData.role = role;
    }
  },

  // ============================================================
  // logout
  // 【功能】退出登录：清空内存与本地缓存，跳转回登录页
  // 【清场逻辑】
  //   1. globalData 全部置 null（内存清除）
  //   2. removeStorageSync 清除 token/role（持久化清除）
  //   3. wx.reLaunch 关闭所有页面栈，重新打开登录页（避免按返回键回到已登录页面）
  // 【注意】userInfo 也在此处清除；若后端支持 Token 注销（revoke），可在此调用对应接口
  // ============================================================
  logout() {
    this.globalData.token = null;
    this.globalData.role = null;
    this.globalData.userInfo = null;
    wx.removeStorageSync('token');
    wx.removeStorageSync('role');
    wx.reLaunch({ url: '/pages/login/login' });
  },

  // ============================================================
  // enforceRole(expectedRole)
  // 【功能】角色权限守卫：在页面 onShow 中调用，确保只有正确角色的用户能访问
  // 【参数】expectedRole: 'admin' | 'agent'
  // 【返回】true  = 权限校验通过，页面继续渲染
  //         false = 未登录或角色不符，已触发跳转，页面不渲染
  //
  // 【分支逻辑】
  //   - 无 token      → reLaunch 到登录页（强制重新登录）
  //   - role !== expect → 提示无权限，1.5s 后按实际角色跳对应首页
  //     （admin 用户误入 agent 页面 → 跳管理端首页；反之亦然）
  // ============================================================
  enforceRole(expectedRole) {
    const token = wx.getStorageSync('token');
    // 未登录：回到登录页
    if (!token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return false;
    }
    const role = wx.getStorageSync('role');
    // 角色不符：提示无权限并按当前角色跳转到对应首页
    if (role !== expectedRole) {
      wx.showToast({ title: 'Access denied', icon: 'none' });
      setTimeout(() => {
        if (role === 'admin') {
          wx.switchTab({ url: '/pages/admin-home/admin-home' });
        } else if (role === 'agent') {
          wx.reLaunch({ url: '/pages/agent-current/agent-current' });
        } else {
          wx.reLaunch({ url: '/pages/login/login' });
        }
      }, 1500);
      return false;
    }
    return true;
  },

  // ============================================================
  // enableScreenProtection
  // 【功能】开启屏幕保护，防止客户电话号码等敏感信息被截屏或录屏外泄
  // 【机制】
  //   1. setVisualEffectOnCapture → 截屏时画面内容隐藏（Android 高版本支持）
  //   2. onUserCaptureScreen      → 检测到用户截屏时 Toast 提示
  //   3. onScreenRecordingStateChanged → 检测到系统录屏开始时 Toast 提示
  // 【适用场景】邀约员拨打电话时显示真实号码，防止截图传播
  // 【兼容性】各 API 均有 if 判断，不支持时静默跳过，不影响主流程
  // ============================================================
  enableScreenProtection() {
    // 截屏时画面内容隐藏（仅支持微信 8.0.14+ / Android 7.0+）
    if (wx.setVisualEffectOnCapture) {
      wx.setVisualEffectOnCapture({ visualEffect: 'hidden' });
    }
    // 检测到用户截屏时弹窗提示
    if (wx.onUserCaptureScreen) {
      wx.onUserCaptureScreen(() => {
        wx.showToast({ title: 'Screenshot detected', icon: 'none' });
      });
    }
    // 检测到录屏开始时弹窗提示（微信 8.0+ 支持）
    if (wx.onScreenRecordingStateChanged) {
      wx.onScreenRecordingStateChanged(res => {
        if (res.state === 'start') {
          wx.showToast({ title: 'Recording detected', icon: 'none' });
        }
      });
    }
  },
});
