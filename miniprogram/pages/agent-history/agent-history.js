/**
 * ============================================================
 * pages/agent-history/agent-history.js - 邀约员历史记录页
 * ============================================================
 * 【模块职责】
 *   展示邀约员历史拨打记录,支持打码/明文切换、收藏、编辑、删除。
 *
 * 【分页加载逻辑(loadHistory)】
 *   - 调 api.getHistory({ page:1, limit: N, page_size: N })
 *   - N 来源:_getLimit() 从 app.globalData.rule.history_count 读取,默认 10
 *   - 同时传 limit 和 page_size 双重兜底,客户端再 slice 一次确保不超上限
 *   - 暂无分页按钮/触底加载,历史记录仅展示最近 N 条(由规则决定)
 *
 * 【编辑/删除记录的交互】
 *   - 编辑:onTapEdit → 显示弹窗(标签选择/备注/加微信 checkbox)→ onSaveEdit
 *   - 删除:deleteRecord(id),删除后刷新列表
 *   - 编辑弹窗的 tag_id 只保存第一条标签(业务约定:每条记录一个主标签)
 *
 * 【标签字典(tagsMap)】
 *   历史记录中 tags 可能是字符串 id(如 "6"),需反查为 {name, color},
 *   因此先 loadTags() 构建字典,再 loadHistory() 同步归一化记录
 * ============================================================
 */
const api = require('../../utils/api.js');

// BASE_URL 与 utils/api.js 保持一致(仅在直接 wx.request 兜底时使用)
const BASE_URL = 'http://192.168.110.173:8000';

// ============================================================
// 号码打码 / 明文切换(内联实现,与约定中的 utils/format.js 同逻辑)
// 若后续 utils/format.js 落地,可改为:
//   const fmt = require('../../utils/format.js');
//   const maskNumber = fmt.maskNumber;
//   const tapReveal = fmt.tapReveal;
// 其余代码无需改动,保持向后兼容。
// ============================================================
function maskNumber(plain) {
  const s = String(plain || '');
  if (s.length < 7) return s;                 // 太短不处理
  return s.slice(0, 3) + '****' + s.slice(-4); // 13800001270 -> 138****1270
}

// 单选切换:点同一个收起,点别的展开那个;通过 page.setData 写入 _revealedId
function tapReveal(plain, currentRevealedId, tapId, page) {
  const next = (String(currentRevealedId) === String(tapId)) ? null : tapId;
  if (page && typeof page.setData === 'function') {
    page.setData({ _revealedId: next });
  }
  return next;
}

Page({
  data: {
    records: [],
    loading: false,
    total: 0,
    _revealedId: null,                 // 当前展开明文的号码 id(单选)
    editingRecord: null,
    showEditModal: false,
    editForm: { tag_id: null, remark: '', wechat_added: false },
    tags: [],
  },

  onLoad() {
    wx.hideTabBar({ fail: function(){} });
  },

  onShow() {
    if (!getApp().enforceRole('agent')) return;
    // 刷新 app.globalData.rule(防止管理员修改全局规则后,这里还是旧值)
    this._refreshRule();
    // 先加载 tags,才能在后端返回的 tags 是字符串 id(如 "6")时反查到 name/color;
    // loadTags 返回 tags 字典,供 loadHistory 同步归一化记录。
    const tagsMap = this._getTagsMap();
    if (Object.keys(tagsMap).length > 0) {
      // 已加载过,直接用缓存
      this.loadHistory(tagsMap);
    } else {
      // 首次进入,先 wait loadTags 完成,再 loadHistory(避免竞态下空字典反查不到)
      this.loadTags().then((map) => this.loadHistory(map));
    }
  },

  // 从 /api/agent/current 刷新全局规则到 app.globalData.rule
  _refreshRule() {
    const app = getApp();
    if (!app || !app.globalData) return;
    api.getCurrentNumber().then(res => {
        if (res) {
          app.globalData.rule = {
            daily_limit: res.daily_limit || 60,
            history_count: res.history_count || 10,
            favorite_limit: res.favorite_limit || 5,
            recycle_days: res.recycle_days || 7,
          };
        }
      }).catch(() => { /* 静默失败,_getLimit 会回退到默认 10 */ });
  },

  onPullDownRefresh() {
    this.loadHistory(this._getTagsMap()).finally(() => wx.stopPullDownRefresh());
  },

  // 从用户规则拿 limit(history_count),默认 10
  _getLimit() {
    const app = getApp() || {};
    const rule = (app.globalData && (app.globalData.userRule || app.globalData.rule)) || {};
    const n = parseInt(rule.history_count, 10);
    return (n > 0 && n <= 200) ? n : 10;
  },

  // 从 this.data.tags 现场构建 id → {name, color} 字典
  // (下拉刷新/编辑保存后用)
  _getTagsMap() {
    const m = {};
    (this.data.tags || []).forEach(t => { m[String(t.id)] = { name: t.name, color: t.color }; });
    return m;
  },

  // 归一化记录字段(兼容 number 嵌套 / 平铺、tags 字符串或对象数组)
  _normalizeRecord(r, tagsMap) {
    const num = r.number || {};
    const numberPlain = num.number_plain || r.number_plain || '';
    const numberMasked = num.number_masked || (numberPlain ? maskNumber(numberPlain) : '');
    // tagsMap = { idString -> {name, color} },用于后端返回的 tags 为 "6" 这种 id 字符串时反查
    const tags = Array.isArray(r.tags)
      ? r.tags.map(t => {
          if (typeof t !== 'string') return t;
          const hit = tagsMap && tagsMap[t];
          return hit ? { id: t, name: hit.name, color: hit.color || '' } : { id: t, name: t, color: '' };
        })
      : [];
    return {
      id: r.id,
      usage_id: (r.usage_id != null ? r.usage_id : r.id),
      number_plain: numberPlain,
      number_masked: numberMasked,
      carrier: num.carrier || r.carrier || '',
      region: num.region || r.region || '',
      tags,
      wechat_added: !!r.wechat_added,
      usage_time: r.usage_time || r.used_at || '',
      remark: (r.remark !== undefined && r.remark !== null) ? r.remark : (r.note || ''),
      customer: r.customer || r.client_name || '',
      favorited: !!r.is_favorite,
    };
  },

  // ============================================================
  // loadHistory：加载历史记录
  // 【参数】tagsMap: id→{name,color} 字典（由 loadTags 返回，用于反查标签名称）
  //
  // 【分页逻辑】
  //   仅加载 page=1，数据量由 limit 控制（_getLimit() 从全局规则读取，默认 10）
  //   api.getHistory 只传 page/page_size，limit 作为双重兜底，客户端再 slice 一次
  //
  // 【归一化】_normalizeRecord 处理后端返回的各种字段名差异：
  //   - number: 可能嵌套在 number.number_plain，也可能是平铺的 number_plain
  //   - tags: 可能是字符串 id 数组，也可能是对象数组
  //   - remark/note: 字段名兼容
  // ============================================================
  async loadHistory(tagsMap) {
    if (this.data.loading) return;
    const limit = this._getLimit();
    this.setData({ loading: true });
    try {
      // api.getHistory 仅转发 page / page_size（不含 limit）。
      // 这里同时传 limit（便于后续 api.js 支持时直接生效）与 page_size（当前可用兜底），
      // 客户端再 slice 一次，双重保证"默认最多 N 条"。
      const res = await api.getHistory({ page: 1, limit: limit, page_size: limit });
      const raw = (res && res.records) || (Array.isArray(res) ? res : []);
      const map = tagsMap || this._getTagsMap();
      let records = raw.map(r => this._normalizeRecord(r, map));
      if (records.length > limit) records = records.slice(0, limit);
      this.setData({ records, total: records.length, _revealedId: null });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // ============================================================
  // loadTags：加载标签字典
  // 【功能】调 api.getTags() → 归一化为 {id: string, name, color} 数组
  //        写入 data.tags（WXML 渲染用），并返回 id→{name,color} 字典
  //
  // 【为什么需要字典】
  //   后端返回的历史记录中 tags 字段可能是字符串 id（如 "6"），
  //   loadHistory 需要反查字符串 id 拿到中文 name 和 color，
  //   因此 loadTags 必须在 loadHistory 之前执行（串行等待）
  // ============================================================
  async loadTags() {
    try {
      const res = await api.getTags();
      const list = (res && res.value) || res;
      if (!Array.isArray(list) || list.length === 0) return {};
      const normalized = list.map(t => (typeof t === 'string' ? { id: t, name: t, color: '' } : { id: String(t.id), name: t.name, color: t.color || '' }));
      this.setData({ tags: normalized });
      // 返回字典供 loadHistory 同步归一化记录使用
      const map = {};
      normalized.forEach(t => { map[String(t.id)] = { name: t.name, color: t.color }; });
      return map;
    } catch (e) {
      return {};
    }
  },

  // 号码点击:明文 / 打码 切换(单选)
  onTapNumber(e) {
    const id = e.currentTarget.dataset.id;
    tapReveal(null, this.data._revealedId, id, this);
  },

  // 拨打电话
  onTapCall(e) {
    const num = e.currentTarget.dataset.number;
    if (!num) return;
    wx.makePhoneCall({
      phoneNumber: String(num),
      fail: err => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '拨打失败', icon: 'none' });
        }
      },
    });
  },

  // 收藏:切换 is_favorite 标记(调后端 PUT /api/agent/usage/{id})
  onTapFavorite(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.records.find(r => String(r.id) === String(id));
    if (!item) return;
    const usageId = (item.usage_id != null ? item.usage_id : item.id);
    const willFav = !item.favorited;
    wx.showLoading({ title: willFav ? '收藏中' : '取消中', mask: true });
    this._favoriteRequest(usageId, willFav)
      .then(() => {
        const records = this.data.records.map(r =>
          String(r.id) === String(id) ? Object.assign({}, r, { favorited: willFav }) : r
        );
        this.setData({ records });
        wx.showToast({ title: willFav ? '已收藏' : '已取消收藏', icon: 'success' });
      })
      .catch(err => {
        const msg = (err && (err.detail || err.message || err.errMsg)) || '操作失败';
        wx.showToast({ title: msg, icon: 'none' });
      })
      .finally(() => wx.hideLoading());
  },

  _favoriteRequest(usageId, isFavorite) {
    return api.updateRecord(usageId, { is_favorite: isFavorite });
  },

  // 打开编辑弹窗
  onTapEdit(e) {
    const record = e.currentTarget.dataset.record;
    if (!record) return;
    const firstTag = record.tags && record.tags.length ? record.tags[0] : null;
    this.setData({
      editingRecord: record,
      editForm: {
        tag_id: firstTag ? firstTag.id : null,
        remark: record.remark || '',
        wechat_added: !!record.wechat_added,
      },
      showEditModal: true,
    });
  },

  onEditTagSelect(e) {
    const tag = e.currentTarget.dataset.tag;
    if (!tag) return;
    const next = this.data.editForm.tag_id === tag.id ? null : tag.id;
    this.setData({ editForm: Object.assign({}, this.data.editForm, { tag_id: next }) });
  },

  onEditRemarkInput(e) {
    this.setData({ editForm: Object.assign({}, this.data.editForm, { remark: e.detail.value }) });
  },

  onEditWechatChange(e) {
    this.setData({ editForm: Object.assign({}, this.data.editForm, { wechat_added: e.detail.value }) });
  },

  closeEditModal() {
    this.setData({ showEditModal: false, editingRecord: null });
  },

  // 保存编辑
  async onSaveEdit() {
    const rec = this.data.editingRecord;
    if (!rec) return;
    try {
      await api.updateRecord(rec.id, {
        tag_id: this.data.editForm.tag_id,
        remark: this.data.editForm.remark,
        wechat_added: this.data.editForm.wechat_added,
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showEditModal: false, editingRecord: null });
      this.loadHistory(this._getTagsMap());
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '保存失败', icon: 'none' });
    }
  },

  // 底部 Tab 导航
  goCurrent()   { wx.reLaunch({ url: '/pages/agent-current/agent-current' }); },
  goFavorites() { wx.reLaunch({ url: '/pages/agent-favorite/agent-favorite' }); },
  goProfile()   { wx.reLaunch({ url: '/pages/agent-profile/agent-profile' }); },

  noOp() {},
});
