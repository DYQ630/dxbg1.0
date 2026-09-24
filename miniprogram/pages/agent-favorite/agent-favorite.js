/**
 * ============================================================
 * pages/agent-favorite/agent-favorite.js - 邀约员收藏号码页
 * ============================================================
 * 【模块职责】
 *   展示邀约员收藏的号码列表，支持打码切换、复制号码、取消收藏。
 *
 * 【取消收藏逻辑（cancelFavorite）】
 *   - api.cancelFavorite 在 api.js 中不存在，直接用 wx.request
 *   - POST /api/agent/favorite/cancel { number_id }
 *   - 成功后：本地列表 filter 移除该项，Toast 提示"已取消，已回到回收池"
 *   - 取消收藏的号码不会重新进入当前号码队列，而是回到回收池等待管理员处理
 * ============================================================
 */
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');

// 本地开发 BASE_URL，与 utils/api.js 保持一致
const BASE_URL = 'http://192.168.110.173:8000';

// api.cancelFavorite 在 api.js 中不存在，这里直接走 wx.request
// 后端约定：POST /api/agent/favorite/cancel { number_id } -> 号码回到回收池
function cancelFavoriteRequest(numberId) {
  const app = getApp() || {};
  const token = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + '/api/agent/favorite/cancel',
      method: 'POST',
      data: { number_id: numberId },
      header: Object.assign(
        { 'Content-Type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
      success(res) {
        if (res.statusCode >= 400) {
          reject(res.data || { errMsg: '取消失败（' + res.statusCode + '）' });
          return;
        }
        resolve(res.data);
      },
      fail() {
        reject({ errMsg: '网络错误，请检查网络连接' });
      },
    });
  });
}

Page({
  data: {
    favorites: [],
    loading: false,
    _revealedId: null, // 同时仅 1 个号码展开明文
    tags: [],
  },

  onLoad() {
    wx.hideTabBar({ fail: function(){} });
  },

  onShow() {
    if (!getApp().enforceRole('agent')) return;
    // 先加载 tags，才能在后端返回的 tags 是字符串 id（如 "6"）时反查到 name/color；
    // loadTags 返回 tags 字典，供 loadFavorites 同步归一化记录。
    const tagsMap = this._getTagsMap();
    if (Object.keys(tagsMap).length > 0) {
      this.loadFavorites(tagsMap);
    } else {
      this.loadTags().then((map) => this.loadFavorites(map));
    }
  },

  onPullDownRefresh() {
    this.loadFavorites(this._getTagsMap()).finally(() => wx.stopPullDownRefresh());
  },

  // 从 this.data.tags 现场构建 id → {name, color} 字典
  _getTagsMap() {
    const m = {};
    (this.data.tags || []).forEach(t => { m[String(t.id)] = { name: t.name, color: t.color }; });
    return m;
  },

  // 加载标签字典，保留一份到 data.tags 供 WXML 使用，并返回 id→{name,color} 字典
  async loadTags() {
    try {
      const res = await api.getTags();
      const list = (res && res.value) || res;
      if (!Array.isArray(list) || list.length === 0) return {};
      const normalized = list.map(t => (typeof t === 'string' ? { id: t, name: t, color: '' } : { id: String(t.id), name: t.name, color: t.color || '' }));
      this.setData({ tags: normalized });
      const map = {};
      normalized.forEach(t => { map[String(t.id)] = { name: t.name, color: t.color }; });
      return map;
    } catch (e) {
      return {};
    }
  },

  async loadFavorites(tagsMap) {
    this.setData({ loading: true });
    try {
      const res = await api.getFavorites(); // api.getFavorites 存在，直接使用
      let list = (res && res.value) || res;
      if (!Array.isArray(list)) list = [];
      const map = tagsMap || this._getTagsMap();
      const favorites = list.map(r => {
        const num = r.number || {};
        const plain = num.number_plain || '';
        const masked = num.number_masked || format.maskNumber(plain);
        // tagsMap = { idString -> {name, color} }，反查字符串 id 拿到中文名
        const tags = Array.isArray(r.tags)
          ? r.tags.map(t => {
              if (typeof t !== 'string') return t;
              const hit = map && map[t];
              return hit ? { id: t, name: hit.name, color: hit.color || '' } : { id: t, name: t, color: '' };
            })
          : [];
        return Object.assign({}, r, {
          number: num,
          numberPlain: plain,
          numberMasked: masked,
          numberDisplay: masked, // 默认打码
          // 取消收藏需要 number_id；优先用顶层 number_id，否则回退到 number.id
          number_id: r.number_id != null ? r.number_id : (num.id != null ? num.id : null),
          created_at: r.created_at || r.used_at || '',
          remark: r.note || r.remark || '',
          customer: r.customer || r.customer_name || '',
          tags,
        });
      });
      this.setData({ favorites, _revealedId: null });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 点击号码：用 format.tapReveal 切换明文/打码，同时仅 1 个展开
  onTapNumber(e) {
    const id = e.currentTarget.dataset.id;
    const plain = e.currentTarget.dataset.plain;
    const r = format.tapReveal(plain, this.data._revealedId, id, this);
    const favorites = this.data.favorites.map(f => {
      if (String(f.id) === String(id)) {
        f.numberDisplay = r.numberDisplay;
      } else {
        f.numberDisplay = f.numberMasked; // 其余重置为打码
      }
      return f;
    });
    this.setData({ _revealedId: r._revealedId, favorites });
  },

  // 拨打：复制号码到剪贴板
  onCall(e) {
    const number = e.currentTarget.dataset.number;
    if (!number) return;
    wx.setClipboardData({
      data: String(number),
      success: () => wx.showToast({ title: '已复制号码', icon: 'success' }),
    });
  },

  // 取消收藏（二次确认）
  onTapUnfavorite(e) {
    const numberId = e.currentTarget.dataset.numberId;
    if (numberId == null) return;
    wx.showModal({
      title: '取消收藏',
      content: '取消后该号码将回到回收池，确定取消吗？',
      confirmText: '取消收藏',
      confirmColor: '#F56C6C',
      success: res => {
        if (!res.confirm) return;
        this.doUnfavorite(numberId);
      },
    });
  },

  async doUnfavorite(numberId) {
    try {
      await cancelFavoriteRequest(numberId);
      wx.showToast({ title: '已取消，已回到回收池', icon: 'none' });
      // 本地列表移除该项
      const favorites = this.data.favorites.filter(f => String(f.number_id) !== String(numberId));
      this.setData({ favorites, _revealedId: null });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '取消失败', icon: 'none' });
    }
  },

  // 底部 Tab 导航
  goCurrent() { wx.reLaunch({ url: '/pages/agent-current/agent-current' }); },
  goHistory() { wx.reLaunch({ url: '/pages/agent-history/agent-history' }); },
  goProfile() { wx.reLaunch({ url: '/pages/agent-profile/agent-profile' }); },
});
