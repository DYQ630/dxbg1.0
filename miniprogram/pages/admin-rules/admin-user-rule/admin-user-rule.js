/**
 * ============================================================
 * pages/admin-rules/admin-user-rule/admin-user-rule.js - 个人规则设置页
 * ============================================================
 * 【页面参数】uid
 *   来源：管理员从 admin-rules 列表页点击邀约员卡片，
 *         wx.navigateTo({ url: '.../admin-user-rule?uid=' + id })
 *         uid 为该邀约员在后端的 user.id（非 user_id 字段名）
 *
 * 【功能】
 *   展示全局规则作为参考，可单独设置该员工的四项规则覆盖值。
 *   留空 = 不覆盖，后端返回 effective（实际生效规则）供参考。
 *
 * 【四项规则字段】
 *   daily_limit     : 每日领取号码上限（覆盖全局）
 *   history_count   : 历史记录加载条数（覆盖全局）
 *   favorite_limit  : 收藏上限（覆盖全局）
 *   recycle_days    : 超窗回收天数（覆盖全局）
 *
 * 【loadRule/getUserRule】
 *   页面初始化时并行加载：用户列表 + 全局规则 + 个人规则
 *   页面 onShow 再次调用 loadAll()，确保保存后刷新最新生效规则
 *
 * 【saveRule/updateUserRule】
 *   空值以 null 提交 → 后端删除个人覆盖项，规则回退到全局
 *   保存成功后重新拉取 effective 规则展示给管理员确认
 * ============================================================
 */
const api = require('../../../utils/api.js');

Page({
  data: {
    uid: null,   // 当前编辑的员工 id
    user: {},    // 员工信息
    initial: '?', // 头像首字符
    global: {},  // 全局规则（参考值）
    // 个人规则表单（留空 = 不覆盖全局）
    rule: { daily_limit: '', history_count: '', favorite_limit: '', recycle_days: '' },
    effective: null, // 后端返回的最终生效规则
    saving: false,   // 保存中标记
  },

  // 页面加载：从路由参数取员工 id
  onLoad(options) {
    const uid = Number(options.uid);
    if (!uid || !Number.isFinite(uid)) {
      wx.showToast({ title: '员工 id 缺失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ uid });
  },

  // 页面每次显示：校验管理员角色并加载数据
  onShow() {
    if (!getApp().enforceRole('admin')) return;
    this.loadAll();
  },

  // 并行加载用户列表 / 全局规则 / 个人规则
  async loadAll() {
    try {
      const [usersRes, global, rule] = await Promise.all([
        api.getUsers(),
        api.getGlobalRule(),
        api.getUserRule(this.data.uid),
      ]);
      const users = Array.isArray(usersRes) ? usersRes : ((usersRes && usersRes.users) || []);
      // 后端字段是 id（不是 user_id）
      const user = users.find(u => u.id === this.data.uid) || {};
      const initial = (user.real_name || user.username || '?')[0];
      this.setData({ user, initial, global, effective: rule });

      // 加载个人原始规则（getUsers 已含字段）
      this.setData({
        rule: {
          daily_limit: user.daily_limit == null ? '' : user.daily_limit,
          history_count: user.history_count == null ? '' : user.history_count,
          favorite_limit: user.favorite_limit == null ? '' : user.favorite_limit,
          recycle_days: user.recycle_days == null ? '' : user.recycle_days,
        },
      });
    } catch (e) {
      console.error('loadAll error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 规则输入事件（data-field 区分字段）
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`rule.${field}`]: e.detail.value });
  },

  // 保存个人规则（空值以 null 提交 = 删除覆盖、回退到全局规则）
  async saveRule() {
    const r = this.data.rule;
    this.setData({ saving: true });
    try {
      await api.updateUserRule(this.data.uid, {
        daily_limit: r.daily_limit === '' ? null : Number(r.daily_limit),
        history_count: r.history_count === '' ? null : Number(r.history_count),
        favorite_limit: r.favorite_limit === '' ? null : Number(r.favorite_limit),
        recycle_days: r.recycle_days === '' ? null : Number(r.recycle_days),
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      // 重新拉取生效规则
      const effective = await api.getUserRule(this.data.uid);
      this.setData({ effective });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
