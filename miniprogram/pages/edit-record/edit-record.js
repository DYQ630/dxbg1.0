/**
 * ============================================================
 * pages/edit-record/edit-record.js - 跟进记录编辑页
 * ============================================================
 * 【页面参数】id（record_id）
 *   来源：从 agent-history 列表页点击"编辑"按钮，
 *         wx.navigateTo({ url: '/pages/edit-record/edit-record?id=' + recordId })
 *         id 为该条使用记录的 usage_id
 *
 * 【页面功能】
 *   - 展示历史记录的当前标签和备注
 *   - 支持重新选择标签（单选）、修改备注、开关"已加微信"标记
 *   - 保存：调 api.updateRecord(id, { tag_id, remark, wechat_added })
 *   - 删除：调 api.deleteRecord(id)，成功后 navigateBack
 *
 * 【标签选择逻辑】
 *   只允许选择一个主标签（单选），与 agent-history 页一致；
 *   后端 tags 可能是字符串 id，需先 loadTags 构建字典再反查
 * ============================================================
 */
const api = require('../../utils/api.js');

Page({
  data: {
    record: null,
    loading: false,
    form: { tag_id: null, remark: '', wechat_added: false },
    selectedTag: null,
    showDeleteConfirm: false,
    tags: [],
    recordId: null,
  },

  // ============================================================
  // onLoad：读取路由参数 recordId，先加载标签字典，再加载记录详情
  // 【参数说明】opt.id = usage_id（历史记录的 ID），由 agent-history 传入
  // 【串行逻辑】loadTags() → 拿到 id→name 字典 → loadRecord(map) 反查 tag 字符串 id
  // ============================================================
  onLoad(opt) {
    const id = opt && opt.id;
    if (!id) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({ recordId: id });
    // 串行：先 loadTags（拿到 id→name 字典），再 loadRecord（反查 tag 字符串 id）
    this.loadTags().then((map) => this.loadRecord(map));
  },

  async loadTags() {
    try {
      const res = await api.getTags();
      let list = (res && res.value) || res;
      if (!Array.isArray(list) || list.length === 0) return {};
      const normalized = list.map(t => (typeof t === 'string' ? { id: t, name: t, color: '' } : { id: String(t.id), name: t.name, color: t.color || '' }));
      this.setData({ tags: normalized });
      const map = {};
      normalized.forEach(t => { map[String(t.id)] = { name: t.name, color: t.color }; });
      return map;
    } catch (e) {
      // 标签加载失败不阻塞备注编辑
      return {};
    }
  },

  // 从历史记录中查找并填充表单
  async loadRecord(tagsMap) {
    this.setData({ loading: true });
    try {
      const res = await api.getHistory({ page_size: 200 });
      const list = (res && res.records) || [];
      const record = list.find(r => String(r.id) === String(this.data.recordId));
      if (!record) {
        wx.showToast({ title: '记录不存在或已删除', icon: 'none' });
        return;
      }
      const map = tagsMap || this._getTagsMap();
      // tagsMap = { idString -> {name, color} }，反查字符串 id 拿到中文名
      const tags = Array.isArray(record.tags)
        ? record.tags.map(t => {
            if (typeof t !== 'string') return t;
            const hit = map && map[t];
            return hit ? { id: t, name: hit.name, color: hit.color || '' } : { id: t, name: t, color: '' };
          })
        : [];
      const firstTag = tags.length ? tags[0] : null;
      this.setData({
        record: Object.assign({}, record, { number: record.number || {}, tags }),
        selectedTag: firstTag,
        form: {
          tag_id: firstTag ? firstTag.id : null,
          remark: record.remark !== undefined && record.remark !== null ? record.remark : (record.note || ''),
          wechat_added: !!record.wechat_added,
        },
      });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 从 this.data.tags 现场构建 id → {name, color} 字典
  _getTagsMap() {
    const m = {};
    (this.data.tags || []).forEach(t => { m[String(t.id)] = { name: t.name, color: t.color }; });
    return m;
  },

  // 选择标签（再次点击取消）
  onTagSelect(e) {
    const tag = e.currentTarget.dataset.tag;
    if (!tag) return;
    const next = this.data.selectedTag && this.data.selectedTag.id === tag.id ? null : tag;
    this.setData({
      selectedTag: next,
      form: Object.assign({}, this.data.form, { tag_id: next ? next.id : null }),
    });
  },

  onRemarkInput(e) {
    this.setData({ form: Object.assign({}, this.data.form, { remark: e.detail.value }) });
  },

  onWechatChange(e) {
    this.setData({ form: Object.assign({}, this.data.form, { wechat_added: e.detail.value }) });
  },

  // ============================================================
  // onSave：保存修改后的记录
  // 【功能】调 api.updateRecord(id, { tag_id, remark, wechat_added })
  //         成功后 600ms 延迟 navigateBack（等待 Toast 显示）
  // ============================================================
  async onSave() {
    if (!this.data.record || this.data.loading) return;
    this.setData({ loading: true });
    try {
      await api.updateRecord(this.data.recordId, {
        tag_id: this.data.form.tag_id,
        remark: this.data.form.remark,
        wechat_added: this.data.form.wechat_added,
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '保存失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  // 删除（二次确认弹窗）
  onDelete() {
    this.setData({ showDeleteConfirm: true });
  },

  closeDeleteConfirm() {
    this.setData({ showDeleteConfirm: false });
  },

  async confirmDelete() {
    this.setData({ showDeleteConfirm: false });
    try {
      await api.deleteRecord(this.data.recordId);
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '删除失败', icon: 'none' });
    }
  },

  noOp() {},
});
