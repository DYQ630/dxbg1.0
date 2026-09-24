/**
 * ============================================================
 * pages/batch-detail/batch-detail.js - 导入批次号码明细页
 * ============================================================
 * 【页面参数】id（batch_id）
 *   来源：从某个入口（如管理端号码池或批次列表页）点击批次详情，
 *         wx.navigateTo({ url: '/pages/batch-detail/batch-detail?id=' + batchId })
 *
 * 【页面功能】
 *   - 展示某批次导入的号码列表及当前状态
 *   - 状态映射：pool=可用，assigned=已分配，used=使用中，favorite=已收藏，recycled=已回收
 *   - 点击号码行 → 跳转 edit-record 编辑该条使用记录
 *
 * 【数据来源】
 *   - api.getBatchNumbers(batchId) → 该批次下所有号码列表（无分页，一次拉全量）
 *   - api.getBatches()            → 批次信息（用于显示批次名称等元数据）
 * ============================================================
 */
const api = require('../../utils/api.js');

// 号码状态展示映射：状态 key → 文案 + 样式类
const STATUS_MAP = {
  pool: { text: '可用', cls: 's-available' },
  available: { text: '可用', cls: 's-available' },
  assigned: { text: '已分配', cls: 's-assigned' },
  used: { text: '使用中', cls: 's-used' },
  favorite: { text: '已收藏', cls: 's-favorite' },
  recycled: { text: '已回收', cls: 's-recycled' },
};

Page({
  data: {
    batchId: null, // 批次 id（路由参数传入）
    batch: null,   // 批次信息
    numbers: [],   // 该批次号码列表
    loading: false, // 加载中标记
    page: 1,       // 页码（预留）
    hasMore: true, // 是否还有更多（预留）
  },

  // 页面加载：读取批次 id 并加载数据
  onLoad(opt) {
    const id = opt && opt.id;
    // 缺少参数时提示并返回
    if (!id) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({ batchId: Number(id) });
    this.loadData();
  },

  // 加载批次号码 + 批次信息
  async loadData() {
    this.setData({ loading: true });
    try {
      const id = this.data.batchId;
      const [numbers, batches] = await Promise.all([
        api.getBatchNumbers(id),
        api.getBatches(),
      ]);
      let list = (numbers && numbers.value) || numbers;
      if (!Array.isArray(list)) list = [];

      this.setData({
        numbers: list.map((n, i) => Object.assign({}, n, {
          _idx: i + 1,
          number_plain: n.number_plain || n.number || '',
          number_masked: n.number_masked || n.number || '',
          statusInfo: STATUS_MAP[n.status] || { text: n.status || '未知', cls: 's-unknown' },
        })),
        // 该接口无分页参数，一次拉全量
        hasMore: false,
      });

      // 从批次列表中匹配当前批次信息
      const batch = (batches || []).find(b => String(b.id) === String(id));
      if (batch) this.setData({ batch });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 触底加载（预留；当前接口一次拉全量）
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadData();
  },

  // 点击号码行 → 跳转编辑记录页
  onTapNumber(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/edit-record/edit-record?id=' + id });
  },
});
