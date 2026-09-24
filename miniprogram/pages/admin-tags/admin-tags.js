/**
 * admin-tags.js - 标签管理（重写版）
 * 修复：白屏（响应体解析错误 / wxml 引用未定义变量）+ 颜色不可点击
 *
 * 后端接口：
 *   GET    /api/admin/tags        -> 直接返回数组 List[TagOut]
 *   POST   /api/admin/tags        -> {name, color}
 *   PUT    /api/admin/tags/{id}   -> {name, color}
 *   DELETE /api/admin/tags/{id}
 */
const api = require('../../utils/api.js');

/* 6 个预置颜色（与后端 seed 内置标签配色一致） */
const COLOR_PRESETS = [
  { value: '#67C23A', label: '绿' }, // 已接通
  { value: '#F56C6C', label: '红' }, // 未接通
  { value: '#5B8FF9', label: '蓝' }, // 已加微信
  { value: '#E6A23C', label: '橙' }, // 已约见
  { value: '#9B59B6', label: '紫' }, // 已成交
  { value: '#909399', label: '灰' }, // 暂时搁置
];

const DEFAULT_COLOR = COLOR_PRESETS[0].value;

/* api.js 中管理员标签方法名兼容（不修改 api.js） */
function apiListTags() {
  const fn = api.getAdminTags || api.getTags;
  return fn ? fn() : Promise.reject({ errMsg: '接口未定义：getAdminTags' });
}
function apiCreateTag(data) {
  const fn = api.createAdminTag || api.createTag;
  return fn ? fn(data) : Promise.reject({ errMsg: '接口未定义：createAdminTag' });
}
function apiUpdateTag(id, data) {
  const fn = api.updateAdminTag || api.updateTag;
  return fn ? fn(id, data) : Promise.reject({ errMsg: '接口未定义：updateAdminTag' });
}
function apiDeleteTag(id) {
  const fn = api.deleteAdminTag || api.deleteTag;
  return fn ? fn(id) : Promise.reject({ errMsg: '接口未定义：deleteAdminTag' });
}

/* 响应体归一化：数组 / {value} / {data} / {items} / {list} 都能吃 */
function normalizeList(res) {
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object') {
    const keys = ['value', 'data', 'items', 'list', 'tags'];
    for (let i = 0; i < keys.length; i++) {
      if (Array.isArray(res[keys[i]])) return res[keys[i]];
    }
  }
  return [];
}

Page({
  data: {
    tags: [],
    builtinCount: 0,
    customCount: 0,
    colorPresets: COLOR_PRESETS,
    loading: false,
    editing: null,               // null=关闭；{id:null}=新建；{id:数字,...}=编辑
    form: { name: '', color: DEFAULT_COLOR },
  },

  onShow() {
    const app = getApp();
    if (app && app.enforceRole && !app.enforceRole('admin')) return;
    this.loadTags();
  },

  onPullDownRefresh() {
    this.loadTags().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  loadTags() {
    this.setData({ loading: true });
    return apiListTags()
      .then(res => {
        const list = normalizeList(res).map(t => {
          const usage = t.usage_count;
          return Object.assign({}, t, {
            metaText:
              typeof usage === 'number'
                ? '使用 ' + usage + ' 次'
                : (t.is_builtin ? '系统内置标签' : '自定义标签'),
          });
        });
        this.setData({
          tags: list,
          builtinCount: list.filter(t => t.is_builtin).length,
          customCount: list.filter(t => !t.is_builtin).length,
          loading: false,
        });
      })
      .catch(e => {
        console.error('[admin-tags] loadTags error', e);
        this.setData({ tags: [], builtinCount: 0, customCount: 0, loading: false });
        wx.showToast({ title: (e && e.errMsg) || (e && e.detail) || '加载失败', icon: 'none' });
      });
  },

  /* ---------- 弹窗 ---------- */
  openCreate() {
    this.setData({
      editing: { id: null },
      colorPresets: COLOR_PRESETS,
      form: { name: '', color: DEFAULT_COLOR },
    });
  },

  openEdit(e) {
    const id = e.currentTarget.dataset.id;
    const tag = this.data.tags.filter(x => String(x.id) === String(id))[0];
    if (!tag) return;
    const color = tag.color || DEFAULT_COLOR;
    // 若该标签的颜色不在预置色里，临时补进色板，保证选中态可见、可点击
    const inPresets = COLOR_PRESETS.some(c => c.value === color);
    this.setData({
      editing: tag,
      colorPresets: inPresets ? COLOR_PRESETS : COLOR_PRESETS.concat([{ value: color, label: '原' }]),
      form: { name: tag.name || '', color: color },
    });
  },

  closeEdit() {
    this.setData({ editing: null });
  },

  noop() {},

  /* ---------- 表单 ---------- */
  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const patch = {};
    patch['form.' + field] = e.detail.value;
    this.setData(patch);
  },

  onColorPick(e) {
    const color = e.currentTarget.dataset.color;
    if (!color) return;
    this.setData({ 'form.color': color });
  },

  /* ---------- 保存 ---------- */
  saveTag() {
    const form = this.data.form || {};
    const editing = this.data.editing;
    if (!editing) return;
    const name = (form.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }
    const payload = { name: name, color: form.color || DEFAULT_COLOR };
    const task = editing.id
      ? apiUpdateTag(editing.id, payload)
      : apiCreateTag(payload);

    wx.showLoading({ title: '保存中...', mask: true });
    task
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: editing.id ? '已更新' : '已创建', icon: 'success' });
        this.closeEdit();
        this.loadTags();
      })
      .catch(e => {
        wx.hideLoading();
        console.error('[admin-tags] saveTag error', e);
        wx.showToast({
          title: (e && e.errMsg) || (e && e.detail) || '保存失败',
          icon: 'none',
        });
      });
  },

  /* ---------- 删除 ---------- */
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    if (!id && id !== 0) return;
    const self = this;
    wx.showModal({
      title: '删除标签',
      content: '确认删除该标签？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#F56C6C',
      success(r) {
        if (!r.confirm) return;
        apiDeleteTag(id)
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            self.loadTags();
          })
          .catch(err => {
            console.error('[admin-tags] onDelete error', err);
            wx.showToast({
              title: (err && err.errMsg) || (err && err.detail) || '删除失败',
              icon: 'none',
            });
          });
      },
    });
  },
});
