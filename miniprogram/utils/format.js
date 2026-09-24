/**
 * 统一号码显示与格式化工具
 * maskNumber: 明文 → 打码 138****1270
 * tapReveal:   Page 切换打码/明文，返回 { _revealedId, numberDisplay }，调用方自行 setData
 * formatTime:  ISO 字符串 → 'YYYY-MM-DD HH:mm:ss'
 */

'use strict';

// 13800001270 -> 138****1270
function maskNumber(plain) {
  if (!plain || typeof plain !== 'string') return '';
  if (plain.length < 7) return plain;
  return plain.slice(0, 3) + '****' + plain.slice(-4);
}

/**
 * 在 Page 里用，依赖 data._revealedId 控制同时仅 1 个展开
 * plain:        号码明文
 * currentRevealedId: 当前 data._revealedId 值
 * tapId:        本次点击的号码 id
 * page:         Page 实例
 * 返回值：{ _revealedId, numberDisplay }，调用方自行 page.setData(...)
 */
function tapReveal(plain, currentRevealedId, tapId, page) {
  var newRevealedId = currentRevealedId === tapId ? null : tapId;
  var numberDisplay = newRevealedId === tapId ? plain : maskNumber(plain);
  return { _revealedId: newRevealedId, numberDisplay: numberDisplay };
}

// 辅助：formatTime(iso) -> '2026-08-29 12:34:56'
function formatTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  var pad = function(n) { return n < 10 ? '0' + n : String(n); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

module.exports = {
  maskNumber: maskNumber,
  tapReveal: tapReveal,
  formatTime: formatTime,
};
