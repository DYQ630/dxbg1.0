/**
 * ============================================================
 * pages/admin-pool/admin-pool.js - 号码池管理页
 * ============================================================
 * 【模块职责】
 *   管理员查看和管理所有手机号码：按状态过滤、分页浏览、
 *   按拨打次数筛选、关键词搜索、Excel 批量导入。
 *
 * 【号码状态语义】
 *   available / pool  : 待分配 → 号码在池中，等待邀约员领取
 *   assigned          : 已分配 → 某邀约员已领取但尚未使用
 *   recycled / used   : 已使用 → 邀约员已使用并提交记录
 *   favorite          : 已收藏 → 邀约员收藏的号码（仍在使用中）
 *
 * 【分页加载逻辑（loadNumbers）】
 *   1. isRefresh（page===1）时：重置列表，同步拉 getPoolStats 更新顶部统计卡片
 *   2. loadMore（page>1）时：追加到现有列表，loadingMore=true 显示"加载中..."
 *   3. hasMore = 本次返回条数 >= pageSize，说明还有下一页
 *
 * 【状态 Tab 切换逻辑（onTabChange）】
 *   - 切换到「可用/已分/已使用」Tab 时：清空使用次数筛选（避免两者叠加冲突）
 *   - 切回「全部」Tab 时：保留上次使用次数筛选值
 *
 * 【拨打次数筛选（onUsageChipTap）】
 *   仅在「全部」Tab 下可用；点击已选中项取消选择
 *
 * 【Excel 导入（doImport）】
 *   通过 wx.chooseMessageFile 选择 Excel/CSV 文件，
 *   调 api.importNumbers() 上传，后端解析并入库，返回成功条数
 * ============================================================
 */
const api = require('../../utils/api.js');

const TABS = [
  { value: 'all',       label: '全部' },
  { value: 'available', label: '可用' },
  { value: 'assigned',  label: '已分' },
  { value: 'recycled',  label: '已使用' },
];

const USAGE_FILTERS = [
  { value: 'unused',    label: '未拨打',   param: 'unused'     },
  { value: 'used_1',    label: '已用1次',  param: 'used_1'     },
  { value: 'used_2',    label: '已用2次',  param: 'used_2'     },
  { value: 'used_3',    label: '已用3次',  param: 'used_3'     },
  { value: 'used_4plus',label: '4次以上',  param: 'used_4plus' },
];

Page({
  data: {
    tabs: TABS,
    activeTab: 'all',
    usageFilters: USAGE_FILTERS,
    usageFilter: '',
    searchKeyword: '',
    numbers: [],
    totalNum: 0,
    poolStats: {
      total: 0,
      pool_remaining: 0,
      used: 0,
      by_usage: { '0': 0, '1': 0, '2': 0, '3': 0, '4plus': 0 }
    },
    usageCounts: { unused: 0, used_1: 0, used_2: 0, used_3: 0, used_4plus: 0 },
    loading: false,
    loadingMore: false,
    page: 1,
    hasMore: true,
    pageSize: 20,
  },

    onShow() {
    if (!getApp().enforceRole('admin')) return;
    // 每次进入重置筛选条件，保证能看到回收池恢复过来的新号码
    this.setData({ activeTab: 'all', usageFilter: '', searchKeyword: '' });
    this.loadNumbers(1);
    // 不论是否 isRefresh，从回收池恢复号码后回来时都需要重拉总览以更新三张卡片
    api.getPoolStats().then(s => {
      const stats = s && (s.overview || s) || {};
      const byUsage = stats.by_usage || {};
      this.setData({
        'poolStats.total':         stats.total          || 0,
        'poolStats.pool_remaining': stats.pool_remaining || 0,
        'poolStats.assigned':      stats.assigned       || 0,
        'poolStats.used':          stats.used           || 0,
        usageCounts: {
          unused:     byUsage['0']     || 0,
          used_1:     byUsage['1']     || 0,
          used_2:     byUsage['2']     || 0,
          used_3:     byUsage['3']     || 0,
          used_4plus: byUsage['4plus'] || 0,
        },
      });
    }).catch(() => {});
  },

  onPullDownRefresh() {
    this.loadNumbers(1).finally(() => wx.stopPullDownRefresh());
  },

  /* ── 号码列表加载 ── */
  // 【功能】分页加载号码列表，支持状态 Tab + 拨打次数筛选 + 关键词搜索
  // 【参数】page: 页码（1=刷新/首次加载，>1=加载更多）
  // 【逻辑】
  //   - isRefresh（page===1）：清空列表，重置分页状态，同步拉 getPoolStats 更新顶部统计
  //   - loadMore（page>1）：将新数据追加到现有列表尾部
  //   - params 构建：status（tab）+ usage_filter（chip）+ keyword（搜索）
  //   - 每条号码新增 _revealed=false（默认打码）+ _cssClass（状态颜色）
  //   - hasMore = 本次返回条数 >= pageSize
  async loadNumbers(page) {
    const { activeTab, pageSize, usageFilter, searchKeyword } = this.data;
    const isRefresh = page === 1;
    this.setData({ [isRefresh ? 'loading' : 'loadingMore']: true });

    try {
      const params = { page, page_size: pageSize };
      if (activeTab !== 'all')      params.status = activeTab;
      // 互斥规则：仅在「全部」tab 下才允许叠加使用次数筛选
      if (usageFilter && activeTab === 'all') params.usage_filter = usageFilter;
      if (searchKeyword)            params.keyword = searchKeyword.trim();

      // 首次加载同步拉池状态（全量 poolStats.total 供顶部展示；usageCounts 供 chip 计数）
      if (isRefresh) {
        api.getPoolStats().then(s => {
          const stats = s && (s.overview || s) || {};
          const byUsage = stats.by_usage || {};
          this.setData({
            // 顶部 total + 三个卡片：全量真实数字（不受 activeTab / usage_filter 影响）
            'poolStats.total':         stats.total         || 0,
            'poolStats.pool_remaining': stats.pool_remaining || 0,
            'poolStats.assigned':      stats.assigned      || 0,
            'poolStats.used':          stats.used          || 0,
            usageCounts: {
              unused:     byUsage['0']     || 0,
              used_1:     byUsage['1']     || 0,
              used_2:     byUsage['2']     || 0,
              used_3:     byUsage['3']     || 0,
              used_4plus: byUsage['4plus'] || 0,
            },
          });
        }).catch(() => {});
      }

      const res = await api.getAdminNumbers(params);
      // 后端返回 {list, total, status_counts}（status_counts = 当前筛选条件下的 facet）
      const rawList = Array.isArray(res) ? res : (res && res.list ? res.list : (res && res.value ? res.value : []));
      const serverTotal = (res && res.total != null) ? res.total : 0;
      const statusCounts = (res && res.status_counts) ? res.status_counts : {};
      console.log('[loadNumbers] activeTab=', activeTab, 'serverTotal=', serverTotal, 'statusCounts=', statusCounts);
      // 给每条新增号码默认打码（_revealed=false），点击卡片后切换为完整号码
      const list = rawList.map(item => ({ ...item, _revealed: false, _cssClass: this._deriveCssClass(item) }));
      const merged = isRefresh ? list : this.data.numbers.concat(list);

      // 卡片数字（pool_remaining / assigned / used）统一由 getPoolStats() 全量接口驱动；
      // 此处不再用 status_counts facet 覆盖，避免切 tab 后被 facet 过滤值覆盖变成 0。
      const updateData = {
        numbers: merged,
        page,
        hasMore: list.length >= pageSize,
        loading: false,
        loadingMore: false,
      };
      this.setData(updateData);
    } catch (e) {
      console.error('loadNumbers error', e);
      this.setData({ loading: false, loadingMore: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 加载更多：触底或点击"加载更多"时调用，page+1 并追加加载
  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    this.loadNumbers(this.data.page + 1);
  },

  /* ── 点击号码卡片：切换完整 / 打码（与回收池逻辑一致） ── */
  togglePhoneReveal(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx == null || idx < 0 || idx >= this.data.numbers.length) return;
    const numbers = [...this.data.numbers];
    numbers[idx] = { ...numbers[idx], _revealed: !numbers[idx]._revealed };
    this.setData({ numbers });
  },

  /**
   * 状态 tag 的 CSS class 由 status_label 派生，保证文本与颜色一致：
   *  待分配 → pool 蓝、 已使用 → used 绿、 收藏 → favorite 红、 已分配 → assigned 橙、 已回收 → recycled 灰
   */
  _deriveCssClass(item) {
    const label = item.status_label || item.status || '';
    if (label.indexOf('待分配') >= 0) return 'pool';
    if (label.indexOf('已使用') >= 0) return 'used';
    if (label.indexOf('收藏')   >= 0) return 'favorite';
    if (label.indexOf('已分配') >= 0) return 'assigned';
    if (label.indexOf('已回收') >= 0) return 'recycled';
    return item.status || 'pool';
  },

  /* ── 状态 Tab ── */
  onTabChange(e) {
    const val = e.currentTarget.dataset.value;
    if (val === this.data.activeTab) return;
    // 互斥规则：切换到 「可用 / 已分 / 已使用」 时清空使用次数筛选；
    //           切回 「全部」 时保留之前的筛选。
    const nextUsageFilter = val === 'all' ? this.data.usageFilter : '';
    this.setData({
      activeTab:    val,
      usageFilter:  nextUsageFilter,
      numbers: [],
      page: 1,
      hasMore: true,
    });
    this.loadNumbers(1);
  },

  /* ── 搜索 ── */
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  onClearSearch() {
    this.setData({ searchKeyword: '' });
    this.onRefresh();
  },

  onRefresh() {
    this.setData({ numbers: [], page: 1, hasMore: true });
    this.loadNumbers(1);
  },

  /* ── 拨打次数 Chip ── */
  onUsageChipTap(e) {
    // 互斥规则：「可用 / 已分 / 已使用」 tab 下不能点击使用次数筛选
    if (this.data.activeTab !== 'all') return;
    const val = e.currentTarget.dataset.value;
    console.log('[onUsageChipTap] val=', val, 'current=', this.data.usageFilter);
    if (val === this.data.usageFilter) return;
    this.setData({ usageFilter: val, numbers: [], page: 1, hasMore: true });
    this.loadNumbers(1);
  },

  /* ── 导入 ── */
  onImportFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls', 'csv'],
      success: res => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f || !f.path) { wx.showToast({ title: '未选择文件', icon: 'none' }); return; }
        this.doImport(f.path);
      },
      fail: () => wx.showToast({ title: '请选择文件', icon: 'none' }),
    });
  },

  doImport(filePath) {
    wx.showLoading({ title: '导入中...' });
    api.importNumbers(filePath)
      .then(res => {
        wx.hideLoading();
        const success = res && res.success || 0;
        wx.showToast({ title: '成功 ' + success + ' 条', icon: 'success' });
        this.loadNumbers(1);
      })
      .catch(e => {
        wx.hideLoading();
        console.error('import error', e);
        wx.showToast({ title: e && e.errMsg ? e.errMsg : '导入失败', icon: 'none' });
      });
  },

  goBack() {
    wx.navigateBack();
  },
});
