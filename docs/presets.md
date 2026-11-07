# MCP Station 预设验证记录（0.2.0）

验证日期：**2026-11-07**（CST）。本文记录 `data/catalog.json` 里 26 个内置预设的实测证据、结论与修改理由。
catalog schema 以 `src/shared/types.ts` 的 `CatalogPreset` 为准。

## 验证环境

| 项目 | 值 |
| --- | --- |
| 系统 | macOS 24.6.0（arm64） |
| Node / npm | v22.22.3 / 10.9.8 |
| 浏览器 | Google Chrome 156.0.8078.80 |
| 包版本来源 | `npm view <pkg> version time.modified` + `registry.npmjs.org`（2026-11-07 取样） |
| stdio 探测 | spawn 服务后发换行分隔 JSON-RPC：`initialize` → `notifications/initialized` → `tools/list` → 可选 `tools/call`，结束后按进程组清理 |
| HTTP 探测 | `curl` 对 streamable HTTP 端点发 `initialize`（`accept: application/json, text/event-stream`）与 `tools/list` |
| 官方注册表抽查 | `https://registry.modelcontextprotocol.io/v0/servers?search=<q>&limit=<n>`（详见 `docs/registry-mapping.md`） |

> 验证在 DSH 文件沙箱（workspace-write）中进行：部分包会写 `~/.mongodb`、`~/Library/Caches/...` 等 HOME 路径，
> 本次通过 `HOME`/`TMPDIR` 重定向解决；Chrome 内核沙箱无法在嵌套沙箱启动，Playwright 的导航 smoke 仍未完成。

## 结论总表

| # | preset | 上游包 / 端点 | 版本 | 工具数 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | `playwright` | `@playwright/mcp` | 0.0.84 | 25 | ✅ 参数/工具名有效；⚠️ `browser_navigate` 受验证沙箱限制 |
| 2 | `chrome-devtools` | `chrome-devtools-mcp` | 1.12.0 | 32 | ✅ initialize/tools/list 实测；页面工具需 `pageId` |
| 3 | `filesystem` | `@modelcontextprotocol/server-filesystem` | 2.2.0 | 16 | ✅ smoke `list_allowed_directories` 通过 |
| 4 | `memory` | `@modelcontextprotocol/server-memory` | 2.1.0 | 9 | ✅ smoke `read_graph` 与写入实测通过 |
| 5 | `github` | `@modelcontextprotocol/server-github` | 2025.4.8（已归档） | 26 | ⚠️ 0.1.x id 兼容保留；tools/list 实测；需 GITHUB_PERSONAL_ACCESS_TOKEN |
| 6 | `context7` | `@upstash/context7-mcp` | 4.5.1 | 2 | ✅ 免 key，`resolve-library-id` 实测返回文档 ID |
| 7 | `tavily` | `https://mcp.tavily.com/mcp/` | 远程 4.1.5 | 5 | 🔑 无 key 401；占位 key 实测协议与工具列表 |
| 8 | `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking` | 2.1.1 | 1 | ✅ `sequentialthinking` 实测调用通过 |
| 9 | `everything` | `@modelcontextprotocol/server-everything` | 2.2.1 | 16 | ✅ smoke `echo` 通过；测试专用 |
| 10 | `notion` | `@notionhq/notion-mcp-server` | 2.6.1 | 24 | 🔑 token 必需；tools/list 实测 |
| 11 | `slack` | `slack-mcp-server` | 1.3.0 | — | 🔑 token 必需；启动即校验，未取得 tools/list |
| 12 | `linear` | `@tacticlaunch/mcp-linear` | 1.4.5 | 198 | 🔑 tools/list 实测 |
| 13 | `gitlab` | `@zereight/mcp-gitlab` | 2.3.22 | 40 | 🔑 tools/list 实测 |
| 14 | `postgres` | `@bytebase/dbhub` | 1.5.1 | 2 | 🔑 DSN 必需；SQL 实测通过（SQLite 模式） |
| 15 | `sqlite` | `@bytebase/dbhub` | 1.5.1 | 2 | ✅ smoke `execute_sql` 实测通过 |
| 16 | `kubernetes` | `mcp-server-kubernetes` | 4.2.1 | 23 | ✅ tools/list + `ping` 实测；需 kubeconfig |
| 17 | `sentry` | `@sentry/mcp-server` | 0.49.0 | 73 | 🔑 tools/list 实测 |
| 18 | `git` | `@cyanheads/git-mcp-server` | 2.15.3 | 28 | ✅ tools/list 实测；需传仓库路径 |
| 19 | `mongodb` | `mongodb-mcp-server` | 3.2.2 | 27 | 🔑 tools/list 实测（需 HOME 可写） |
| 20 | `supabase` | `@supabase/mcp-server-supabase` | 0.16.1 | 36 | 🔑 tools/list 实测 |
| 21 | `excel` | `@negokaz/excel-mcp-server` | 0.12.0 | 6 | ✅ tools/list 实测；需具体 xlsx 路径 |
| 22 | `brave-search` | `@brave/brave-search-mcp-server` | 2.1.4 | 8 | 🔑 tools/list 实测 |
| 23 | `exa` | `exa-mcp-server` | 3.4.3 | 3 | 🔑 tools/list 实测 |
| 24 | `firecrawl` | `firecrawl-mcp` | 3.38.0 | 30 | 🔑 tools/list 实测 |
| 25 | `duckduckgo` | `duckduckgo-mcp-server` | 0.1.2 | 1 | ✅ 免 key；实测调用被 DDG 限流（上游行为） |
| 26 | `apify` | `@apify/actors-mcp-server` | 0.21.4 | 13 | 🔑 tools/list 实测 |

状态：✅ 已实测；🔑 需要 key/token/DSN（tools/list 已在无有效凭证下实测，除 slack）；⚠️ 局部未完成。

## 逐项证据

### 官方 reference / 浏览器

- **filesystem** 2.2.0：16 tools（read_file、read_text_file、write_file、edit_file、search_files、list_allowed_directories…）；`list_allowed_directories` 返回 authorization 目录；engines 声明 Node >= 24，Node 22 有 EBADENGINE 告警但可用。
- **memory** 2.1.0：9 tools；`MEMORY_FILE_PATH` 生效，文件是 JSONL；父目录不存在会 ENOENT。
- **sequential-thinking** 2.1.1：`sequentialthinking` 调用返回 `thoughtNumber` / `thoughtHistoryLength`。
- **everything** 2.2.1：16 tools；`echo {message}` 返回 `Echo: ...`；`get-env` 会暴露环境变量。
- **playwright** 0.0.84：25 tools；`--browser chrome`、`--timeout-action` 等参数通过 `--help` 核对；0.0.84 默认后端是 `chrome-for-testing`，显式 `--browser chrome` 才复用本机 Chrome。导航 smoke 因验证沙箱无法启动 Chrome 自身 sandbox 未完成。
- **chrome-devtools** 1.12.0：32 tools；`--no-usage-statistics`、`--no-performance-crux` 实测可启动；`navigate_page` 缺 `pageId` 被拒绝（1.12 页面级工具需要先 `list_pages`/`new_page`）。
- **context7** 4.5.1：2 tools（resolve-library-id、query-docs）；`resolve-library-id` 需同时传 `libraryName`+`query`，无 key 实测返回 `/reactjs/react.dev` 等 ID。

### 搜索 / 抓取

- **tavily**：远程 streamable-http；无 key `initialize` 返回 401；占位 key 返回 200，server 4.1.5，5 tools：`tavily_search/extract/crawl/map/research`。
- **brave-search** 2.1.4：8 tools（brave_web_search、local/video/image/news、summarizer、llm_context、place）；`BRAVE_API_KEY`；官方注册表条目为 npm `@brave/brave-search-mcp-server` + 必填 secret `BRAVE_API_KEY`。
- **exa** 3.4.3：3 tools（web_search_exa、web_fetch_exa、agent_run）；`EXA_API_KEY`。
- **firecrawl** 3.38.0：30 tools（scrape/map/search/crawl/agent/monitor/…）；`FIRECRAWL_API_KEY`。
- **duckduckgo** 0.1.2：1 tool `duckduckgo_web_search`；免 key；实测调用遇到 DDG 上游限流（`please try again later` 类错误），工具本身正常。
- **apify** 0.21.4：13 tools（search-actors、call-actor、get-actor-run、get-dataset-items…）；`APIFY_TOKEN`。

### 项目协作

- **notion** 2.6.1：24 tools（API-post-search、API-retrieve-a-page、API-query-data-source、API-create-a-comment…）；`NOTION_TOKEN`（integration token）。
- **slack** 1.3.0：Go 二进制经 Node wrapper 分发；**启动时即校验 token**，缺少/无效 token 返回 `Authentication required` / `invalid_auth`，因此本次未取得 tools/list；支持 `SLACK_MCP_XOXP_TOKEN` 或 `SLACK_MCP_XOXC_TOKEN`+`SLACK_MCP_XOXD_TOKEN`；发消息默认关闭。
- **linear** 1.4.5：198 tools（linear_getViewer、linear_createProject、linear_getProjectIssues、release/roadmap 等）；`LINEAR_API_TOKEN`。
- **gitlab** 2.3.22：40 tools（search_repositories、create_merge_request、get_merge_request_diffs、list_issues、whoami…，可用 discover_tools 扩展）；`GITLAB_PERSONAL_ACCESS_TOKEN` + `GITLAB_API_URL=https://gitlab.com/api/v4`。

### 数据存储

- **postgres / sqlite**：均用 `@bytebase/dbhub` 1.5.1，默认 2 tools：`execute_sql`、`search_objects`。SQLite 模式（`--dsn sqlite:///path`）实测 `SELECT 1 AS ok` 成功；Postgres 仅依赖同一二进制与 DSN，未连真实库。DSN 会写入 profile，note 已建议只读账号。
- **mongodb** 3.2.2：27 tools（find、aggregate、insert-many、collection-schema、drop-database…）；`MDB_MCP_CONNECTION_STRING`；首次运行写 `~/.mongodb`，验证时用 HOME 重定向后 tools/list 正常。
- **supabase** 0.16.1：36 tools（list_projects、execute_sql、apply_migration、create_branch、deploy_edge_function…）；`SUPABASE_ACCESS_TOKEN`；建议加 `--project-ref` 限定项目（note 已写）。
- **excel** 0.12.0：6 tools（excel_describe_sheets、excel_read_sheet、excel_write_to_sheet、excel_copy_sheet、excel_create_table、excel_format_range）；`EXCEL_FILES_PATH`；工具必须传具体 xlsx 路径，无安全的无参 smoke。

### 运维 / 代码

- **kubernetes** 4.2.1：23 tools（kubectl_get/apply/delete/logs/exec、Helm、port_forward、ping…）；默认读 `~/.kube/config`；`ping` 调用成功（不依赖集群）。
- **sentry** 0.49.0：73 tools（search_issues、get_event_stacktrace、search_traces、update_issue、alerts…）；`SENTRY_AUTH_TOKEN`，自建加 `SENTRY_HOST`。
- **git** 2.15.3：28 tools（git_status、git_diff、git_log、git_commit、git_branch、git_push…）；建议 `GIT_BASE_DIR={{workspace}}` 限定目录；工具需仓库路径，未配置 smoke。
- **github** 2025.4.8（归档）：server 0.6.2、26 tools（create_issue、search_code、get_pull_request…）；`GITHUB_PERSONAL_ACCESS_TOKEN` 映射实测；保留 id 兼容性，迁移建议见 note。

## github：保留 0.1.x 的稳定 id

- **github（`@modelcontextprotocol/server-github` 2025.4.8）**：npm 已归档并标记 *Archived and unmaintained; no security guarantees*，
  但 0.1.x 已内置该 id，为保持 preset id / serverName / env 映射稳定（`tests/catalog.spec.ts` 也依赖它）而**保留**。
  实测 server 0.6.2、26 tools；`GITHUB_PERSONAL_ACCESS_TOKEN` 的 env 映射已实测（无效 token 会返回 `Bad credentials`）。
- 官方现为 `io.github.github/github-mcp-server`：
  - OCI 镜像 `ghcr.io/github/github-mcp-server:0.30.3`（需要 Docker，registry `runtimeArguments` 注入 `GITHUB_PERSONAL_ACCESS_TOKEN`）；
  - 远程 `https://api.githubcopilot.com/mcp/`（需要 `Authorization` header）。
  两者当前 CatalogPreset schema 都表达不了（无 headers / 无 Docker 依赖），详见 `docs/registry-mapping.md`。
  需要最新能力的用户可通过 “自定义服务器 / 导入” 手动配置，或等 schema 支持 headers；github 预设的 note 已注明归档与迁移建议。

## smoke 策略

- 无 key **且** 能无参/固定参数调用的预设才配 smoke：`playwright`、`filesystem`、`memory`、`sequential-thinking`、`everything`、`sqlite`、`kubernetes`、`duckduckgo`。
- 有 key/token/DSN 的 14 个预设一律不配 smoke（github/tavily/notion/slack/linear/gitlab/postgres/sentry/mongodb/supabase/brave/exa/firecrawl/apify）。
- 不配 smoke 的免 key 预设：`chrome-devtools`（需实际浏览器窗口，未验证调用）、`context7`（每次安装触发外网查询，避免消耗额度）、`git`、`excel`（工具必须传具体仓库/xlsx 路径，没有可移植的无参调用）。

## catalog 变更摘要（0.2.0）

1. 预设从 9 个扩到 **26 个**：保留 0.1.x 的 9 个 id（含归档但稳定的 github），新增 notion、slack、linear、gitlab、postgres、sqlite、kubernetes、sentry、git、mongodb、supabase、excel、brave-search、exa、firecrawl、duckduckgo、apify（17 个）。
2. 所有 npx 预设继续注入 `npm_config_cache={{dshHome}}/mcp-station/npm-cache`，避免 `~/.npm` 不可写时 npx EPERM。
3. 需要凭证的预设统一用 `env:NAME` 引用宿主环境变量（不落盘）；DB 类用 `text/secret` 输入（DSN 会写 profile，已在 note 告警）。
4. 新增输入默认值：sqlite `{{workspace}}/mcp-station.sqlite`、git `GIT_BASE_DIR={{workspace}}`、excel `EXCEL_FILES_PATH={{workspace}}`。
5. 所有 preset 的 `serverName` 满足 `[A-Za-z0-9_-]{1,32}` 且唯一；catalog 可被 `node` 直接解析。

## 自定义市场源（market source）示例

`docs/market-source.example.json` 是一个可直接作为“自定义市场源”导入的示例，结构：

```json
{
  "version": 1,
  "name": "My MCP market (example)",
  "presets": [ /* CatalogPreset 数组，字段与内置 data/catalog.json 完全一致 */ ]
}
```

- `version` 固定为 `1`；`name` 是商店里显示的来源名称；`presets` 用与内置目录相同的 `CatalogPreset` schema
  （`id` / `serverName` / `displayName` / `tagline` / `description` / `category` / `transport` / `command` / `args` / `url` / `env` / `inputs` / `requires` / `risk` / `docs` / `tags` / `smoke` / `note`）。
- 模板支持 `{{inputKey}}`、`{{workspace}}`、`{{dshHome}}`；`env` 值支持 `env:NAME`（从宿主 `process.env` 引用，不落盘）。
- 市场源以远程 URL 提供 JSON：host 端 15s 超时、5MB 上限、10 分钟缓存；刷新失败保留上次快照。
- 来源合并后每个 preset 带 `sourceId` / `sourceName`，安装请求可带 `sourceId`；`preset.id` 只需在单个来源内唯一。
- 当前 `CatalogPreset` **没有 headers 字段**：需要 `Authorization` header 的远程 MCP 不能放进市场源预设（可用“自定义服务器/导入”手配）。

示例文件里包含 3 个 case：`mysql`（stdio + DSN 输入）、`demo-everything`（无 key + smoke）、`tavily-search`（streamable-http + URL 内 key）。

## 复现方法

```sh
# 版本与弃用状态
npm view <pkg> version deprecated bin engines --json

# stdio：initialize + tools/list（换行分隔 JSON-RPC）
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | npx -y <pkg>

# 官方注册表抽查（字段说明见 docs/registry-mapping.md）
curl -sS 'https://registry.modelcontextprotocol.io/v0/servers?search=github-mcp-server&limit=5'

# catalog 解析与自检
node -e "const c=require('./data/catalog.json');console.log(c.presets.length)"
```

## 仍未验证

- **Playwright `example.com` 导航**：工具名/参数/smoke 配置已验证，本机验证沙箱无法启动 Chrome 内核沙箱；正常 DSH 会话可点一次 smoke 复测。
- **Slack tools/list**：server 启动即做 token 校验，无有效 token 无法列出工具；仅确认了包可安装、认证变量与默认安全行为。
- **Postgres / MongoDB / Supabase 真实数据库读写**：仅验证到 `initialize`+`tools/list`（SQLite 模式做了真实 SQL 调用）。
- **各搜索/抓取服务的真实 API 调用**：仅验证 tools/list；没有可用 key 时不发真实请求，避免产生费用。
