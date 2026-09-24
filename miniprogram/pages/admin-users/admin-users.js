/**
 * ============================================================
 * pages/admin-users/admin-users.js - 员工管理页
 * ============================================================
 * 【模块职责】
 *   管理员增删改查邀约员（agent）账号，
 *   支持启用/停用、左滑删除（生成文档备份）、个人规则设置。
 *
 * 【软删除说明】
 *   删除员工时，后端执行软删除（生成文档备份 doc），
 *   弹窗展示：备份文件名、大小、拨打记录条数、关联号码数、个人规则有无
 *   数据不直接抹除，管理员可在备份文档中追溯。
 *
 * 【导出 Excel 触发逻辑】
 *   导出功能在删除流程中触发（删除成功 → showModal 告知文档路径），
 *   并非独立导出按钮；备份文档由后端自动生成。
 *
 * 【前端分页】
 *   首次加载 pageSize=10 个，点"加载更多"每次加 loadStep=15 个，
 *   所有操作（启用/停用/编辑/删除）后重新调用 loadUsers() 刷新全量数据。
 *
 * 【个人规则】
 *   openRule → 跳转 /pages/admin-rules/admin-user-rule/admin-user-rule?uid=id
 *   在个人规则页可单独设置 daily_limit / history_count / favorite_limit / recycle_days
 *   留空表示继承全局规则（由后端处理）
 * ============================================================
 */
const api = require('../../utils/api.js');

// 6 套头像渐变（按 user_id 取模分布）
const GRADIENTS = [
  'linear-gradient(135deg,#FF6B9D 0%,#FF9A76 100%)',
  'linear-gradient(135deg,#9B7EDE 0%,#7C6BE0 100%)',
  'linear-gradient(135deg,#5B8FF9 0%,#5BC8F9 100%)',
  'linear-gradient(135deg,#67C23A 0%,#A6E05A 100%)',
  'linear-gradient(135deg,#E6A23C 0%,#F2C77A 100%)',
  'linear-gradient(135deg,#F56C6C 0%,#FF9A9A 100%)',
];

// 根据用户名生成首字 + 渐变背景
function avatarFor(u) {
  const name = (u.real_name || u.username || ('员工' + (u.user_id || ''))).trim();
  const initial = name ? name.charAt(0) : '?';
  const idx = (((Number(u.user_id) || 0) % GRADIENTS.length) + GRADIENTS.length) % GRADIENTS.length;
  return { initial, bgColor: GRADIENTS[idx] };
}

function emptyForm() {
  return {
    username: '',
    password: '',
    real_name: '',
    role: 'agent',
    daily_limit: '',
    history_count: '',
    favorite_limit: '',
    recycle_days: '',
  };
}

function emptyRuleForm() {
  return { daily_limit: '', history_count: '', favorite_limit: '', recycle_days: '' };
}

// 空串 / null / undefined -> null（继承全局）；否则转数字
function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

Page({
  data: {
    allUsers: [],        // 后端拿全的数组，一次性加载
    users: [],           // 当前渲染的数组（前 N 个）
    loading: false,
    pageSize: 10,        // 首次加载 10 个
    loadStep: 15,        // 点“加载更多”每次加 15

    // 左滑删除
    swipeOpenId: null,   // 当前展开的卡片 id
    swipeOffsetPx: 0,    // 展开偏移量（px，负数向左）
    touchingId: null,    // 正在拖动的卡片 id（拖动期间关闭 transition）
    touchStartX: 0,
    touchStartY: 0,
    touchStartOffset: 0,
    swipeMaxPx: 160,     // 完全展开偏移（px），由 onLoad 计算
    swipeThresholdPx: 80, // 拖过此值释放后完全展开

    editing: null,           // null=关闭；{} = 新建；{user_id} = 编辑
    form: emptyForm(),
    ruleEditing: false,
    ruleUid: null,
    ruleForm: emptyRuleForm(),
    global: { daily_limit: '-', history_count: '-', favorite_limit: '-', recycle_days: '-' },
  },

  onShow() {
    if (!getApp().enforceRole('admin')) return;
    // 初始化滑动参数（px）
    try {
      const sys = wx.getSystemInfoSync();
      const rpxToPx = sys.windowWidth / 750;
      this.setData({
        swipeMaxPx: 160 * rpxToPx,
        swipeThresholdPx: 80 * rpxToPx,
      });
    } catch (e) {}
    this.loadUsers();
  },

  onPullDownRefresh() {
    this.loadUsers().finally(() => wx.stopPullDownRefresh());
  },

  async loadUsers() {
    this.setData({ loading: true });
    try {
      const [res, g] = await Promise.all([
        api.getUsers(),
        api.getGlobalRule().catch(() => null),
      ]);
      // 后端 GET /api/admin/users 直接返回数组 [UserOut]（不是 {users: [...]} 包装）
      // 且 UserOut 用 id 字段（不是 user_id）。这里统一兼容两种返回 + 字段名映射。
      const list = Array.isArray(res) ? res : (res && Array.isArray(res.users) ? res.users : []);
      const mapped = list.map(u => {
        const a = avatarFor(u);
        // 把 id 镜像为 user_id，供 WXML / JS 以 user_id 访问的现有代码使用
        return Object.assign({}, u, {
          user_id: u.id != null ? u.id : u.user_id,
          initial: a.initial,
          bgColor: a.bgColor,
        });
      });
      // 前端分页：首次只渲染前 pageSize (10) 个，点“加载更多”每次加 loadStep (15) 个
      const visible = mapped.slice(0, this.data.pageSize);
      const global = g || {};
      this.setData({
        allUsers: mapped,
        users: visible,
        loading: false,
        global: {
          daily_limit: global.daily_limit != null ? global.daily_limit : '-',
          history_count: global.history_count != null ? global.history_count : '-',
          favorite_limit: global.favorite_limit != null ? global.favorite_limit : '-',
          recycle_days: global.recycle_days != null ? global.recycle_days : '-',
        },
      });
    } catch (e) {
      console.error('loadUsers error', e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 点“加载更多”：每次多加载 loadStep (15) 个，超过总数则全部展示
  loadMoreUsers() {
    const { allUsers, users, loadStep } = this.data;
    const next = Math.min(users.length + loadStep, allUsers.length);
    this.setData({ users: allUsers.slice(0, next) });
  },

  // ---------- 新建 / 编辑 ----------
  openCreate() {
    this.setData({ editing: {}, form: emptyForm() });
  },

  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    // 先收起 swipe，避免操作时看到错位
    if (this.data.swipeOpenId) {
      this.setData({ swipeOpenId: null, swipeOffsetPx: 0 });
    }
    const u = this.data.users.find(x => x.user_id === id) || this.data.allUsers.find(x => x.user_id === id);
    if (!u) return;
    if (u.user_id === 1) {
      wx.showToast({ title: '不能编辑管理员本人', icon: 'none' });
      return;
    }
    this.setData({
      editing: { user_id: u.user_id },
      form: {
        username: u.username || '',
        password: '',
        real_name: u.real_name || '',
        role: u.role || 'agent',
        daily_limit: u.daily_limit != null ? u.daily_limit : '',
        history_count: u.history_count != null ? u.history_count : '',
        favorite_limit: u.favorite_limit != null ? u.favorite_limit : '',
        recycle_days: u.recycle_days != null ? u.recycle_days : '',
      },
    });
  },

  closeEdit() {
    this.setData({ editing: null });
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ form: Object.assign({}, this.data.form, { [field]: e.detail.value }) });
  },

  onRolePick(e) {
    const role = e.currentTarget.dataset.role;
    this.setData({ form: Object.assign({}, this.data.form, { role }) });
  },

  async saveUser() {
    const { form, editing } = this.data;
    const isEdit = !!(editing && editing.user_id);
    if (!isEdit) {
      if (!form.username || !form.username.trim()) {
        wx.showToast({ title: '请填写账号', icon: 'none' }); return;
      }
      if (!form.password || !form.password.trim()) {
        wx.showToast({ title: '请填写密码', icon: 'none' }); return;
      }
    }
    wx.showLoading({ title: '保存中', mask: true });
    try {
      if (isEdit) {
        const data = { real_name: form.real_name, role: form.role };
        if (form.password && form.password.trim()) data.password = form.password;
        const rules = {
          daily_limit: toNum(form.daily_limit),
          history_count: toNum(form.history_count),
          favorite_limit: toNum(form.favorite_limit),
          recycle_days: toNum(form.recycle_days),
        };
        // 仅提交非空的规则字段，空值保持不变（避免误改为继承全局）
        Object.keys(rules).forEach(k => { if (rules[k] !== null) data[k] = rules[k]; });
        await api.updateUser(editing.user_id, data);
        wx.showToast({ title: '已保存', icon: 'success' });
      } else {
        const data = {
          username: form.username.trim(),
          password: form.password,
          real_name: form.real_name.trim() || form.username.trim(),
          role: form.role,
          daily_limit: toNum(form.daily_limit),
          history_count: toNum(form.history_count),
          favorite_limit: toNum(form.favorite_limit),
          recycle_days: toNum(form.recycle_days),
        };
        await api.createUser(data);
        wx.showToast({ title: '已创建', icon: 'success' });
      }
      this.closeEdit();
      this.loadUsers();
    } catch (e) {
      console.error('saveUser error', e);
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // ---------- 启用 / 停用 ----------
  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    const active = e.currentTarget.dataset.active;
    if (this.data.swipeOpenId) {
      this.setData({ swipeOpenId: null, swipeOffsetPx: 0 });
    }
    const u = this.data.users.find(x => x.user_id === id) || this.data.allUsers.find(x => x.user_id === id);
    if (!u) return;
    if (u.user_id === 1) {
      wx.showToast({ title: '不能操作管理员本人', icon: 'none' });
      return;
    }
    const next = !active;
    const label = next ? '启用' : '停用';
    wx.showModal({
      title: label + '确认',
      content: '确定' + label + '员工「' + (u.real_name || u.username) + '」？',
      confirmText: label,
      confirmColor: next ? '#67C23A' : '#F56C6C',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.updateUser(id, { is_active: next });
          wx.showToast({ title: '已' + label, icon: 'success' });
          this.loadUsers();
        } catch (err) {
          wx.showToast({ title: (err && err.errMsg) || '操作失败', icon: 'none' });
        }
      },
    });
  },

  // ---------- 个人规则 ----------
  openRule(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.swipeOpenId) {
      this.setData({ swipeOpenId: null, swipeOffsetPx: 0 });
    }
    const u = this.data.users.find(x => x.user_id === id) || this.data.allUsers.find(x => x.user_id === id);
    if (!u) return;
    if (u.user_id === 1) {
      wx.showToast({ title: '不能修改管理员本人', icon: 'none' });
      return;
    }
    this.setData({
      ruleEditing: true,
      ruleUid: id,
      ruleForm: {
        daily_limit: u.daily_limit != null ? u.daily_limit : '',
        history_count: u.history_count != null ? u.history_count : '',
        favorite_limit: u.favorite_limit != null ? u.favorite_limit : '',
        recycle_days: u.recycle_days != null ? u.recycle_days : '',
      },
    });
  },

  closeRule() {
    this.setData({ ruleEditing: false, ruleUid: null });
  },

  onRuleInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ruleForm: Object.assign({}, this.data.ruleForm, { [field]: e.detail.value }) });
  },

  async saveRule() {
    const { ruleForm, ruleUid } = this.data;
    if (!ruleUid) return;
    const payload = {
      daily_limit: toNum(ruleForm.daily_limit),
      history_count: toNum(ruleForm.history_count),
      favorite_limit: toNum(ruleForm.favorite_limit),
      recycle_days: toNum(ruleForm.recycle_days),
    };
    wx.showLoading({ title: '保存中', mask: true });
    try {
      await api.updateUserRule(ruleUid, payload);
      wx.showToast({ title: '已保存', icon: 'success' });
      this.closeRule();
      this.loadUsers();
    } catch (e) {
      console.error('saveRule error', e);
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // ---------- 左滑删除：手势识别 ----------
  onSwipeStart(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === 1) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    // 起始偏移取当前展开状态（如果已在展开状态，touchStartOffset 就是当前 offset）
    const startOffset = this.data.swipeOpenId === id ? this.data.swipeOffsetPx : 0;
    this.setData({
      touchingId: id,
      touchStartX: t.clientX,
      touchStartY: t.clientY,
      touchStartOffset: startOffset,
    });
  },

  onSwipeMove(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.touchingId !== id) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - this.data.touchStartX;
    const dy = t.clientY - this.data.touchStartY;
    // 纵向滚动优先：只有明显横向才识别为滑动
    if (Math.abs(dx) < Math.abs(dy)) return;
    let next = this.data.touchStartOffset + dx;
    // 只允许向左滑（offset 为负）
    if (next > 0) next = 0;
    // 超过最大偏移则弹回限制
    const max = this.data.swipeMaxPx;
    if (next < -max) next = -max;
    // 如果滑的是其他卡片，先收起别的
    if (this.data.swipeOpenId && this.data.swipeOpenId !== id) {
      this.setData({
        swipeOpenId: id,
        swipeOffsetPx: next,
      });
    } else {
      this.setData({
        swipeOpenId: id,
        swipeOffsetPx: next,
      });
    }
  },

  onSwipeEnd(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.touchingId !== id) return;
    const offset = this.data.swipeOffsetPx;
    const threshold = -this.data.swipeThresholdPx;
    let open = false;
    let finalOffset = 0;
    if (offset <= threshold) {
      open = true;
      finalOffset = -this.data.swipeMaxPx;
    } else {
      open = false;
      finalOffset = 0;
    }
    this.setData({
      touchingId: null,
      swipeOpenId: open ? id : null,
      swipeOffsetPx: finalOffset,
    });
  },

  // 点击删除按钮 → 确认弹窗 → 调 api
  onSwipeDelete(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === 1) {
      wx.showToast({ title: '不能删除管理员本人', icon: 'none' });
      return;
    }
    const u = this.data.allUsers.find(x => x.user_id === id);
    if (!u) return;
    const name = u.real_name || u.username || ('员工' + id);
    wx.showModal({
      title: '删除员工',
      content: '确定删除员工「' + name + '」？\n将删除该员工的所有数据并生成文档备份，此操作不可恢复。',
      confirmText: '删除',
      confirmColor: '#F56C6C',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          wx.showLoading({ title: '删除中...' });
          const res = await api.deleteUser(id);
          wx.hideLoading();
          // 同步从本地列表移除
          const next = this.data.allUsers.filter(x => x.user_id !== id);
          const nextShown = this.data.users.filter(x => x.user_id !== id);
          this.setData({
            allUsers: next,
            users: nextShown,
            swipeOpenId: null,
            swipeOffsetPx: 0,
          });
          // 弹窗告知文档路径和数据统计
          const stats = (res && res.stats) || {};
          const sizeKb = (res && res.doc_size ? (res.doc_size / 1024).toFixed(1) : '?');
          wx.showModal({
            title: '删除成功',
            content: '员工「' + name + '」已删除。\n' +
              '备份文档：' + (res && res.doc_filename ? res.doc_filename : '(未知)') + '\n' +
              '大小：' + sizeKb + ' KB\n' +
              '含本人拨打记录 ' + (stats.records_count || 0) + ' 条\n' +
              '关联号码 ' + (stats.phones_count || 0) + ' 个\n' +
              '个人规则 ' + (stats.has_rule ? '有' : '无'),
            showCancel: false,
            confirmText: '知道了',
          });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: (err && err.errMsg) || '删除失败', icon: 'none' });
        }
      },
    });
  },

  // 卡片点击：如果已展开则收起；否则收起所有 swipe（点别处也收起）
  onUserCardTap() {
    if (this.data.swipeOpenId) {
      this.setData({ swipeOpenId: null, swipeOffsetPx: 0 });
    }
  },

  noOp() {},
  noop() {},
});
