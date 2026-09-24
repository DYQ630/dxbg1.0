// Yaoyuebao - 邀约员 · 个人资料页
const api = require('../../utils/api.js');

Page({
  data: {
    userInfo: null,
    loading: false,
    showNameModal: false,
    showPasswordModal: false,
    nameForm: { real_name: '', phone: '' },
    passwordForm: { oldPassword: '', newPassword: '', confirmPassword: '' },
    avatarChar: '?',
  },

  onLoad() {
    wx.hideTabBar({ fail: function(){} });
  },

  onShow() {
    if (!getApp().enforceRole('agent')) return;
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true });
    try {
      const res = await api.getMe();
      const name = (res && (res.real_name || res.username)) || '';
      this.setData({
        userInfo: res,
        avatarChar: name ? name.charAt(0).toUpperCase() : '?',
      });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 打开个人信息编辑弹窗（姓名 + 手机号）
  onEditName() {
    const u = this.data.userInfo || {};
    this.setData({
      showNameModal: true,
      nameForm: { real_name: u.real_name || '', phone: u.phone || '' },
    });
  },

  onNameInput(e) {
    this.setData({ nameForm: Object.assign({}, this.data.nameForm, { real_name: e.detail.value }) });
  },

  onPhoneInput(e) {
    this.setData({ nameForm: Object.assign({}, this.data.nameForm, { phone: e.detail.value }) });
  },

  closeNameModal() {
    this.setData({ showNameModal: false });
  },

  // 保存个人信息
  async onSaveName() {
    const form = this.data.nameForm;
    if (!form.real_name || !form.real_name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }
    try {
      await api.updateProfile({
        real_name: form.real_name.trim(),
        phone: (form.phone || '').trim(),
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showNameModal: false });
      this.loadProfile();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '保存失败', icon: 'none' });
    }
  },

  // 打开修改密码弹窗
  onChangePassword() {
    this.setData({
      showPasswordModal: true,
      passwordForm: { oldPassword: '', newPassword: '', confirmPassword: '' },
    });
  },

  onOldPasswordInput(e) {
    this.setData({ passwordForm: Object.assign({}, this.data.passwordForm, { oldPassword: e.detail.value }) });
  },

  onNewPasswordInput(e) {
    this.setData({ passwordForm: Object.assign({}, this.data.passwordForm, { newPassword: e.detail.value }) });
  },

  onConfirmPasswordInput(e) {
    this.setData({ passwordForm: Object.assign({}, this.data.passwordForm, { confirmPassword: e.detail.value }) });
  },

  closePasswordModal() {
    this.setData({ showPasswordModal: false });
  },

  // 提交修改密码
  async onSubmitPassword() {
    const { oldPassword, newPassword, confirmPassword } = this.data.passwordForm;
    if (!oldPassword || !newPassword) {
      wx.showToast({ title: '请填写完整', icon: 'none' });
      return;
    }
    if (newPassword !== confirmPassword) {
      wx.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }
    if (newPassword.length < 6) {
      wx.showToast({ title: '密码至少6位', icon: 'none' });
      return;
    }
    try {
      await api.changePassword({ old_password: oldPassword, new_password: newPassword });
      wx.showToast({ title: '密码已修改', icon: 'success' });
      this.setData({ showPasswordModal: false });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '修改失败', icon: 'none' });
    }
  },

  // 退出登录
  doLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      confirmColor: '#F56C6C',
      success: res => {
        if (res.confirm) getApp().logout();
      },
    });
  },

  // 底部 Tab 导航
  goCurrent()   { wx.reLaunch({ url: '/pages/agent-current/agent-current' }); },
  goHistory()   { wx.reLaunch({ url: '/pages/agent-history/agent-history' }); },
  goFavorites() { wx.reLaunch({ url: '/pages/agent-favorite/agent-favorite' }); },

  noOp() {},
});
