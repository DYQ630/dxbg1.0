/**
 * admin-stats.js - 数据统计
 * 按日期范围查看整体 + 人员明细
 */
const api = require('../../utils/api.js');

Page({
  data: {
    loading: false, // 加载中标记
    range: 'week',  // 当前统计范围（today / week / month）
    stats: null,    // 后端返回的统计数据
    // 可选的时间范围 Tab
    ranges: [
      { key: 'today', label: '今日' },
      { key: 'week',  label: '本周' },
      { key: 'month', label: '本月' },
    ],
  },

  // 页面每次显示：校验管理员角色并加载当前范围统计
  onShow() {
    if (!getApp().enforceRole('admin')) return;
    this.loadStats(this.data.range);
  },

  // 下拉刷新：重新加载统计
  onPullDownRefresh() {
    this.loadStats(this.data.range).finally(() => wx.stopPullDownRefresh());
  },

  /**
   * 按范围加载统计数据
   * @param {string} range - today / week / month
   */
  async loadStats(range) {
    this.setData({ loading: true });
    try {
      const res = await api.getAdminStats(range);
      this.setData({ stats: res || null, loading: false });
    } catch (e) {
      console.error('loadStats error', e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 切换时间范围 Tab
  onTabChange(e) {
    const range = e.currentTarget.dataset.key;
    if (range === this.data.range) return;
    this.setData({ range });
    this.loadStats(range);
  },

  // 返回上一页
  goBack() {
    wx.navigateBack();
  },
});
