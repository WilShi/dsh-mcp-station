# MCP Station 预设验证记录

验证日期：**2026-11-06**（CST）。本文记录 `data/catalog.json` 中每个预设的实测证据、结论与修改理由。
catalog 的 schema 以 `src/shared/types.ts` 为准；本文只负责「预设是否真实可用」。

## 验证环境

| 项目 | 值 |
| --- | --- |
| 系统 | macOS 24.6.0（arm64） |
| Node | v22.22.3（npm 10.9.8） |
| 浏览器 | Google Chrome 156.0.8078.80（/Applications） |
| 网络 | 可访问 npm registry、GitHub、Tavily、Context7 |
| 包版本来源 | `npm view <pkg> version time.modified`，2026-11-06 取样 |
| stdio 探测 | 临时脚本 spawn 服务，依次发送换行分隔 JSON-RPC：`initialize` → `notifications/initialized` → `tools/list` → 可选 `tools/call`，再按进程组清理 |
| streamable-http 探测 | `curl` 对端点发 `initialize`（`accept: application/json, text/event-stream`），再用 `tools/list` / `tools/call` |
| npm 缓存 | 验证机 `~/.npm` 不可写，`npx` 会 EPERM；catalog 为所有 `npx` 预设注入 `npm_config_cache={{dshHome}}/mcp-station/npm-cache`（实测 npm 会自动创建多级目录） |

> 验证本身跑在 DSH 文件沙箱（workspace-write）内。这个环境**无法**让 Chrome/Chromium 的浏览器内核沙箱完成初始化
> （报 `sandbox initialization failed: Operation not permitted` / Crashpad 目录 EPERM），因此 Playwright 的
> `example.com` 导航 smoke 在本环境未能跑通；这是验证环境限制，不是预设配置错误。其余 stdio 预设均已真实调用工具。

**npx 缓存重定向**：验证机 `~/.npm` 不可写会让 `npx` 直接报 `EPERM`，因此 catalog 为全部 8 个
`npx` 预设（playwright、chrome-devtools、filesystem、memory、github、context7、sequential-thinking、
everything）都注入了 `npm_config_cache: "{{dshHome}}/mcp-station/npm-cache"`。用不存在的多级临时路径实测
`npm view` 仍能正常工作（npm 会递归创建缓存目录），所以 `mcp-station/` 子目录不需要预先存在。
tavily 是远程 streamable-http，不涉及 npx。

## 结论总表

| preset | 上游 | 版本（2026-11-06） | transport | 结论 |
| --- | --- | --- | --- | --- |
| `playwright` | `@playwright/mcp` | 0.0.84 | stdio | ✅ 工具名/参数有效（25 个工具，含 `browser_navigate`）；⚠️ 导航 smoke 受验证沙箱限制未完成 |
| `chrome-devtools` | `chrome-devtools-mcp` | 1.12.0 | stdio | ✅ `initialize` + `tools/list` 实测，32 个工具；⚠️ 页面级工具需 `pageId`（1.12 起） |
| `filesystem` | `@modelcontextprotocol/server-filesystem` | 2.2.0 | stdio | ✅ 16 个工具，`list_allowed_directories` 实测通过 |
| `memory` | `@modelcontextprotocol/server-memory` | 2.1.0 | stdio | ✅ 9 个工具，`create_entities` / `read_graph` 实测通过 |
| `github` | `@modelcontextprotocol/server-github` | 2025.4.8（已归档） | stdio | 🔑 26 个工具实测；需要 `GITHUB_PERSONAL_ACCESS_TOKEN`；无 token 时只匿名访问公开数据 |
| `context7` | `@upstash/context7-mcp` | 4.5.1 | stdio | ✅ 无需 key；`resolve-library-id` 实测返回文档 ID，`query-docs` 在工具列表中 |
| `tavily` | `https://mcp.tavily.com/mcp/` | 远程 server 4.1.5 | streamable-http | 🔑 无 key 返回 401；用占位 key 实测协议与 5 个工具列表；真实搜索未验证（无真实 key） |
| `sequential-thinking`（新增） | `@modelcontextprotocol/server-sequential-thinking` | 2.1.1 | stdio | ✅ 单工具 `sequentialthinking`，实测调用通过 |
| `everything`（新增） | `@modelcontextprotocol/server-everything` | 2.2.1 | stdio | ✅ 16 个工具，`echo` 实测通过；测试专用，注意 `get-env` 会泄露环境变量 |

状态说明：✅ 已实测可用；🔑 实测可用但需要 key（或仅验证到 key 之前）；⚠️ 局部未完成；❌ 不可用。

## 逐项证据

> 下面只列 `command`/`args`；所有 `npx` 预设在 catalog 里都额外带 `npm_config_cache` 环境变量（见上）。

### 1. playwright（Playwright MCP）

- 包：`@playwright/mcp` **0.0.84**（latest，2026-11-03 更新；engines Node >= 18）。
- 命令：`npx -y @playwright/mcp@latest --browser chrome --timeout-action 15000`。
- `--help` 实测：`--browser` 可选 `chrome / firefox / webkit / msedge`；`--timeout-action`、`--timeout-navigation`、`--headless`、`--isolated`、`--user-data-dir` 均存在。
- 关键结论：0.0.84 的**默认浏览器后端是 `chrome-for-testing`**（未安装时调用会报 `Browser "chrome-for-testing" is not installed`，需要额外下载）；catalog 显式传 `--browser chrome`，因此直接复用本机 Chrome，不会触发这份额外下载。
- `initialize` 返回 `serverInfo: Playwright 1.65.0-alpha-2026-10-30`，协议版本 2025-06-18。
- `tools/list` 返回 25 个工具（实测）：
  `browser_close, browser_resize, browser_console_messages, browser_handle_dialog, browser_emulate_media, browser_evaluate, browser_file_upload, browser_drop, browser_find, browser_fill_form, browser_press_key, browser_type, browser_navigate, browser_navigate_back, browser_network_requests, browser_network_request, browser_run_code_unsafe, browser_take_screenshot, browser_snapshot, browser_click, browser_drag, browser_hover, browser_select_option, browser_tabs, browser_wait_for`。
- `browser_navigate` 工具存在且 schema 正常；实际调用受本机嵌套沙箱限制：
  - 首次调用报 `EPERM: mkdir '/Users/wilson/Library/Caches/ms-playwright-mcp/mcp-chrome-4c7ae5d'`（沙箱禁写真实 HOME）；
  - 用 `PWMCP_PROFILES_DIR_FOR_TEST` 改到工作区后 Chrome 能启动，但返回 `sandbox initialization failed: Operation not permitted` 并退出（嵌套沙箱无法再启动 Chrome 自身沙箱）。
  - 又用与 playwright-core 1.65 匹配的 Chromium headless shell（revision 1252）复测：Playwright 拉起进程后同样因 `sandbox initialization failed: Operation not permitted` 被关闭；只有手动给 Chromium 加 `--no-sandbox` 才能在本机直接跑通 `--dump-dom https://example.com`，但 MCP 没有透传该参数的入口。
  - 结论：**配置、工具名、参数与 smoke 机制均正确；真实导航需在正常 DSH 会话中复测**（catalog 的 smoke 保留）。
- 风险补充：默认把浏览器 profile 持久化在 `~/Library/Caches/ms-playwright-mcp`，登录态跨会话保留；需要干净环境用 `--isolated`，无头用 `--headless`。

### 2. chrome-devtools（Chrome DevTools MCP）

- 包：`chrome-devtools-mcp` **1.12.0**（latest，2026-10-22 更新；engines `^20.19.0 || ^22.12.0 || >=23`）。
- 命令：`npx -y chrome-devtools-mcp@latest --no-usage-statistics --no-performance-crux`。
- `--help` 实测：`--usageStatistics` 可 `--no-usage-statistics` 关闭；官方 README 也给出同样示例。`--no-performance-crux` 实测可启动（32 个工具仍正常列出），用于避免性能 Trace URL 上报 Google CrUX。
- `initialize` 返回 `serverInfo: chrome_devtools 1.12.0`；`tools/list` 返回 32 个工具（实测）：
  `click, close_page, drag, emulate, evaluate_script, fill, fill_form, get_console_message, get_css_styles, get_network_request, handle_dialog, hover, lighthouse_audit, list_console_messages, list_network_requests, list_pages, navigate_page, new_page, performance_analyze_insight, performance_start_trace, performance_stop_trace, press_key, resize_page, screencast_start, screencast_stop, select_page, take_heapsnapshot, take_screenshot, take_snapshot, type_text, upload_file, wait_for`。
- 实测 `tools/call navigate_page {"url":"https://example.com"}` 被参数校验拒绝：`pageId: Invalid input: expected number, received undefined`。
  → **1.12 起页面级工具需要 `pageId`**（先 `list_pages` / `new_page`），这是 catalog note 里必须写明的兼容点。
- 启动日志提示：客户端未协商 MCP roots 时，读写本地文件的工具被限制在 OS 临时目录（可用 `--allow-unrestricted-paths` 放开）；catalog 不放开，保持较安全默认。

### 3. filesystem（MCP Filesystem）

- 包：`@modelcontextprotocol/server-filesystem` **2.2.0**（latest，2026-11-04 更新；engines 声明 Node >= 24）。
- 命令：`npx -y @modelcontextprotocol/server-filesystem <allowed-dir>`（catalog 用 `{{workspace}}` 传入工作区）。
- 版本告警：在 Node 22.22.3 上安装/启动会打印 `EBADENGINE required: { node: '>=24' }`，但 2026-11-06 实测 `initialize` / `tools/list` / 工具调用全部正常。已在 note 中写明。
- `initialize` 返回 `serverInfo: secure-filesystem-server 2.2.0`；16 个工具（实测）：
  `read_file, read_text_file, read_media_file, read_multiple_files, write_file, append_file, edit_file, create_directory, list_directory, list_directory_with_sizes, directory_tree, move_file, copy_file, search_files, get_file_info, list_allowed_directories`。
- `smoke`：调用 `list_allowed_directories`，返回 `Allowed directories:\n<测试目录绝对路径>` → catalog 用 `expectContains: "Allowed directories"`，实测通过。
- 补充：支持 `--read-only`（只暴露只读工具），catalog 未启用，写入 note 供用户选择。

### 4. memory（MCP Knowledge Graph Memory）

- 包：`@modelcontextprotocol/server-memory` **2.1.0**（latest，2026-11-04 更新；engines 声明 Node >= 24，Node 22 告警但实测可用）。
- 命令：`npx -y @modelcontextprotocol/server-memory`，环境变量 `MEMORY_FILE_PATH` 指定记忆文件。
- `initialize` 返回 `serverInfo: memory-server 2.1.0`；9 个工具（实测）：
  `create_entities, create_relations, add_observations, delete_entities, delete_observations, delete_relations, read_graph, search_nodes, open_nodes`。
- 实测：带 `MEMORY_FILE_PATH=.../memory.json` 调用 `create_entities`、`read_graph` 均成功；落盘内容每行一个 JSON 对象（JSONL），扩展名可以叫 `.json` 但不是标准 JSON 文档。
- 实测坑：**父目录不存在时** 写入报 `ENOENT: ... memory.json.lock`；server 不会创建目录。
  → catalog 默认路径改为 `{{dshHome}}/mcp-station-memory.json`（`dshHome` 必然存在），并在 input description/note 写明「父目录必须已存在、文件是 JSONL」。
- `smoke`：`read_graph`，返回文本含 `"entities"` → `expectContains: "entities"`，实测通过。

### 5. github（MCP GitHub，npm 包已归档）

- 包：`@modelcontextprotocol/server-github` **2025.4.8**，npm 已标记 deprecated：
  `Archived and unmaintained; no security guarantees. See https://github.com/modelcontextprotocol/servers-archived`。
- `initialize` 返回 `serverInfo: github-mcp-server 0.6.2`（协议回退到 2024-11-05）；26 个工具（实测）：
  `create_or_update_file, search_repositories, create_repository, get_file_contents, push_files, create_issue, create_pull_request, fork_repository, create_branch, list_commits, list_issues, update_issue, add_issue_comment, search_code, search_issues, search_users, get_issue, get_pull_request, list_pull_requests, create_pull_request_review, merge_pull_request, get_pull_request_files, get_pull_request_status, update_pull_request_branch, get_pull_request_comments, get_pull_request_reviews`。
- 认证实测（关键）：
  - 不设任何 token：`search_repositories` **仍返回结果**（匿名调用 GitHub 公共 API）；有速率限制，私有仓库/写操作不可用。
  - 只设 `GITHUB_TOKEN`：行为与不设相同（server **不读** `GITHUB_TOKEN`）。
  - 设 `GITHUB_PERSONAL_ACCESS_TOKEN`（无效值）：返回 `Authentication Failed: Bad credentials`。
  → 证明 server 需要的是 **`GITHUB_PERSONAL_ACCESS_TOKEN`**。catalog 现在直接把同名宿主环境变量映射进去：
    `"env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "env:GITHUB_PERSONAL_ACCESS_TOKEN"}`，即 patch 生成
    `!!js process.env.GITHUB_PERSONAL_ACCESS_TOKEN`，token 值不会落盘。使用前在宿主机 export 同名变量即可。
- 由于 npm 包已归档，note 中写明官方替代：远程 `https://api.githubcopilot.com/mcp/`（需要 `Authorization` 头，当前 catalog schema 没有 headers 字段，装不了）或 Docker 镜像 `ghcr.io/github/github-mcp-server`。
- 需要 key 的预设，catalog **不写 smoke**。

### 6. context7（Context7 文档）

- 包：`@upstash/context7-mcp` **4.5.1**（latest，2026-11-06 更新；engines Node >= 20.18.1）。
- `--help` 实测：`--transport <stdio|http>`、`--port`、`--api-key`（或环境变量 `CONTEXT7_API_KEY`）、`--research-preview`。
- `initialize` 返回 `serverInfo: Context7 4.5.1`；2 个工具（实测）：`resolve-library-id`、`query-docs`。
- 实测调用 `resolve-library-id`（同时传 `libraryName` 与 `query`，**两个参数都必填**）返回 React 的 Context7 ID（如 `/reactjs/react.dev`）。未带 API key 也能工作。
- `query-docs` 仅验证存在于 `tools/list`，未实际取文档（避免额外网络/额度消耗）。catalog 未加 smoke（避免每次安装触发外网请求）。

### 7. tavily（Tavily 远程 MCP）

- 端点：`https://mcp.tavily.com/mcp/?tavilyApiKey=<key>`（与官方文档一致；catalog 用 `{{TAVILY_API_KEY}}` 模板）。
- 实测：
  - 无 key：`initialize` → **HTTP 401**。
  - 带占位 key（`tvly-invalid-probe`）：`initialize` → HTTP 200，`serverInfo: tavily-mcp 4.1.5`；`tools/list` 返回 5 个工具：
    `tavily_search, tavily_extract, tavily_crawl, tavily_map, tavily_research`。
  - 真实搜索调用需要有效 key，本次**未验证**（catalog 标注为需 key 即可）。
- 风险：key 直接拼在 URL 中，会被写进本机 profile patch；查询内容发往 Tavily 云端。catalog 保留 `requires.apiKey`、不写 smoke。

### 8. sequential-thinking（新增）

- 包：`@modelcontextprotocol/server-sequential-thinking` **2.1.1**（latest，2026-11-04 更新；engines 声明 Node >= 24，Node 22 实测可用）。
- `initialize` 返回 `serverInfo: sequential-thinking-server 2.1.1`；单工具 `sequentialthinking`（实测列表）。
- 实测调用 `sequentialthinking {thought, nextThoughtNeeded:false, thoughtNumber:1, totalThoughts:1}` 返回结构化结果 `{"thoughtNumber":1,"totalThoughts":1,"nextThoughtNeeded":false,"thoughtHistoryLength":1}`。
- 无网络/文件访问，风险低；catalog 新增 preset，并加 smoke（`expectContains: "thoughtNumber"`，实测通过）。

### 9. everything（新增）

- 包：`@modelcontextprotocol/server-everything` **2.2.1**（latest，2026-11-04 更新；engines 声明 Node >= 24，Node 22 实测可用）。
- `initialize` 返回 `serverInfo: mcp-servers/everything 2.2.1`；16 个工具（实测）：
  `echo, get-annotated-message, get-env, get-header-params, get-resource-links, get-resource-reference, get-structured-content, get-sum, get-tiny-image, gzip-file-as-resource, trigger-list-changed, trigger-log-messages, trigger-long-running-operation, trigger-resource-update, toggle-simulated-logging, toggle-subscriber-updates`。
- 实测 `echo {message:"mcp-station-smoke"}` 返回 `Echo: mcp-station-smoke`，smoke 用它（`expectContains: "Echo: mcp-station"`）。
- 风险：`get-env` 会返回 server 进程的环境变量（可能含密钥）；仅作测试用途，故 risk 定 medium 并在 note 提醒。

## catalog 变更摘要

1. **新增 2 个已验证预设**：`sequential-thinking`、`everything`（均实测 initialize + tools/list + 一次工具调用）。
2. **所有 npx 预设注入 npm 缓存**：8 个 `npx` 预设都加 `env.npm_config_cache = "{{dshHome}}/mcp-station/npm-cache"`，修复 `~/.npm` 不可写时 `npx` EPERM 的启动失败；tavily（远程）不涉及。
3. **修正 github 认证变量**：`env` 从 `GITHUB_TOKEN` 改为 `GITHUB_PERSONAL_ACCESS_TOKEN: "env:GITHUB_PERSONAL_ACCESS_TOKEN"`（server 只认前者，实测 `GITHUB_TOKEN` 会被忽略）；description/risk/note 标注 npm 包已归档与官方替代；不写 smoke。
4. **修正 memory 默认路径**：改为 `{{dshHome}}/mcp-station-memory.json`（父目录必须存在）；说明 JSONL 格式；补 `read_graph` smoke。
5. **chrome-devtools**：args 增加 `--no-performance-crux`（实测可启动），note 写明 1.12 页面工具需要 `pageId`、profile 位置与 roots 限制。
6. **filesystem**：补 `list_allowed_directories` smoke；note 写明 Node >= 24 告警与 `--read-only`；风险补充删除/移动。
7. **playwright**：描述补充 profile 持久化；风险补充登录态持久化；note 记录本环境导航 smoke 未完成及原因；smoke 配置保留（tool/参数已验证）。
8. **tavily/context7/github 等描述**按实测工具名、版本与限制校准；需要 key 的预设（github、tavily）均无 smoke。
9. 所有 preset 的 `serverName` 均满足 `[A-Za-z0-9_-]{1,32}` 且唯一；JSON 可被 `node` 直接解析（见下）。

## 验证脚本与复现

catalog 结构自检（临时脚本，不随包发布）：

```sh
node -e "const c=require('./data/catalog.json'); console.log(c.presets.length, c.presets.map(p=>p.serverName))"
```

stdio 工具名的最小复现（以 memory 为例，输出为换行分隔 JSON-RPC）：

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | npx -y @modelcontextprotocol/server-memory
```

远程 MCP（Tavily）换 key 后：

```sh
curl -sS -X POST 'https://mcp.tavily.com/mcp/?tavilyApiKey=<key>' \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"1"}}}'
```

## 未纳入 / 仍未验证

- **fetch**：官方 fetch server 是 Python 版（`uvx mcp-server-fetch`），npm 上的 `mcp-server-fetch` 是安全占位包（0.0.1-security）；catalog 的 `requires` 没有 uv/Python 检测字段，故本次不加入，避免装完不可用。
- **GitHub 远程 / Docker 版**：需要 `headers`（Authorization）或 Docker 依赖，当前 catalog schema 表达不了；等 schema 支持 headers 后可替换已归档的 npm 包。
- **Playwright `example.com` 导航**：工具名、参数、smoke 配置均已验证，但本机验证沙箱无法启动 Chrome 自身沙箱，实际导航未完成；建议在正常 DSH 会话里点一次 smoke 复测。
- **Tavily 真实搜索**：只验证到「带占位 key 的 initialize/tools/list」；真实 API 调用需要有效 key。
- **Context7 `query-docs`**：仅验证工具存在，未拉取文档内容。
