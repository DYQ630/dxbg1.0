/**
 * ============================================================
 * pages/admin-rules/admin-rules.js - 全局规则设置页
 * ============================================================
 * 【模块职责】
 *   管理员编辑全局规则（每日上限/历史条数/收藏上限/回收天数），
 *   并可点击邀约员进入个人规则覆盖页。
 *
 * 【四项全局规则说明】
 *   daily_limit     : 每个邀约员每天可领取的号码上限
 *   history_count   : 邀约员历史记录页每次加载的条数上限
 *   favorite_limit  : 每个邀约员最多可收藏的号码数量
 *   recycle_days    : 号码分配给邀约员后，超过 N 天未使用则自动回收
 *
 * 【saveRule 保存逻辑】
 *   1. 校验各项 >= 1（业务硬性约束）
 *   2. 调 api.updateGlobalRule() 保存全局规则
 *   3. 调 api.clearPersonalRulesBelowGlobal() 自动清除低于新全局值的个人规则覆盖
 *      （即：若个人规则某项比新全局规则还宽松，则清除该项，个人回退到全局）
 *   4. 刷新员工列表，让被清除的项显示为"默认"
 * ============================================================
 */
const api = require('../../utils/api.js');

Page({
  data: {
    // 全局规则默认值（后端无数据时的兜底）
    global: { daily_limit: 60, history_count: 50, favorite_limit: 5, recycle_days: 7 },
    agents: [],       // 原始员工列表（不包含 admin）
    filteredAgents: [], // 按 searchKeyword 过滤后的列表
    searchKeyword: '', // 员工搜索关键字
    savingGlobal: false, // 保存全局规则中标记
  },

  // 页面每次显示：校验管理员角色并加载全局规则 + 员工列表
  onShow() {
    if (!getApp().enforceRole('admin')) return;
    this.loadAll();
  },

  // 并行加载全局规则与用户列表
  async loadAll() {
    try {
      const [g, usersRes] = await Promise.all([
        api.getGlobalRule(),
        api.getUsers(),
      ]);
      // 后端 /api/admin/users 直接返回数组 [{user_id, role, real_name, ...}, ...]
      // 也可能包装成 {users: [...]}，两种格式都兼容
      let raw = [];
      if (Array.isArray(usersRes)) {
        raw = usersRes;
      } else if (usersRes && Array.isArray(usersRes.users)) {
        raw = usersRes.users;
      }
      // 过滤出 agent（role === 'agent'），跳过 admin，并按拼音/姓名升序排（张三、李四等真名优先出现在上面）
      // 后端 /api/admin/users 直接返回数组 [{id, role, real_name, ...}, ...]，id 字段不是 user_id
      const agents = raw.filter(u => u.role === 'agent').sort((a, b) => {
        const an = (a.real_name || a.username || '');
        const bn = (b.real_name || b.username || '');
        return an.localeCompare(bn, 'zh-Hans-CN');
      });
      this.setData({ global: g || this.data.global, agents, filteredAgents: agents });
    } catch (e) {
      console.error('loadAll error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 全局规则输入事件（data-field 区分字段）
  onGlobalInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [`global.${field}`]: value });
  },

  // 保存全局规则（带校验：各项必须 ≥ 1）
  async saveGlobal() {
    const g = this.data.global;
    if (!g.daily_limit || g.daily_limit < 1) { wx.showToast({ title: '每日上限必须 ≥ 1', icon: 'none' }); return; }
    if (!g.history_count || g.history_count < 1) { wx.showToast({ title: '历史条数必须 ≥ 1', icon: 'none' }); return; }
    if (!g.favorite_limit || g.favorite_limit < 1) { wx.showToast({ title: '收藏上限必须 ≥ 1', icon: 'none' }); return; }
    if (!g.recycle_days || g.recycle_days < 1) { wx.showToast({ title: '回收天数必须 ≥ 1', icon: 'none' }); return; }

    this.setData({ savingGlobal: true });
    try {
      await api.updateGlobalRule({
        daily_limit: Number(g.daily_limit),
        history_count: Number(g.history_count),
        favorite_limit: Number(g.favorite_limit),
        recycle_days: Number(g.recycle_days),
      });
      // 保存全局后，自动清除“个人规则低于全局规则”的个人覆盖项（他们会回退到全局）
      let cleared = 0;
      try {
        const res = await api.clearPersonalRulesBelowGlobal();
        cleared = (res && res.cleared_count) || 0;
      } catch (e) {
        // 清除失败不影响主流程
        console.warn('clearPersonalRulesBelowGlobal failed', e);
      }
      wx.showToast({
        title: cleared > 0 ? '已保存（清除 ' + cleared + ' 项个人规则）' : '已保存',
        icon: 'success',
        duration: 2500,
      });
      // 刷新员工列表，让被清除的项显示为“默认”
      this.loadAll();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingGlobal: false });
    }
  },

  // 点击邀约员 → 跳转到个人规则设置页
  goUserRule(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/admin-rules/admin-user-rule/admin-user-rule?uid=' + id });
  },

  // 搜索员工：按姓名/账号子串过滤
  onAgentSearch(e) {
    const kw = (e.detail.value || '').trim().toLowerCase();
    const filtered = this._filterAgents(kw);
    this.setData({ searchKeyword: e.detail.value, filteredAgents: filtered });
  },

  // 清空搜索
  onAgentSearchClear() {
    this.setData({ searchKeyword: '', filteredAgents: this.data.agents });
  },

  // 过滤逻辑抽取（供两个 handler 复用）
  _filterAgents(kw) {
    return (this.data.agents || []).filter(u => {
      const name = (u.real_name || '').toLowerCase();
      const user = (u.username || '').toLowerCase();
      return !kw || name.includes(kw) || user.includes(kw);
    });
  },
});
