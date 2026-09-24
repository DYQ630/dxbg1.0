// Yaoyuebao - General Utilities
// 邀约宝小程序 - 基础通用工具函数

/**
 * 数字补零：1 -> "01"（用于月/日/时/分/秒的两位数显示）
 * @param {number|string} n - 原始数字
 * @returns {string} 至少两位的字符串
 */
const formatNumber = n => {
  n = n.toString();
  return n[1] ? n : '0' + n;
};

/**
 * 将 Date 对象格式化为 "YYYY-MM-DD HH:mm:ss"
 * @param {Date} date - 日期对象
 * @returns {string} 完整时间字符串
 */
const formatTime = date => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();
  return `${year}-${formatNumber(month)}-${formatNumber(day)} ${formatNumber(hour)}:${formatNumber(minute)}:${formatNumber(second)}`;
};

module.exports = {
  formatTime,
};
