// ============================================================
// Yaoyuebao - API wrapper
// 邀约宝小程序 - 后端接口封装层
// 统一管理请求地址、鉴权头（Bearer Token）、401 处理与错误提示，
// 各页面通过 require 本模块调用后端 REST API。
// BASE_URL: 后端接口基地址
//   - 本地开发：http://127.0.0.1:8000（仅本机浏览器调试用）
//   - 局域网真机调试：必须用电脑局域网 IP，如 http://192.168.x.x:8000
//     （127.0.0.1 在手机上指向手机自己，会连不上电脑上的后端）
//   - 上云后（已改造）：https://api.yaoyuebao.cn  ← 生产环境正式地址（HTTPS 强制）
// ============================================================

// ⚠️ 上云改造：已切换为生产环境正式域名（HTTPS）。小程序 request 合法域名需在
// 微信公众平台配置为 https://api.yaoyuebao.cn，且域名须完成 ICP 备案。
// 若需本地/局域网调试，把下面这行临时改回 http://127.0.0.1:8000 即可。
const BASE_URL = 'https://api.yaoyuebao.cn';

/**
 * ============================================================
 * request - 通用请求封装（Promise 化）
 * ============================================================
 * 【核心功能】
 *   - 自动附带 Authorization: Bearer <token> 头
 *   - 401 统一触发 logout() 并跳转登录页
 *   - 4xx/5xx 解析 FastAPI HTTPException detail → errMsg 字段后 reject
 *   - 网络层失败 reject 为 { errMsg: '网络错误，请检查网络连接' }
 *
 * 【参数 options】
 *   - url    : 后端路由路径（不含 BASE_URL，如 '/api/auth/login'）
 *   - method : 'GET'（默认）| 'POST' | 'PUT' | 'DELETE'
 *   - data   : 请求体数据（JSON 序列化）
 *   - header : 额外请求头（如 Content-Type Override）
 *
 * 【错误处理逻辑】
 *   - 401: Token 失效（过期/被顶号）→ logout() → reject
 *   - 422: FastAPI Pydantic 校验错误 → detail 数组映射为分号分隔的中文提示
 *   - 4xx/5xx: 原样返回后端 errBody.errMsg，各页面 .catch(e => e.errMsg) 读取
 *   - 网络错误: reject { errMsg: '网络错误，请检查网络连接' }
 *
 * @param {Object} options - { url, method, data, header }
 * @returns {Promise<Object>} 后端返回的业务数据对象
 */
function request(options) {
  const app = getApp() || {};
  const token = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
  const fullUrl = BASE_URL + options.url;
  console.log('[API]', options.method || 'GET', fullUrl, 'data=', JSON.stringify(options.data));

  return new Promise((resolve, reject) => {
    wx.request({
      url: fullUrl,
      method: options.method || 'GET',
      data: options.data || null,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.header || {}),
      },
      success(res) {
        // 登录态失效：清空本地登录态并跳回登录页
        if (res.statusCode === 401) {
          app && app.logout && app.logout();
          reject({ errMsg: '未登录或登录已过期，请重新登录' });
          return;
        }
        // 其他业务错误：原样返回后端错误信息
        if (res.statusCode >= 400) {
          var errBody = res.data || {};
          // FastAPI HTTPException / ValidationError 的 detail → 统一 errMsg 字段，
          // 方便各页面 .catch(e => e.errMsg) 直接读取真实错误提示，不再笼统显示"提交失败"。
          if (errBody.detail !== undefined && errBody.errMsg === undefined) {
            errBody.errMsg = Array.isArray(errBody.detail)
              ? errBody.detail.map(function(d) { return d.msg || JSON.stringify(d); }).join('；')
              : String(errBody.detail);
          }
          reject(errBody);
          return;
        }
        resolve(res.data);
      },
      fail(err) {
        // 网络层失败（后端未启动 / 域名不通等）
        reject({ errMsg: '网络错误，请检查网络连接' });
      },
    });
  });
}

// ---------- 登录 ----------
/**
 * 账号密码登录
 * @param {Object} data - { username, password }
 */
function login(data) {
  return request({ url: '/api/auth/login', method: 'POST', data });
}

// ---------- 邀约员 API ----------
/** 获取当前待跟进号码 */
function getCurrentNumber() {
  return request({ url: '/api/agent/current' });
}
/** 领取下一个号码（将当前号码标记为已用并取出新号码） */
function getNextNumber() {
  return request({ url: '/api/agent/current/next', method: 'POST' });
}
/** 获取可用标签列表 */
function getTags() {
  return request({ url: '/api/agent/tags' });
}
/** 提交号码使用情况（标签/备注等） */
function submitUsage(data) {
  return request({ url: '/api/agent/usage', method: 'POST', data });
}

// BUG1 FIX：支持分页参数
/** 获取历史记录（支持 page / page_size 分页） */
function getHistory(params) {
  const query = [];
  if (params) {
    if (params.page) query.push('page=' + params.page);
    if (params.page_size) query.push('page_size=' + params.page_size);
  }
  const qs = query.length ? '?' + query.join('&') : '';
  return request({ url: '/api/agent/history' + qs });
}

/** 获取我的收藏号码列表 */
function getFavorites() {
  return request({ url: '/api/agent/favorites' });
}

/** 修改一条使用记录 */
function updateRecord(id, data) {
  return request({ url: '/api/agent/usage/' + id, method: 'PUT', data });
}

/** 删除一条使用记录 */
function deleteRecord(id) {
  return request({ url: '/api/agent/usage/' + id, method: 'DELETE' });
}

/** 获取当前登录用户信息 */
function getMe() {
  return request({ url: '/api/auth/me' });
}

/** 更新个人资料 */
function updateProfile(data) {
  return request({ url: '/api/agent/profile', method: 'PUT', data });
}

/** 修改密码 */
function changePassword(data) {
  return request({ url: '/api/agent/change-password', method: 'POST', data });
}

// ---------- 管理员 API ----------
/** 获取全部用户列表（管理员） */
function getUsers() {
  return request({ url: '/api/admin/users' });
}
/** 新建用户（管理员） */
function createUser(data) {
  return request({ url: '/api/admin/users', method: 'POST', data });
}
/** 更新用户信息（管理员） */
function updateUser(id, data) {
  return request({ url: '/api/admin/users/' + id, method: 'PUT', data });
}
/** 删除用户（管理员） */
function deleteUser(id) {
  return request({ url: '/api/admin/users/' + id, method: 'DELETE' });
}

/** 获取全局规则（每日上限/历史数/收藏上限/回收天数） */
function getGlobalRule() {
  return request({ url: '/api/admin/rules/global' });
}
/** 更新全局规则 */
function updateGlobalRule(data) {
  return request({ url: '/api/admin/rules/global', method: 'PUT', data });
}
/** 保存全局规则后调用：清除低于新全局值的个人规则覆盖 */
function clearPersonalRulesBelowGlobal() {
  return request({ url: '/api/admin/rules/clear-below-global', method: 'POST' });
}
/** 获取指定用户的个人规则 */
function getUserRule(uid) {
  return request({ url: '/api/admin/users/' + uid + '/rule' });
}
/** 更新指定用户的个人规则 */
function updateUserRule(uid, data) {
  return request({ url: '/api/admin/users/' + uid + '/rule', method: 'PUT', data });
}

/**
 * 通过 wx.uploadFile 上传 Excel 批量导入号码
 * @param {string} filePath - 本地文件路径
 * @param {Function} onProgress - 进度回调（预留）
 * @returns {Promise<Object>} 导入结果
 */
function importNumbers(filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const app = getApp() || {};
    wx.uploadFile({
      url: BASE_URL + '/api/admin/numbers/import',
      filePath: filePath,
      name: 'file',
      header: {
        'Authorization': 'Bearer ' + ((app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || ''),
      },
      success(res) {
        if (res.statusCode === 401) {
          app && app.logout && app.logout();
          reject({ errMsg: '未登录' });
          return;
        }
        try {
          const data = JSON.parse(res.data);
          if (res.statusCode >= 400) {
            reject(data);
          } else {
            resolve(data);
          }
        } catch (e) {
          reject({ errMsg: '解析响应失败' });
        }
      },
      fail(err) {
        reject({ errMsg: '上传失败，请检查网络' });
      },
    });
  });
}

/** 获取全部导入批次（管理员） */
function getBatches() {
  return request({ url: '/api/admin/batches' });
}
/** 删除导入批次（管理员） */
function deleteImportBatch(id) {
  return request({ url: '/api/admin/batches/' + id, method: 'DELETE' });
}
/** 获取某批次下的号码列表 */
function getBatchNumbers(bid) {
  return request({ url: '/api/admin/batches/' + bid + '/numbers' });
}
/** 获取号码池统计（总数/剩余/已用） */
function getPoolStats() {
  return request({ url: '/api/admin/pool/stats' });
}

/**
 * 获取号码池号码列表（支持分页/状态/使用过滤/关键字搜索）
 * @param {Object} params - { page, page_size, status, usage_filter, keyword }
 */
function getAdminNumbers(params) {
  const query = [];
  if (params) {
    if (params.page)          query.push('page=' + params.page);
    if (params.page_size)     query.push('page_size=' + params.page_size);
    if (params.status)        query.push('status=' + params.status);
    if (params.usage_filter)  query.push('usage_filter=' + params.usage_filter);
    if (params.keyword)       query.push('keyword=' + encodeURIComponent(params.keyword));
  }
  const qs = query.length ? '?' + query.join('&') : '';
  return request({ url: '/api/admin/numbers' + qs });
}

/** 删除单个号码（管理员） */
function deleteNumber(id) {
  return request({ url: '/api/admin/numbers/' + id, method: 'DELETE' });
}

/**
 * 获取统计数据
 * @param {string} range - 时间范围：today / week / month 等
 */
function getAdminStats(range) {
  return request({ url: '/api/admin/stats?range=' + (range || 'today') });
}

// ---------- 管理员标签 API ----------
/** 获取全部标签（管理员） */
function getAdminTags() {
  return request({ url: '/api/admin/tags' });
}
/** 新建标签（管理员） */
function createAdminTag(data) {
  return request({ url: '/api/admin/tags', method: 'POST', data });
}
/** 更新标签（管理员） */
function updateAdminTag(id, data) {
  return request({ url: '/api/admin/tags/' + id, method: 'PUT', data });
}
/** 删除标签（管理员） */
function deleteAdminTag(id) {
  return request({ url: '/api/admin/tags/' + id, method: 'DELETE' });
}

/** 获取回收池统计 */
function getRecycleStats() {
  return request({ url: '/api/admin/recycle/stats' });
}
/** 按邀约员查询回收号码 */
function getRecycleByAgent(filter) {
  return request({ url: '/api/admin/recycle/by-agent?filter=' + (filter || 'all') });
}
/** 获取回收池号码列表（可按邀约员过滤） */
function getRecycleNumbers(params) {
  let url = '/api/admin/recycle/numbers?filter=' + (params && params.filter ? params.filter : 'all');
  if (params && params.agent_id) url += '&agent_id=' + params.agent_id;
  return request({ url });
}

/** 回收池恢复单个号码到号码池 */
function restoreNumber(id) {
  return request({ url: '/api/admin/recycle/restore/' + id, method: 'POST' });
}
/** 彻底删除回收池中的单个号码 */
function deleteRecycleNumber(id) {
  return request({ url: '/api/admin/recycle/delete/' + id, method: 'DELETE' });
}

/** 批量恢复回收池号码 */
function restoreBatch(ids) {
  return request({ url: '/api/admin/recycle/restore-batch', method: 'POST', data: { ids } });
}
/** 批量彻底删除回收池号码 */
function deleteBatch(ids) {
  return request({ url: '/api/admin/recycle/delete-batch', method: 'POST', data: { ids } });
}

/** 生成回收池导出的下载地址 */
function exportRecycle(params) {
  let url = '/api/admin/recycle/export?filter=' + (params && params.filter ? params.filter : 'all');
  if (params && params.agent_id) url += '&agent_id=' + params.agent_id;
  return BASE_URL + url;
}

// 导出全部接口，供各页面 require 使用
module.exports = {
  // 登录
  login,
  // 邀约员
  getCurrentNumber,
  getNextNumber,
  getTags,
  submitUsage,
  getHistory,
  getFavorites,
  updateRecord,
  deleteRecord,
  getMe,
  updateProfile,
  changePassword,
  // 管理员
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getGlobalRule,
  updateGlobalRule,
  clearPersonalRulesBelowGlobal,
  getUserRule,
  updateUserRule,
  importNumbers,
  getBatches,
  deleteImportBatch,
  deleteBatch,
  getBatchNumbers,
  getPoolStats,
  getAdminNumbers,
  getAdminStats,
  getRecycleStats,
  getRecycleByAgent,
  getRecycleNumbers,
  restoreNumber,
  deleteRecycleNumber,
  restoreBatch,
  exportRecycle,
  // 管理员标签
  getAdminTags,
  createAdminTag,
  updateAdminTag,
  deleteAdminTag,
  deleteNumber,
};
