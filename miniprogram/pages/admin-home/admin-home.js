/**
 * ============================================================
 * pages/admin-home/admin-home.js - 管理员首页
 * ============================================================
 * 【模块职责】
 *   并行加载今日/本周统计 + 号码池总览 + 员工拨打量排行榜，
 *   提供快捷入口跳转到号码池、回收池、用户管理、规则设置等模块。
 *
 * 【数据加载（loadData）】
 *   三个接口并行 Promise.all：
 *     1. api.getAdminStats(range) → overview（总拨打量/接通量等）+ details（每员工明细）
 *     2. api.getPoolStats()       → 号码池总览（total/remaining/assigned/used）
 *     3. api.getUsers()           → 员工列表，用于 details 中 user_id → real_name 映射
 *
 * 【员工卡字段说明】
 *   total_used        : 拨打量（默认排序维度）
 *   wechat_added      : 加微信量
 *   meeting_scheduled : 到店量（后端暂未返回该字段，前端显示 0）
 *   connected/unconnected : 接通/未接通（后端 detail 中返回）
 *
 * 【D2 修复内容】
 *   员工数/标签数卡片副标题改用真实后端统计（wx.request 直接拉取），
 *   失败时显示 "—" 而非 0，避免误以为没数据。
 *
 * 【排序】
 *   默认按 total_used（拨打量）降序；支持切换为 wechat_added 或 meeting_scheduled
 * ============================================================
 */
const api = require('../../utils/api.js');

// 与 api.js 保持一致的本地开发 BASE_URL
const BASE_URL = 'http://192.168.110.173:8000';

// 取登录 token（与 api.js 逻辑一致）
function getToken() {
  const app = getApp() || {};
  return (app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
}

// 兼容多种返回形态，统一成数组
function toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

// 6 种头像渐变背景（循环用）
const AVATAR_BG = [
  'linear-gradient(135deg, #FF6B9D, #FFA8C5)',
  'linear-gradient(135deg, #5B8FF9, #8FB6FF)',
  'linear-gradient(135deg, #67C23A, #95D475)',
  'linear-gradient(135deg, #E6A23C, #EEBE77)',
  'linear-gradient(135deg, #9B59B6, #C39BD3)',
  'linear-gradient(135deg, #1ABC9C, #76D7C4)',
];

// 根据用户 id 哈希挑选一个渐变背景
function pickBg(uid) {
  const id = Number(uid) || 0;
  return AVATAR_BG[id % AVATAR_BG.length];
}

// 取姓名首字（兜底处理空名）
function pickInitial(name) {
  if (name && typeof name === 'string' && name.length) {
    return name.charAt(0);
  }
  return '?';
}

Page({
  data: {
    range: 'week',
    loading: true,
    loadError: false,
    stats: { overview: {} },
    pool: null,
    employees: [],
    // 【排序】排序维度
    sortField: 'total_used',
    currentSortLabel: '拨打量',
    sortOptions: [
      { label: '拨打量', value: 'total_used' },
      { label: '加微量', value: 'wechat_added' },
      { label: '到店量', value: 'meeting_scheduled' },
    ],
    // 【D2】真实后端统计字段（初始空字符串 = 加载中）
    userCount: '',
    tagCount: '',
    dailyLimitTotal: 0,
    todayStr: '',
  },

  // ============================================================
  // onShow：每次页面显示时触发
  // 职责：校验管理员角色（未登录/非管理员自动跳转），然后加载数据
  // ============================================================
  onShow() {
    if (!getApp().enforceRole('admin')) return;
    this.loadData();
  },

  // ============================================================
  // onPullDownRefresh：下拉刷新
  // ============================================================
  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  // ============================================================
  // loadData：核心数据加载
  // 【功能】并行拉取三项数据：今日/本周统计 + 号码池总览 + 员工列表
  //         员工列表用于将 user_id 映射为真实姓名，并计算每日上限合计
  //
  // 【参数来源】this.data.range：'today' 或 'week'（由 onRangeChange 切换）
  //
  // 【数据转换逻辑】
  //   1. stats.details（每员工拨打量明细）按 user_id 与 users 列表匹配姓名
  //   2. 未匹配到时用 '员工' + user_id 兜底
  //   3. 头像首字 + 渐变色根据 user_id 取模确定（6 种循环）
  //   4. 按 this.data.sortField 降序排列（默认拨打量）
  //   5. 每日上限 total = 所有 is_active=true 员工的 daily_limit 之和
  //
  // 【失败处理】loadError=true + Toast 提示"加载失败"，不阻塞页面渲染
  // ============================================================
  async loadData() {
    const now = new Date();
    const todayStr = (now.getMonth() + 1) + '月' + now.getDate() + '日 '
      + String(now.getHours()).padStart(2, '0') + ':'
      + String(now.getMinutes()).padStart(2, '0');
    this.setData({ loading: true, loadError: false, todayStr });

    // 【D2】并行拉取卡片计数（独立、不阻塞主流程，失败显示 —）
    this.loadCounts();

    try {
      const [stats, pool, users] = await Promise.all([
        api.getAdminStats(this.data.range),
        api.getPoolStats(),
        api.getUsers(), // 用于员工映射 + 每日上限合计
      ]);

      const statsData = stats || { overview: {}, details: [] };
      const userList = toArray(users);
      const usersMap = {};
      let dailyLimitTotal = 0;
      userList.forEach((u) => {
        usersMap[u.id] = u;
        if (u.is_active !== false) {
          dailyLimitTotal += Number(u.daily_limit) || 0;
        }
      });

      const employees = (statsData.details || [])
        .map((d) => {
          const matched = usersMap[d.user_id] || {};
          const real_name = d.real_name
            || matched.real_name
            || matched.username
            || ('员工' + d.user_id);
          return {
            user_id: d.user_id,
            real_name: real_name,
            initial: pickInitial(real_name),
            total_used: d.total_used || 0,
            connected: d.connected || 0,
            unconnected: d.unconnected || 0,
            wechat_added: d.wechat_added || 0,
            // 到店量：后端 detail 暂未返回该字段，前端先按 0 显示（后端待补字段）
            meeting_scheduled: d.meeting_scheduled || 0,
            bgColor: pickBg(d.user_id),
          };
        })
        .sort((a, b) => {
          return (Number(b[this.data.sortField]) || 0) - (Number(a[this.data.sortField]) || 0);
        });

      this.setData({
        stats: { overview: statsData.overview || {} },
        pool: pool || null,
        employees: employees,
        dailyLimitTotal: dailyLimitTotal,
        loading: false,
      });
    } catch (e) {
      this.setData({ loadError: true, loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 【D2】并行拉取员工数 / 标签数（真实后端统计）
  loadCounts() {
    const self = this;
    const token = getToken();
    const header = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    };

    // 员工数：GET /api/admin/users
    wx.request({
      url: BASE_URL + '/api/admin/users',
      method: 'GET',
      header: header,
      success(res) {
        if (res.statusCode >= 400) {
          self.setData({ userCount: '—' });
          return;
        }
        self.setData({ userCount: toArray(res.data).length });
      },
      fail() {
        self.setData({ userCount: '—' });
      },
    });

    // 标签数：GET /api/admin/tags
    wx.request({
      url: BASE_URL + '/api/admin/tags',
      method: 'GET',
      header: header,
      success(res) {
        if (res.statusCode >= 400) {
          self.setData({ tagCount: '—' });
          return;
        }
        self.setData({ tagCount: toArray(res.data).length });
      },
      fail() {
        self.setData({ tagCount: '—' });
      },
    });
  },

  // 切换排序维度（拨打量 / 加微量 / 到店量）
  onSortChange: function(e) {
    var idx = e.detail.value;
    var opt = this.data.sortOptions[idx];
    if (!opt) return;
    var sorted = (this.data.employees || []).slice().sort(function(a, b) {
      return (Number(b[opt.value]) || 0) - (Number(a[opt.value]) || 0);
    });
    this.setData({ sortField: opt.value, currentSortLabel: opt.label, employees: sorted });
  },

  // 切换 今日/本周
  onRangeChange(e) {
    const range = e.currentTarget.dataset.range;
    if (range === this.data.range) return;
    this.setData({ range: range, employees: [], loading: true });
    this.loadData();
  },

  // 员工卡点击：透传 userid 进入员工管理页
  onEmpTap(e) {
    const userId = e.currentTarget.dataset.userid;
    wx.navigateTo({
      url: '/pages/admin-users/admin-users' + (userId ? '?userId=' + userId : ''),
    });
  },

  goPool() {
    // admin-pool 在 app.json tabBar.list 里，必须用 switchTab
    wx.switchTab({ url: '/pages/admin-pool/admin-pool' });
  },

  goRecycle() {
    // admin-recycle 同样在 tabBar.list 里，必须用 switchTab
    wx.switchTab({ url: '/pages/admin-recycle/admin-recycle' });
  },

  goUsers() {
    wx.navigateTo({ url: '/pages/admin-users/admin-users' });
  },

  goTags() {
    wx.navigateTo({ url: '/pages/admin-tags/admin-tags' });
  },

  goRules() {
    wx.navigateTo({ url: '/pages/admin-rules/admin-rules' });
  },
});
