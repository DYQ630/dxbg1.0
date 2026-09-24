# 邀约宝 - 微信小程序

> 将 H5 电销管理系统改造为微信小程序原生代码包

## 项目结构

```
miniprogram/
├── app.js              # 全局入口：token管理 + checkAuth
├── app.json            # 全局配置：路由 + tabBar + window样式
├── app.wxss            # 全局样式（粉紫渐变主题）
├── project.config.json # 项目配置（测试 AppID: wx1234567890）
├── sitemap.json        # SEO 配置
├── images/             # tabBar 图标（需自行制作，见 images/README.md）
├── pages/
│   ├── login/           # 登录页（账号密码，管理员/邀约员通用）
│   ├── admin-home/      # 管理员首页（今日数据、明细、快捷入口）
│   ├── admin-pool/      # 号码池（上传Excel + 导入记录 + 状态）
│   ├── admin-users/     # 员工管理（新增/编辑/停职）
│   ├── admin-rules/     # 规则设置（全局规则 + 个人规则）
│   ├── admin-stats/     # 数据看板（今日/昨日/本周/本月）
│   ├── agent-current/   # 邀约员当前号码（拨号 + 标签 + 备注）
│   ├── agent-history/   # 历史记录（展开/编辑/收藏/删除）
│   ├── agent-favorite/  # 我的收藏（取消收藏 + 拨号）
│   └── edit-record/     # 编辑记录（标签 + 备注 + 收藏 + 删除）
├── utils/
│   ├── api.js          # API 封装（token + 401拦截 + 所有接口）
│   ├── auth.js         # 鉴权工具（脱敏 + 时间格式化 + badge类名）
│   └── util.js         # 通用工具（clone/debounce/验证等）
└── components/          # 公共组件目录（可扩展）
```

## 技术要点

### 1. 全局 token 管理（app.js）
- 启动时从 `wx.getStorageSync` 恢复登录态
- `checkAuth()` 在每个页面的 `onShow` 中调用，未登录自动跳转
- 401 响应在 `api.js` 中统一处理，自动调用 `app.logout()` 跳转登录页

### 2. 号码脱敏规则
- 中间 4 位脱敏：`138****8000`
- 点击显示明文，同时只能显示一个
- 存储在 `app.globalData.revealedId`
- 页面 data 中用 `revealedId` 局部状态追踪

### 3. 拨号实现
```javascript
wx.makePhoneCall({
  phoneNumber: '13800138000',
  fail: err => {} // 用户取消不报错
});
```

### 4. Excel 上传实现
```javascript
// 选择微信聊天文件（无需申请权限）
const res = await wx.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx','xls'] });
// 上传（用 uploadFile，不是 request）
wx.uploadFile({ url: '...', filePath: res.tempFiles[0].path, name: 'file', header: { Authorization: 'Bearer ...' } });
```

### 5. 粉紫渐变主题
```css
background: linear-gradient(135deg, #FF6B9D 0%, #9B7EDE 100%);
```

### 6. 后端地址配置
修改 `utils/api.js` 中的 `BASE_URL`：
```javascript
const BASE_URL = 'http://localhost:8000'; // 开发环境
// 部署后改为实际服务器地址
```

## 后端接口对应

| 功能 | 接口 | 方法 |
|------|------|------|
| 登录 | /api/auth/login | POST |
| 验证token | /api/auth/me | GET |
| 管理员-今日数据 | /api/admin/stats?range=today | GET |
| 管理员-号码池统计 | /api/admin/pool/stats | GET |
| 管理员-上传Excel | /api/admin/numbers/import | POST |
| 管理员-导入记录 | /api/admin/batches | GET |
| 管理员-删除记录 | /api/admin/batches/:id | DELETE |
| 管理员-员工列表 | /api/admin/users | GET |
| 管理员-新增员工 | /api/admin/users | POST |
| 管理员-编辑员工 | /api/admin/users/:id | PUT |
| 管理员-全局规则 | /api/admin/rules/global | GET/PUT |
| 管理员-个人规则 | /api/admin/users/:id/rule | GET/PUT |
| 邀约员-当前号码 | /api/agent/current | GET |
| 邀约员-提交使用 | /api/agent/usage | POST |
| 邀约员-历史记录 | /api/agent/history | GET |
| 邀约员-收藏列表 | /api/agent/favorites | GET |
| 邀约员-可选标签 | /api/agent/tags | GET |
| 邀约员-编辑记录 | /api/agent/usage/:id | PUT |
| 邀约员-删除记录 | /api/agent/usage/:id | DELETE |

## 在微信开发者工具中打开测试

1. **下载微信开发者工具**
   https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html

2. **导入项目**
   - 打开微信开发者工具
   - 点击「导入项目」
   - 项目目录选择：`C:\Users\Administrator\.qclaw\workspace-tfxjjhfnjialcuju\miniprogram`
   - AppID 填写：`wx1234567890`（测试号，也可以填自己的）
   - 点击「确认」

3. **配置后端地址**
   - 打开 `utils/api.js`
   - 找到 `BASE_URL`，改为实际后端地址
   - 若在本机运行后端，保持 `http://localhost:8000`

4. **启动后端**
   ```bash
   cd dialer-backend
   双击 run.bat
   ```
   确认显示 `Uvicorn running on http://localhost:8000`

5. **开始调试**
   - 管理员登录：`admin` / `admin123`
   - 邀约员：需管理员先在「员工管理」中添加
   - 开发者工具控制台可查看网络请求和错误日志

6. **手机预览**
   - 点击开发者工具右上角「预览」
   - 用微信扫描二维码即可在手机上看效果

## tabBar 图标

如果不放图标，tabBar 会显示空白但不影响功能。快速获取图标的办法：

```bash
# 在微信开发者工具中新建任意项目，获得一套默认图标
# 或者用以下网址在线生成
# https://www.iconfont.cn/ 搜索 "home/user/stats"
```

## 注意事项

1. **域名白名单**：微信小程序正式版要求后端域名在 mp.weixin.qq.com 配置白名单，开发版无此限制
2. **uploadFile 大小限制**：文件不超过 10MB
3. **安全区域**：底部 tabBar 和键盘弹出需要适配 `env(safe-area-inset-bottom)`
4. **邀约员 tabBar**：不使用原生 tabBar，而是自定义底部导航（避免和原生 tabBar 冲突）
5. **登录页**：使用自定义导航栏（navigationStyle: custom），沉浸式粉紫背景
