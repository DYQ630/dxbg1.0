/**
 * ============================================================
 * pages/admin-recycle/admin-recycle.js - 回收池管理页
 * ============================================================
 * 【模块职责】
 *   管理员管理已回收的手机号码，支持三维筛选、恢复、永久删除和批量操作。
 *
 * 【回收池号码来源】
 *   1. 超窗回收：邀约员持有号码超过 recycle_days 天未使用，自动流回回收池
 *   2. 手动删除：管理员主动从号码池删除的号码
 *   3. 取消收藏：邀约员取消收藏后，号码回到回收池
 *
 * 【三维筛选（同时生效，组合成一次后端查询）】
 *   1. 员工筛选（竖排左侧，单选）：GET /api/admin/recycle/assignees 获取员工列表
 *   2. 标签筛选（全宽筛选带，多选 OR 逻辑）：GET /api/admin/tags/usage-frequency 获取标签分布
 *   3. 使用次数档位（全宽筛选带，互斥单选）：0次/1次/2次/3次/4次以上
 *
 * 【批量操作逻辑】
 *   - 点击「多选」进入批量模式，selectedMap 记录每条号码勾选状态
 *   - 全选时遍历当前列表所有 id；取消全选清空 selectedIds/selectedMap
 *   - 批量恢复：POST /api/admin/recycle/restore-batch { ids: int[] }
 *   - 批量删除：POST /api/admin/recycle/delete-batch { ids: int[] }（不可逆）
 *
 * 【分页与兜底过滤】
 *   usage_bucket 后端若未实现，前端做客户端兜底过滤（_bucketize → _bucket）
 *   同时增加 pageLimit 到 100 并自动翻页（最多 5 次），避免过滤后空屏
 * ============================================================
 */
const api = require('../../utils/api.js');

// ---------- 本地 request（API 暂未封装的方法走这里） ----------
function localRequest(options) {
  const app = getApp() || {};
  const token = (app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
  return new Promise((resolve, reject) => {
    wx.request({
      url: 'http://192.168.110.173:8000' + options.url,
      method: options.method || 'GET',
      data: options.data || null,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      success(res) {
        if (res.statusCode === 401) { reject({ errMsg: '未登录' }); return; }
        if (res.statusCode >= 400) { reject(res.data || { errMsg: '请求失败' }); return; }
        resolve(res.data);
      },
      fail() { reject({ errMsg: '网络错误' }); },
    });
  });
}

// ---------- 页面 ----------
Page({
  data: {
    // 统计
    recycleStats: { total: 0, today: 0, this_week: 0, this_month: 0 },
    // 员工（竖排左侧）
    assignees: [],
    assigneesTotal: 0,
    activeAssigneeId: null,
    // 标签（主区上方）
    tags: [],
    selectedTags: [],
    // 使用次数档位（主区上方，互斥单选；null = 全部）
    selectedBucket: null,
    usageBuckets: [
      { key: '',      label: '全部',    count: 0, countLabel: '' },
      { key: '0',     label: '0次',     count: 0, countLabel: '' },
      { key: '1',     label: '1次',     count: 0, countLabel: '' },
      { key: '2',     label: '2次',     count: 0, countLabel: '' },
      { key: '3',     label: '3次',     count: 0, countLabel: '' },
      { key: '4plus', label: '4次以上', count: 0, countLabel: '' },
    ],
    // 号码列表
    numbers: [],
    loadingNumbers: false,
    // 分页
    offset: 0,
    limit: 20,
    hasMore: false,
    // 批量
    batchMode: false,
    selectedIds: [],          // 选中 id 数组（用于批量接口）
    selectedMap: {},          // 选中 id 表 {id:true}（用于 WXML 快速索引，最可靠）
    selectedCount: 0,         // 选中个数（用于 batch-bar "已选 N 个"）
    allSelected: false,
  },

  // ============================================================
  // 生命周期
  // ============================================================
  onShow() {
    if (!getApp().enforceRole('admin')) return;
    this._adaptTabBarHeight(); // 动态设置 --tabbar-height，让滚轮区紧贴 tabBar
    this._init();
  },

  /**
   * 动态适配 tabBar 高度
   * 让 .page 高度 = 100vh - tabBar实际高度 - 安全区
   * 解决不同设备 tabBar 高度差异导致的底部空白
   */
  _adaptTabBarHeight() {
    try {
      const sys = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
      const winW = sys.windowWidth || 375;
      // 1px = 750/winW rpx
      const rpxPerPx = 750 / winW;
      // 系统 tabBar 固定高度 49pt = 98rpx（普通、全面屏都一样）
      const tabbarBaseRpx = 49 * 2;
      // 底部安全区（home indicator，iPhone X+ 才会有）
      let safeBottomPx = 0;
      if (sys.safeArea && sys.screenHeight) {
        safeBottomPx = Math.max(0, sys.screenHeight - sys.safeArea.bottom);
      }
      const safeRpx = Math.ceil(safeBottomPx * rpxPerPx);
      // 总 tabBar 高度 = 49pt + 安全区 + 10rpx 留白
      const totalRpx = tabbarBaseRpx + safeRpx + 10;
      // 通过选择器给 .page 设 CSS 变量（覆盖 WXSS 中的默认值）
      const query = wx.createSelectorQuery();
      query.select('.page').node();
      query.exec((res) => {
        const node = res && res[0] && res[0].node;
        if (node && node.style) {
          node.style.setProperty('--tabbar-height', totalRpx + 'rpx');
        }
      });
    } catch (e) {
      console.warn('[admin-recycle] adapt tabbar height failed:', e);
    }
  },

  onPullDownRefresh() {
    this._init().finally(() => wx.stopPullDownRefresh());
  },

  // ============================================================
  // 初始化（并行加载）
  // ============================================================
  async _init() {
    this._rawNumbers = [];
    // 进入页面：重置全部筛选，保证 UI 与数据一致
    this.setData({
      offset: 0, numbers: [], selectedIds: [], selectedMap: {}, selectedCount: 0, allSelected: false,
      selectedTags: [], selectedBucket: null,
      activeAssigneeId: null, activeAssigneeIdForApi: null,
    });
    await this._refreshAll();
  },

  /**
   * 全面刷新：恢复 / 删除 / 批量操作后调用。
   * tag 列表从 usage-frequency 初始化（name/color），tag count 由 numbers.tag_facets 覆盖。
   * _loadTags 在 _loadNumbers 前串行，保证 _applyTagFacets 拿到 tags 数据。
   */
  async _refreshAll() {
    // 先用 usage-frequency 拉 tag 列表（name/color + 全量 count），
    // 再用 _loadNumbers 返回的 tag_facets 覆盖 count（受 selectedBucket 等影响）
    await this._loadStats();
    await this._loadAssignees();
    await this._loadTags();
    await this._loadNumbers(true);
  },

  // ============================================================
  // 数据加载（4 个并行）
  // ============================================================
  async _loadStats() {
    try {
      const stats = await localRequest({ url: '/api/admin/recycle/stats' });
      // 后端 /api/admin/recycle/stats 返回：
      // { total, today, this_week, this_month, week, month, recycled_only }
      this.setData({
        recycleStats: {
          total:     stats.total        || 0,
          today:     stats.today        || 0,
          this_week: stats.this_week    || stats.week || 0,
          this_month:stats.this_month   || stats.month || 0,
        },
      });
    } catch (e) {
      console.error('_loadStats error', e);
    }
  },

  async _loadAssignees() {
    try {
      const res = await localRequest({ url: '/api/admin/recycle/assignees' });
      let list = [];
      let total = 0;
      if (Array.isArray(res)) {
        list = res;
        total = list.reduce((s, a) => s + (a.count || 0), 0);
      } else if (res && Array.isArray(res.list)) {
        list = res.list;
        total = res.total || list.reduce((s, a) => s + (a.count || 0), 0);
      }
      // 统一转为字符串，避免 WXML 中 activeAssigneeId === item.user_id 类型不匹配
      list = list.map(a => ({ ...a, user_id: String(a.user_id) }));
      this.setData({ assignees: list, assigneesTotal: total });
    } catch (e) {
      console.error('_loadAssignees error', e);
      // 降级：尝试用已有的 getRecycleByAgent
      try {
        const fallback = await api.getRecycleByAgent('all');
        const list = Array.isArray(fallback) ? fallback : [];
        const normalized = list.map(a => ({ ...a, user_id: String(a.user_id) }));
        this.setData({ assignees: normalized, assigneesTotal: normalized.reduce((s, a) => s + (a.count || 0), 0) });
      } catch (e2) {}
    }
  },

  async _loadTags() {
    try {
      // facet 0：永远拉“全量号码”的 tag 分布（不受任何筛选影响）。
      // 仅在 _init / _refreshAll（恢复/删除后）调用。
      // 恢复 / 删除后服务端 usage_count 会跟着重算，所以 chip 数会同步。
      const res = await localRequest({ url: '/api/admin/tags/usage-frequency?mode=numbers' });
      const list = Array.isArray(res) ? res : (res && Array.isArray(res.list) ? res.list : []);
      const normalized = list.map(t => ({
        ...t,
        tag_id: t.tag_id != null ? String(t.tag_id) : '',
        // usage_count 是后端返回的全量 chip 数（总回收池中含该 tag 的号码数）
        // 不跟 selectedTags / selectedBucket facet 联动
        usage_count: Number(t.usage_count || t.count || 0),
        count: Number(t.usage_count || t.count || 0),
        _selected: false,
        _activeStyle: '',
      }));
      this.setData({ tags: normalized });
      this._syncTagSelected();
    } catch (e) {
      console.error('_loadTags error', e);
    }
  },

  /** 同步各 tag 的 _selected 状态 + 预计算 inline style，避免 WXML + 拼接不可靠 */
  _syncTagSelected() {
    const selectedSet = new Set((this.data.selectedTags || []).map(String));
    const tags = (this.data.tags || []).map(t => {
      const isSel = selectedSet.has(t.tag_id);
      const color = t.color || '#FF6B9D';
      return {
        ...t,
        _selected: isSel,
        _activeStyle: isSel
          ? `background:${color};border-color:${color};color:#fff;`
          : '',
      };
    });
    this.setData({ tags });
  },

  // ============================================================
  // _loadNumbers：回收池号码列表加载（核心）
  // 【参数】
  //   reset: true=刷新（重置 offset 为 0）；false=追加加载
  //   _depth: 自动翻页深度计数（兜底过滤时使用，最多 5 次）
  //
  // 【构造 QueryString】
  //   assignee_id + tags（逗号分隔）+ usage_bucket + offset + limit
  //
  // 【数据转换】
  //   - id 统一转 string（避免 WXML indexOf 严格相等失配）
  //   - _revealed=false（默认打码），_masked=打码文本，_bucket=档位 key
  //
  // 【hasMore 判断】
  //   优先用后端返回的 total；无 total 时用 items.length >= pageLimit 估算
  //
  // 【客户端兜底过滤】
  //   后端 usage_bucket 未实现时，选中档位后拉大页量（100 条），
  //   过滤后若本页为空但还有数据，自动递归加载（最多 5 层）
  // ============================================================
  async _loadNumbers(reset = false, _depth = 0) {
    if (this._loadingNumbers) return;
    this._loadingNumbers = true;
    this.setData({ loadingNumbers: true });

    const bucket = this.data.selectedBucket;
    // 选中档位时后端可能未实现 usage_bucket，拉大页量以便客户端兜底过滤
    const pageLimit = bucket ? 100 : this.data.limit;
    const offset = reset ? 0 : this.data.offset;
    let autoNext = false;
    try {
      // 构造 query（员工 + 标签 + 使用次数，三维组合）
      const query = [];
      const apiAssigneeId = this.data.activeAssigneeIdForApi;
      if (apiAssigneeId) {
        query.push('assignee_id=' + apiAssigneeId);
      }
      if (this.data.selectedTags.length > 0) {
        query.push('tags=' + this.data.selectedTags.join(','));
      }
      if (bucket) {
        query.push('usage_bucket=' + bucket);
      }
      query.push('offset=' + offset);
      query.push('limit=' + pageLimit);
      const qs = query.length ? '?' + query.join('&') : '';

      const res = await localRequest({ url: '/api/admin/recycle/numbers' + qs });
      let items = [];
      if (Array.isArray(res)) {
        items = res;
      } else if (res && Array.isArray(res.list)) {
        items = res.list;
      } else if (res && Array.isArray(res.numbers)) {
        items = res.numbers;
      }

      // 打码 + 档位标记
      items = items.map(item => ({
        ...item,
        // 统一 id 为 string，避免 WXML indexOf 严格相等失配
        id: item.id != null ? String(item.id) : '',
        _revealed: false,
        _masked: this._maskPhone(item.number),
        _bucket: this._bucketize(item.usage_count),
      }));

      // 分页依据原始（未兜底过滤）数量，避免过滤后无法继续翻页
      // 后端给了 total 就用 total 判断（更准，且能让 chip 计数变为精确值）
      let totalCount = null;
      if (res && !Array.isArray(res)) {
        const t = res.total != null ? res.total
          : (res.total_count != null ? res.total_count : res.count);
        if (t != null && !isNaN(Number(t))) totalCount = Number(t);
      }
      const hasMore = totalCount != null
        ? (offset + items.length) < totalCount
        : items.length >= pageLimit;

      // 原始列表缓存（仅受员工/标签约束），用于前端累加各档数量
      const rawAll = reset ? items : [...(this._rawNumbers || []), ...items];
      this._rawNumbers = rawAll;

      // 客户端兜底过滤（后端已过滤时此步为空操作）
      const visible = bucket ? items.filter(n => n._bucket === bucket) : items;

      this.setData({
        numbers: reset ? visible : [...this.data.numbers, ...visible],
        offset: offset + items.length,
        hasMore,
        allSelected: false,
      });

      this._recomputeBucketCounts(res, rawAll, hasMore);

      // facet C: 用 numbers 返回的 tag_facets 覆盖 tag chip count
      if (reset && res && res.tag_facets) {
        this._applyTagFacets(res.tag_facets);
      }

      // 兜底过滤后本页全被滤掉但后面还有数据 → 自动续拉（限 5 页，避免空屏）
      if (bucket && visible.length === 0 && hasMore && _depth < 5) {
        autoNext = true;
      }
    } catch (e) {
      console.error('_loadNumbers error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this._loadingNumbers = false;
      this.setData({ loadingNumbers: false });
      if (autoNext) this._loadNumbers(false, _depth + 1);
    }
  },

  // ============================================================
  // 使用次数档位工具
  // ============================================================
  /** usage_count → 档位 key（0/1/2/3/4plus） */
  _bucketize(count) {
    const c = Number(count) || 0;
    if (c <= 0) return '0';
    if (c === 1) return '1';
    if (c === 2) return '2';
    if (c === 3) return '3';
    return '4plus';
  },

  /**
   * 各档数量：优先后端聚合（res.usage_buckets / bucket_counts / usageBuckets），
   * 否则用已加载的原始列表前端累加（未拉完时数字带 "+"）。
   */
  _recomputeBucketCounts(res, rawAll, hasMore) {
    const KEYS = ['0', '1', '2', '3', '4plus'];
    const server = res && (res.usage_buckets || res.bucket_counts || res.usageBuckets);
    const counts = {};
    let exact = false;

    if (server && !Array.isArray(server) && typeof server === 'object') {
      KEYS.forEach(k => {
        const v = server[k] != null ? server[k] : server['b' + k];
        counts[k] = Number(v) || 0;
      });
      exact = true;
    } else if (Array.isArray(server)) {
      KEYS.forEach(k => { counts[k] = 0; });
      server.forEach(it => {
        if (!it) return;
        const k = String(it.bucket != null ? it.bucket : it.key);
        if (counts[k] != null) counts[k] = Number(it.count) || 0;
      });
      exact = true;
    } else if (!this.data.selectedBucket) {
      // 仅在“全部”视图下前端累加，避免被后端过滤结果污染
      KEYS.forEach(k => { counts[k] = 0; });
      (rawAll || []).forEach(n => {
        const k = n._bucket;
        if (counts[k] != null) counts[k] += 1;
      });
      exact = !hasMore;
    } else {
      return; // 已选档位且无后端聚合 → 保留“全部”视图下算出的数字
    }

    const total = KEYS.reduce((s, k) => s + (counts[k] || 0), 0);
    const usageBuckets = this.data.usageBuckets.map(b => {
      if (!b.key) return { ...b, count: total, countLabel: '' };
      const c = counts[b.key] || 0;
      let label;
      if (c > 0) label = String(c) + (exact ? '' : '+');
      else label = exact ? '0' : '—';
      return { ...b, count: c, countLabel: label };
    });
    this.setData({ usageBuckets });
  },

  /**
   * facet C：用 numbers 接口返回的 tag_facets 覆盖 tag chip count。
   * scope 与 usage_buckets 完全一致（selectedTags + selectedBucket + assignee_id）。
   * 两列 chip 永远严格对等。
   */
  _applyTagFacets(tagFacets) {
    if (!tagFacets || typeof tagFacets !== 'object') return;
    const tags = (this.data.tags || []).map(t => {
      const c = tagFacets[t.name || t.tag_name];
      if (c == null) return t;
      return { ...t, count: c, usage_count: c };
    });
    this.setData({ tags });
  },

  // ============================================================
  // 使用次数 chip（互斥单选，再次点击取消）
  // ============================================================
  onUsageChipTap(e) {
    const raw = e.currentTarget.dataset.bucket;
    const next = raw === '' || raw === undefined || raw === null ? null : String(raw);
    const cur = this.data.selectedBucket;
    const bucket = next !== null && next === cur ? null : next;
    if (bucket === cur) return;
    this._rawNumbers = [];
    this.setData({
      selectedBucket: bucket,
      offset: 0,
      numbers: [],
      selectedIds: [],
      selectedMap: {},
      selectedCount: 0,
      allSelected: false,
    });
    this._loadNumbers(true);
  },

  // ============================================================
  // 员工选择（竖排左侧）
  // ============================================================
  onAssigneeSelect(e) {
    const id = e.currentTarget.dataset.id;
    // 全部按钮的 data-id=""，给个特殊值 'all' 标记，避免和空字符串歧义
    const assigneeId = id === '' || id == null ? 'all' : String(id);
    if (assigneeId === this.data.activeAssigneeId) return;
    this._rawNumbers = [];
    // 真正传给后端的 id（'all' 视为不过滤）
    this.setData({
      activeAssigneeId: assigneeId,
      activeAssigneeIdForApi: assigneeId === 'all' ? null : assigneeId,
      offset: 0, numbers: [], selectedIds: [], selectedMap: {}, selectedCount: 0, allSelected: false,
    });
    this._loadNumbers(true);
  },

  // ============================================================
  // 标签筛选（主区上方）
  // ============================================================
  onTagChipTap(e) {
    const tagIdRaw = e.currentTarget.dataset.tag;
    // dataset 永远是 string；统一转 string
    const tagId = tagIdRaw != null ? String(tagIdRaw) : '';
    // 互斥单选：点击任意非“全部” chip 都设为唯一选中；点击“全部”清空
    const selected = tagId ? [tagId] : [];
    this._rawNumbers = [];
    this.setData({ selectedTags: selected, offset: 0, numbers: [], selectedIds: [], selectedMap: {}, selectedCount: 0, allSelected: false });
    this._syncTagSelected();
    this._loadNumbers(true);
  },

  // ============================================================
  // 上拉加载更多
  // ============================================================
  onLoadMore() {
    if (!this.data.loadingNumbers && this.data.hasMore) {
      this._loadNumbers(false);
    }
  },

  // ============================================================
  // 号码打码 / 展开
  // ============================================================
  togglePhoneReveal(e) {
    const idx = e.currentTarget.dataset.index;
    const numbers = [...this.data.numbers];
    numbers[idx] = { ...numbers[idx], _revealed: !numbers[idx]._revealed };
    this.setData({ numbers });
  },

  _maskPhone(phone) {
    if (!phone || phone.length < 7) return phone || '';
    return phone.slice(0, 3) + '****' + phone.slice(-4);
  },

  // ============================================================
  // 编辑 / 批量模式
  // ============================================================
  toggleBatchMode() {
    this.setData({
      batchMode: !this.data.batchMode,
      selectedIds: [],
      selectedMap: {},
      selectedCount: 0,
      allSelected: false,
    });
  },

  /** 卡片点击统一入口：批量模式下切换选中；否则切换打码 */
  onCardTap(e) {
    if (this.data.batchMode) {
      return this.toggleSelect(e);
    }
    return this.togglePhoneReveal(e);
  },

  toggleSelect(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const numId = parseInt(id, 10);
    if (!Number.isFinite(numId)) return;
    // 同时维护 selectedIds（数组，给后端）和 selectedMap（对象，给 WXML 索引）
    const ids = [...this.data.selectedIds];
    const map = { ...this.data.selectedMap };
    const idx = ids.indexOf(numId);
    if (idx >= 0) {
      ids.splice(idx, 1);
      delete map[numId];
    } else {
      ids.push(numId);
      map[numId] = true;
    }
    this.setData({
      selectedIds: ids,
      selectedMap: map,
      selectedCount: ids.length,
      allSelected: ids.length === this.data.numbers.length && this.data.numbers.length > 0,
    });
  },

  toggleSelectAll() {
    if (this.data.allSelected) {
      this.setData({
        selectedIds: [], selectedMap: {}, selectedCount: 0, allSelected: false,
      });
    } else {
      const ids = this.data.numbers.map(n => n.id);
      const map = ids.reduce((acc, id) => (acc[id] = true, acc), {});
      this.setData({
        selectedIds: ids,
        selectedMap: map,
        selectedCount: ids.length,
        allSelected: this.data.numbers.length > 0,
      });
    }
  },

  // ============================================================
  // 单条操作
  // ============================================================
  async onRestore(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const ok = await this._confirm('恢复号码', '确认恢复到号码池？');
    if (!ok) return;
    try {
      const res = await api.restoreNumber(id);
      wx.showToast({ title: '已移入号码池', icon: 'success' });
      // 立即更新本地列表中该号码状态，前端不再依赖下次拉取
      const updated = this.data.numbers.map(item =>
        item.id === id ? { ...item, status: res.status || 'pool', status_label: res.status_label || '待分配' } : item
      );
      this.setData({ numbers: updated });
      await this._refreshAll();
    } catch (err) {
      wx.showToast({ title: err && err.errMsg ? err.errMsg : '恢复失败', icon: 'none' });
    }
  },

  async onDeletePermanent(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const ok = await this._confirm('永久删除', '此操作不可恢复，确定删除？', '删除', '#F56C6C');
    if (!ok) return;
    try {
      await api.deleteRecycleNumber(id);
      wx.showToast({ title: '已删除', icon: 'success' });
      await this._refreshAll();
    } catch (err) {
      wx.showToast({ title: err && err.errMsg ? err.errMsg : '删除失败', icon: 'none' });
    }
  },

  // ============================================================
  // 批量删除
  // ============================================================
  async onRestoreBatch() {
    const { selectedIds } = this.data;
    if (!selectedIds.length) {
      wx.showToast({ title: '请先勾选号码', icon: 'none' });
      return;
    }
    const ok = await this._confirm(
      '批量恢复',
      '将 ' + selectedIds.length + ' 个号码移入号码池，确定？',
      '恢复', '#67C23A'
    );
    if (!ok) return;
    try {
      // 后端 SQLAlchemy .in_(ids) 需要 int，这里统一转成 int
      const idsInt = selectedIds.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
      const res = await api.restoreBatch(idsInt);
      const count = (res && res.count) || selectedIds.length;
      wx.showToast({ title: '已移入号码池 ' + count + ' 个', icon: 'success' });
      // 立即把已恢复号码从本地列表移除（status 已变为 pool，不再属于回收池）
      const restoredSet = new Set(idsInt);
      const filtered = this.data.numbers.filter(item => !restoredSet.has(item.id));
      this.setData({
        numbers: filtered, batchMode: false,
        selectedIds: [], selectedMap: {}, selectedCount: 0, allSelected: false,
      });
      await this._refreshAll();
    } catch (err) {
      wx.showToast({ title: err && err.errMsg ? err.errMsg : '恢复失败', icon: 'none' });
    }
  },

  async onDeletePermanentBatch() {
    const { selectedIds } = this.data;
    if (!selectedIds.length) {
      wx.showToast({ title: '请先勾选号码', icon: 'none' });
      return;
    }
    const ok = await this._confirm(
      '批量永久删除',
      '此操作不可恢复！\n将删除 ' + selectedIds.length + ' 个号码，确定？',
      '删除', '#F56C6C'
    );
    if (!ok) return;
    try {
      // 后端 SQLAlchemy .in_(ids) 需要 int，这里统一转成 int
      const idsInt = selectedIds.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
      const res = await api.deleteBatch(idsInt);
      const count = (res && res.count) || selectedIds.length;
      wx.showToast({ title: '已删除 ' + count + ' 个', icon: 'success' });
      this.setData({
      batchMode: false,
      selectedIds: [], selectedMap: {}, selectedCount: 0, allSelected: false,
    });
      await this._refreshAll();
    } catch (err) {
      wx.showToast({ title: err && err.errMsg ? err.errMsg : '删除失败', icon: 'none' });
    }
  },

  // ============================================================
  // 工具
  // ============================================================
  _confirm(title, content, confirmText = '确认', confirmColor = '#1989FA') {
    return new Promise(res => {
      wx.showModal({
        title,
        content,
        confirmText,
        confirmColor,
        success: r => res(r.confirm),
        fail: () => res(false),
      });
    });
  },
});
