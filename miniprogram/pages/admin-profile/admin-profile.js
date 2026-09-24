/**
 * admin-profile.js - 管理员个人中心
 * 个人信息 + 修改密码 + 退出登录
 */
const api = require('../../utils/api.js');

Page({
  data: {
    user: {},          // 当前管理员信息
    initial: '?',      // 头像首字符
    showPwdModal: false, // 修改密码弹窗开关
    pwdForm: { old: '', new: '', confirm: '' }, // 密码表单
  },

  // 页面每次显示：校验管理员角色并加载个人信息
  onShow() {
    if (!getApp().enforceRole('admin')) return;
    this.loadMe();
  },

  // 加载当前登录用户信息
  async loadMe() {
    try {
      const me = await api.getMe();
      // api.request() 已解析 res.data，这里再做一次兼容兜底
      const u = (me && (me.data || me)) || {};
      const real = u.real_name || u.username || '?';
      this.setData({ user: u, initial: real[0] });
    } catch (e) {
      console.error('loadMe error', e);
    }
  },

  // 跳转员工管理页
  goUsers() {
    wx.navigateTo({ url: '/pages/admin-users/admin-users' });
  },

  // 跳转规则设置页
  goRules() {
    wx.navigateTo({ url: '/pages/admin-rules/admin-rules' });
  },

  // 打开修改密码弹窗（重置表单）
  changePassword() {
    this.setData({ showPwdModal: true, pwdForm: { old: '', new: '', confirm: '' } });
  },

  // 关闭修改密码弹窗
  closePwd() {
    this.setData({ showPwdModal: false });
  },

  // 密码输入事件（通过 data-field 区分 old/new/confirm）
  onPwdInput(e) {
    this.setData({ [`pwdForm.${e.currentTarget.dataset.field}`]: e.detail.value });
  },

  // 提交修改密码
  async savePassword() {
    const { old, new: nw, confirm } = this.data.pwdForm;
    // 表单校验：非空 / 长度 / 两次一致
    if (!old || !nw) return wx.showToast({ title: '请填写完整', icon: 'none' });
    if (nw.length < 6) return wx.showToast({ title: '新密码≥6位', icon: 'none' });
    if (nw !== confirm) return wx.showToast({ title: '两次输入不一致', icon: 'none' });
    try {
      // 注意：API 封装 api.changePassword 指向 /api/agent/change-password（员工端），
      // 管理员改密应使用后端 /api/auth/change-password，故此处直连正确端点（不动 api.js）。
      await new Promise((resolve, reject) => {
        const app = getApp();
        const token = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
        wx.request({
          url: 'http://192.168.110.173:8000/api/auth/change-password',
          method: 'POST',
          data: { old_password: old, new_password: nw },
          header: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          success(r) {
            if (r.statusCode >= 400) reject(r.data || { errMsg: '修改失败' });
            else resolve(r.data);
          },
          fail: () => reject({ errMsg: '网络错误' }),
        });
      });
      wx.showToast({ title: '已修改', icon: 'success' });
      this.closePwd();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '修改失败', icon: 'none' });
    }
  },

  // 空操作（阻止弹窗内容点击冒泡关闭）
  noop() {},

  // 退出登录（二次确认）
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出？',
      success: r => {
        if (r.confirm) getApp().logout();
      },
    });
  },
});
