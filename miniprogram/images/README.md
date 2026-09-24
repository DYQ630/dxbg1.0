# 图片资源说明

本目录存放「邀约宝」小程序的全部图案资源，均由 AI 自动生成并完成背景移除（透明 PNG），
替代早期的 emoji 占位与程序手绘图标。

## 分类

| 类别 | 文件 | 尺寸 | 用途 |
|------|------|------|------|
| 底部 tabBar 图标 | `tab-home*.png` / `tab-pool*.png` / `tab-recycle*.png` / `tab-users*.png` / `tab-stats*.png` | 81×81 | 原生 tabBar（未选中灰紫 / 选中粉色） |
| 快捷入口徽章 | `badge-pool.png` / `badge-recycle.png` / `badge-rules.png` / `badge-tags.png` | 160×160 | 管理首页 4 宫格入口（渐变圆 + 白色图标） |
| 应用 Logo | `logo.png` | 256×256 | 登录页品牌图标 |
| 空状态插图 | `empty-state.png` | 400×400 | 各列表/空数据占位插图 |
| 线性功能图标 | `icon-*.png` | 128×128 | 标题、按钮、操作、菜单、标签等（粉色 #FF6B9D，透明背景） |

## icon-*.png 清单

`icon-search` 搜索 · `icon-refresh` 刷新 · `icon-call` 拨打/号码 · `icon-fav` 收藏(空心) ·
`icon-fav-filled` 收藏(实心) · `icon-edit` 编辑 · `icon-trash` 删除 · `icon-eye` 显示 ·
`icon-hide` 隐藏 · `icon-lock` 锁 · `icon-logout` 退出 · `icon-user` 单人 · `icon-users` 双人 ·
`icon-record` 记录 · `icon-gear` 齿轮 · `icon-tag` 标签 · `icon-chart` 柱状图 · `icon-stats` 趋势 ·
`icon-clock` 时钟 · `icon-wechat` 微信 · `icon-note` 备注 · `icon-download` 导入 ·
`icon-pin` 图钉 · `icon-signal` 信号 · `icon-location` 定位 · `icon-warning` 警告 ·
`icon-package` 包裹 · `icon-globe` 地球 · `icon-smartphone` 手机 · `icon-tip` 灯泡 · `icon-pool` 号码池

## 使用规范

- 渐变/深色背景上使用需叠加白色滤镜：`filter: brightness(0) invert(1)`（见 app.wxss `.ti-white/.inl-white`）。
- 更换资源时保持同名覆盖即可，无需改动 WXML。
- 全部为 PNG-24 透明背景，压缩优化，总体积约 0.9MB，满足小程序 2MB 主包限制。
