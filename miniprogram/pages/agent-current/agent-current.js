/**
 * ============================================================
 * pages/agent-current/agent-current.js - 邀约员当前号码页
 * ============================================================
 * 【模块职责】
 *   邀约员每日核心工作页面：领取待跟进号码 → 拨号 → 选标签 → 填备注 → 提交 → 自动换号
 *
 * 【onLoad：显示逻辑】
 *   调 api.getCurrentNumber() 获取当前待跟进号码：
 *     - number 存在 → 显示号码卡片（号码 + 运营商 + 归属地 + 今日进度）
 *     - number 不存在 → 显示原因（可能已达每日上限，或号码池为空）
 *
 * 【拨号业务约束】
 *   hasDialed 必须为 true 才能选标签/填备注/提交
 *   → 防止邀约员跳过拨号直接提交记录，导致漏单
 *   → 拨号成功后（wx.makePhoneCall success）hasDialed 置 true
 *   → 用户取消拨号不触发 hasDialed
 *
 * 【submitUsage：提交标签+备注】
 *   成功后自动 loadNext() 换下一个号码
 *   tagList 统一转字符串（后端 UsageIn.tags 要求 List[str]）
 *
 * 【换号（swapNumber）】
 *   主动放弃当前号码（当前号码回到回收池），重新领取下一个
 *   调用 api.getNextNumber() → loadNext()
 * ============================================================
 */

const api = require('../../utils/api.js');
const fmt = require('../../utils/format.js');

// 内置标签兜底（后端标签接口不可用时使用）
// id 与后端数据库 tag.id 对齐（统一字符串），API 恢复后选中状态可正常衔接
const BUILTIN_TAGS = [
  { id: '7', name: '已接通',   color: '#67C23A' },
  { id: '8', name: '未接通',   color: '#F56C6C' },
  { id: '3', name: '已加微信',  color: '#5B8FF9' },
  { id: '4', name: '已约见',   color: '#E6A23C' },
  { id: '5', name: '已成交',   color: '#9B59B6' },
  { id: '6', name: '暂时搁置',  color: '#909399' },
];

Page({
  data: {
    numberPlain: '',   // 号码明文（用于拨号/切换显示）
    numberMasked: '',  // 号码打码显示
    numberId: '',      // 当前号码 id
    numberDisplay: '', // 当前实际展示的号码文本
    _revealedId: null, // 当前明文展示的号码 id（单选）
    carrier: '',       // 运营商
    region: '',        // 归属地
    tags: [],          // 可选标签列表
    selectedTags: [],  // 已选标签 id 列表
    remark: '',        // 备注文本
    hasAnyTagOrRemark: false, // 是否已选标签或填写备注（控制提交按钮可用）
    hasDialed: false,  // 是否已拨号（业务要求：必须先拨号才能选标签/备注/提交，避免漏单）
    submitting: false, // 提交中标记
    today_used: 0,     // 今日已用号码数
    daily_limit: 60,   // 每日号码上限
    loading: false,    // 加载中标记
  },

  // ============================================================
  // onLoad：页面初次加载
  // 【功能】隐藏底部 TabBar（自定义 TabBar 不需要系统 TabBar），
  //        计算顶部安全区高度（适配刘海屏），结果写入 safeTop 供 WXML 使用
  // ============================================================
  onLoad() {
    wx.hideTabBar({ fail: function(){} });
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const systemInfo = wx.getSystemInfoSync();
    const statusBarHeight = systemInfo.statusBarHeight || 0;
    const top = Math.max(statusBarHeight, menuButton.top);
    this.setData({ safeTop: top });
  },

  // ============================================================
  // onShow：每次页面显示时触发
  // 【功能】校验角色，加载标签与当前号码
  //
  // 【特殊处理：已拨号但未提交的场景】
  //   用户点击拨号后（hasDialed=true），若从系统拨号界面切回小程序，
  //   onShow 会再次触发。此时若调用 loadNext() 会重置 hasDialed=false，
  //   导致标签选框闪一下又锁死（标签样式从 locked 变为可选又立刻变回 locked）。
  //   因此：检测到 hasDialed=true 时直接 return，保留当前号码和已拨号状态，
  //   等用户选完标签/填完备注点击"提交"后再换号。
  // ============================================================
  onShow() {
    if (!getApp().enforceRole('agent')) return;
    // 已拨号但未提交：刚从系统拨号界面回来（onShow 会被触发），
    // 此时 loadNext() 会把 hasDialed 重置为 false 导致标签闪一下又锁死。
    // 必须保留当前号码与已拨号状态，等用户选完标签提交后再换号。
    if (this.data.hasDialed) return;
    this.loadTags();
    this.loadNext();
  },

  // ============================================================
  // onPullDownRefresh：下拉刷新，重新加载当前号码与标签
  // ============================================================
  onPullDownRefresh() {
    Promise.all([this.loadNext(), this.loadTags()]).finally(function() {
      wx.stopPullDownRefresh();
    });
  },

  // ============================================================
  // loadNext：加载当前待跟进号码
  // 【功能】调 api.getCurrentNumber() → 更新 data 中的号码/运营商/归属地/今日用量等字段
  //
  // 【数据写入】
  //   - numberPlain / numberMasked / numberId / numberDisplay / _revealedId
  //   - carrier / region
  //   - today_used / daily_limit（从后端返回写入，供进度条渲染）
  //   - app.globalData.rule（供 agent-history 的 _getLimit() 读取）
  //
  // 【表单重置】每次换号：selectedTags=[]、remark=''、hasAnyTagOrRemark=false、
  //                       hasDialed=false、每个 tag._selected=false
  // ============================================================
  loadNext: function() {
    var self = this;
    self.setData({ loading: true });
    api.getCurrentNumber().then(function(res) {
      var num = (res && res.number) || null;
      var plain = num ? (num.number_plain || '') : '';
      var masked = num ? (num.number_masked || fmt.maskNumber(plain)) : '';
      // 存全局规则：供 agent-history 的 _getLimit() 读取（用于分页 page_size）
      var app = getApp();
      if (app && app.globalData) {
        app.globalData.rule = {
          daily_limit: (res && res.daily_limit) || 60,
          history_count: (res && res.history_count) || 10,
          favorite_limit: (res && res.favorite_limit) || 5,
          recycle_days: (res && res.recycle_days) || 7,
        };
      }
      self.setData({
        numberPlain: plain,
        numberMasked: masked,
        numberId: num ? (num.id || '') : '',
        numberDisplay: masked,
        _revealedId: null,
        carrier: num ? (num.carrier || '') : '',
        region: num ? (num.region || '') : '',
        today_used: (res && res.today_used) || 0,
        daily_limit: (res && res.daily_limit) || 60,
        // 每次换号重置表单 + 标签选中态
        selectedTags: [],
        remark: '',
        hasAnyTagOrRemark: false,
        hasDialed: false,  // 换号后必须重新拨号才能记录
        // 重要：WXML 渲染依赖 item._selected，需重置每个 tag 的 _selected 标记，
        // 否则上一个号码选过的标签在换号后还会保持高亮态。
        tags: (self.data.tags || []).map(function(t) {
          return Object.assign({}, t, { _selected: false });
        }),
      });
    }).catch(function(e) {
      wx.showToast({ title: (e && e.errMsg) || '加载失败', icon: 'none' });
    }).finally(function() {
      self.setData({ loading: false });
    });
  },

  // 加载标签（失败时用内置标签兜底）
  loadTags: function() {
    var self = this;
    api.getTags().then(function(res) {
      var list = (res && res.value) || res;
      if (!Array.isArray(list) || list.length === 0) list = BUILTIN_TAGS;
      // 统一把 id 转成字符串，与后端 UsageIn.tags: List[str] 对齐；
      // 同时解决“已选 1 个”但高亮不亮起的 indexOf 类型不匹配问题。
      var tags = list.map(function(t) {
        if (typeof t === 'string') return { id: t, name: t, color: '' };
        return { id: String(t.id), name: t.name, color: t.color || '' };
      });
      self.setData({ tags: tags });
    }).catch(function() {
      self.setData({ tags: BUILTIN_TAGS });
    });
  },

  // 点击号码/显示按钮：切换打码/明文
  onTapNumber: function() {
    var result = fmt.tapReveal(
      this.data.numberPlain,
      this.data._revealedId,
      this.data.numberId,
      this
    );
    this.setData({ _revealedId: result._revealedId, numberDisplay: result.numberDisplay });
  },

  // 选择标签（多选，再次点击取消）
  onTapTag: function(e) {
    if (!this.data.hasDialed) {
      wx.showToast({ title: '请先点击拨号按钮', icon: 'none' });
      return;
    }
    var tag = e.currentTarget.dataset.tag;
    if (!tag) return;
    var selectedTags = this.data.selectedTags.slice();
    var idx = selectedTags.indexOf(tag.id);
    if (idx > -1) {
      selectedTags.splice(idx, 1);
    } else {
      selectedTags.push(tag.id);
    }
    // 重新计算每个 tag 的 _selected 标记，WXML 直接 {{item._selected}} 读取，
    // 避免 indexOf 在 WXML 表达式里由于类型问题导致 selected 不生效。
    var tags = (this.data.tags || []).map(function(t) {
      var hit = selectedTags.indexOf(t.id) > -1;
      return Object.assign({}, t, { _selected: hit });
    });
    this.setData({
      selectedTags: selectedTags,
      tags: tags,
      hasAnyTagOrRemark: selectedTags.length > 0 || this.data.remark.length > 0,
    });
  },

  // 备注输入
  onRemarkInput: function(e) {
    if (!this.data.hasDialed) {
      wx.showToast({ title: '请先点击拨号按钮', icon: 'none' });
      // 同步清空输入框，否则 textarea 会显示出来又立刻被重置导致闪烁
      this.setData({ remark: '' });
      return;
    }
    var remark = e.detail.value || '';
    this.setData({
      remark: remark,
      hasAnyTagOrRemark: this.data.selectedTags.length > 0 || remark.length > 0,
    });
  },

  // 提交使用记录 → 自动切到下一个号码
  onSubmit: function() {
    var self = this;
    if (self.data.submitting) return;
    // 业务要求：未拨号不能提交，避免邀约员以选标签代替实际拨号的漏单行为
    if (!self.data.hasDialed) {
      wx.showToast({ title: '请先点击拨号按钮', icon: 'none' });
      return;
    }
    // 必须至少选择标签或填写备注，防止空提交
    if (!self.data.hasAnyTagOrRemark) {
      wx.showToast({ title: '请选择标签或填写备注', icon: 'none' });
      return;
    }
    self.setData({ submitting: true });
    // 修复：tags 后端 schema 要求 List[str]，但 selectedTags 里存的是数据库整数 ID。
    // 这里统一把 id 转成字符串，避免 422: Input should be a valid string。
    var tagList = (self.data.selectedTags || []).map(function(t) {
      return typeof t === 'number' ? String(t) : String(t);
    });
    api.submitUsage({
      number_id: self.data.numberId,
      tags: tagList,
      note: self.data.remark || '',
      is_favorite: false,
    }).then(function() {
      wx.showToast({ title: '已记录', icon: 'success' });
      self.loadNext();
    }).catch(function(e) {
      wx.showToast({ title: (e && e.errMsg) || '提交失败', icon: 'none' });
    }).finally(function() {
      self.setData({ submitting: false });
    });
  },

  // 拨打电话（调用系统拨号）
  // 业务约束：必须先拨号才能选标签/备注/提交，避免邀约员漏记录。
  // 触发后认为“已拨号”（用户取消不视为已拨号）。
  callNumber: function() {
    var num = this.data.numberPlain || this.data.numberMasked || '';
    if (!num) return;
    var self = this;
    wx.makePhoneCall({
      phoneNumber: String(num),
      success: function() {
        // 拨号成功（进入系统拨号界面）= 已拨号，解锁标签/提交
        self.setData({ hasDialed: true });
      },
      fail: function(err) {
        // 用户主动取消不视为已拨号
        if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '拨打电话失败', icon: 'none' });
        }
      },
    });
  },

  // 底部 Tab 导航
  goHistory:   function() { wx.reLaunch({ url: '/pages/agent-history/agent-history' }); },
  goFavorites: function() { wx.reLaunch({ url: '/pages/agent-favorite/agent-favorite' }); },
  goProfile:   function() { wx.reLaunch({ url: '/pages/agent-profile/agent-profile' }); },
});
