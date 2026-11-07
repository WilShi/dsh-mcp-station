# MCP Station — MARKET

npm: https://www.npmjs.com/package/dsh-mcp-station
GitHub: https://github.com/WilShi/dsh-mcp-station

## 一句话

DSH 的 MCP 应用商店：精选目录、一键安装、连通性检测、浏览器预设。

## 分类

Tools & Capabilities / Dev / Browser

## 标签

mcp, mcp-manager, mcp-store, playwright, browser, automation, devtools, one-click

## 描述（市场短文案）

装 MCP 不用再手写 JSON。MCP Station 内置精选目录：Playwright、Chrome DevTools、Filesystem、Memory、GitHub、Context7、Tavily……一键写入配置、自动连接、测试工具；Playwright 会自动适配本机 Chrome，避开 Chromium 版本坑。目录随插件打包，不依赖远程索引，离线也能装。风险分级、密钥脱敏、受管块隔离，管得清楚也改得安全。

## 亮点（用于截图/详情页）

1. 商店一屏：分类、搜索、风险标签。
2. 一键安装：进度、成功、失败原因。
3. 已安装：状态、工具数、测试连接、启停、删除。
4. Playwright 专用：自动检测 Chrome，补 --browser chrome。
5. 环境体检：profile、patch、DSH、Chrome、Playwright 缓存。

## 截图

- docs/screenshots/store.png：应用商店网格（9 个预设、风险标签、依赖提示）
- docs/screenshots/installed.png：已安装 + 测试连接成功（Connected、工具数、延迟）
- docs/screenshots/settings.png：环境体检（profile、patch、DSH、Chrome、doctor）

## 更新日志

### 0.2.0

- 市场源聚合：精选 + MCP 官方注册表 + 自定义源，搜索/筛选/加载更多/一键安装
- 26 个热门精选预设
- 自定义市场源（URL/语言/headers，启停/刷新/删除）
- 显示语言选择（跟随 DSH/中文/English）
- 修复版本号显示


### 0.1.1

- 自定义 MCP 服务器（stdio/HTTP + headers）
- Claude/Cursor JSON 配置导入
- 安装后自动测试 / 一键重试

### 0.1.0

- 首个 MVP：精选目录、一键安装、连通性检测、Playwright 预设、环境体检。
