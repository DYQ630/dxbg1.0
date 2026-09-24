// Yaoyuebao - Auth Utilities
// 邀约宝小程序 - 通用格式化与展示工具函数集合
// 提供时间格式化、号码打码、标签样式映射、今日日期等纯函数工具

/**
 * 格式化时间为短格式 "M/D HH:mm"
 * @param {string} isoString - ISO 时间字符串，如 "2026-08-31T10:00:00"
 * @returns {string} 格式化后的短时间字符串；输入为空时返回空串
 */
function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 手机号码打码/还原显示
 * @param {string|number} phone - 号码明文
 * @param {boolean} revealed - 是否明文展示（true 则不打码）
 * @returns {string} 打码后（如 13****80）或明文的字符串
 */
function maskPhone(phone, revealed) {
  if (!phone) return '';
  const s = String(phone);
  if (revealed) return s;
  if (s.length <= 4) return s;
  return s.slice(0, 2) + '****' + s.slice(-2);
}

/**
 * 根据标签 key 返回对应的 CSS 徽章样式类名
 * @param {string} tag - 标签标识（connected / no-answer / ...）
 * @returns {string} 对应的 badge 样式类；未知标签返回默认样式
 */
function tagBadgeClass(tag) {
  // 标签 key → 样式类映射表
  const map = {
    'connected': 'badge-green',          // 已接通
    'no-answer': 'badge-gray',           // 未接通
    'wechat-added': 'badge-blue',        // 已加微信
    'meeting-scheduled': 'badge-orange', // 已约见
    'deal-closed': 'badge-red',          // 已成交
    'on-hold': 'badge-purple',           // 暂时搁置
  };
  return map[tag] || 'badge-default';
}

/**
 * 获取今日日期字符串 "YYYY-MM-DD"
 * @returns {string} 今日日期，如 "2026-08-31"
 */
function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = {
  formatTime,
  maskPhone,
  tagBadgeClass,
  getToday,
};
