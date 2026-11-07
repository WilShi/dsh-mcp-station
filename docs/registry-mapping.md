# MCP 官方注册表字段实测与映射建议

日期：**2026-11-07**（CST）。目的：为 0.2.0 “内置市场源包含 MCP 官方注册表” 提供真实 API 字段样本与 CatalogPreset 映射建议。
本文只做调研，不改 `src/**`。

## API 与响应结构

- 基址：`https://registry.modelcontextprotocol.io`
- 列表：`GET /v0/servers?search=<query>&limit=<n>&cursor=<cursor>`
- 响应：`{ servers: [{ server, _meta }], metadata: { nextCursor, count } }`
- 每条 `server` 的关键字段：
  - `name`（如 `io.github.github/github-mcp-server`）、`version`、`description`、`repository`
  - `packages[]`：`registryType`（`npm` / `oci` / `pypi` / `nuget`）、`identifier`、`version`、`transport`、`runtimeHint`、`runtimeArguments[]`、`packageArguments[]`、`environmentVariables[]`
  - `remotes[]`：`type`（`streamable-http` 等）、`url`、`headers[]`
  - `_meta["io.modelcontextprotocol.registry/official"]`：`status`、`isLatest`、`publishedAt`、`updatedAt`
- 同一 `name` 会返回多个历史版本，需要按 semver / `isLatest` 去重。

实测命令：

```sh
curl -sS 'https://registry.modelcontextprotocol.io/v0/servers?search=github-mcp-server&limit=5'
curl -sS 'https://registry.modelcontextprotocol.io/v0/servers?search=filesystem&limit=100'
```

## 抽查结果（真实返回）

### 1) GitHub：OCI + 远程 HTTP（两种都装不了）

`io.github.github/github-mcp-server` 最新 `0.30.3`：

```json
{
  "packages": [{
    "registryType": "oci",
    "identifier": "ghcr.io/github/github-mcp-server:0.30.3",
    "transport": { "type": "stdio" },
    "runtimeArguments": [{
      "type": "named", "name": "-e",
      "value": "GITHUB_PERSONAL_ACCESS_TOKEN={token}",
      "variables": { "token": { "isRequired": true, "isSecret": true } }
    }]
  }],
  "remotes": [{
    "type": "streamable-http",
    "url": "https://api.githubcopilot.com/mcp/",
    "headers": [{ "name": "Authorization", "isSecret": true }]
  }]
}
```

结论：package 是 Docker 镜像（需要 `docker run`）；remote 需要 `Authorization` header。当前 `CatalogPreset` 没有 headers / Docker 字段，**两者都无法作为内置预设安装**。

### 2) Brave Search：标准 npm + 必填 secret 环境变量

`io.github.brave/brave-search-mcp-server`（注册表里最新为 2.0.47，npm latest 已是 2.1.4，注册表存在滞后）：

```json
{
  "packages": [{
    "registryType": "npm",
    "identifier": "@brave/brave-search-mcp-server",
    "version": "2.0.47",
    "transport": { "type": "stdio" },
    "environmentVariables": [{
      "name": "BRAVE_API_KEY", "isRequired": true, "isSecret": true, "format": "string"
    }]
  }]
}
```

映射：`npx -y @brave/brave-search-mcp-server` + `env: { BRAVE_API_KEY: "env:BRAVE_API_KEY" }`，catalog 已收录。

### 3) DBHub：npm，但参数要自己补

`io.github.bytebase/dbhub`（npm `@bytebase/dbhub`，注册表 1.2.1 左右，npm latest 1.5.1）返回的 package 没有 `runtimeArguments`、没有 `environmentVariables`：
映射方需要自行追加 `--dsn` 等启动参数。catalog 里 postgres/sqlite 预设就是手工映射 `--transport stdio --dsn ...`。

### 4) filesystem：注册表里没有官方 reference 条目

`search=filesystem&limit=100` 返回的全部是第三方（pulsemcp、bytebase、Digital-Defiance、j0hanz...），没有
`@modelcontextprotocol/server-filesystem` 或 `io.github.modelcontextprotocol/filesystem`。官方 reference servers
（filesystem/memory/sequential-thinking/everything）不一定发布在 registry；内置目录继续按 npm 官方包维护。
同理，`search=modelcontextprotocol` 返回 0 条。

### 5) postgres：没有官方条目

`search=postgres` / `search=postgres-mcp` 只有第三方，例如 `io.github.Eszetael/postgres-mcp-hardened`
（npm，env `DATABASE_URL` / `MCP_ALLOW_TABLES` 等），没有官方 Postgres server。不要按 registry 自动收录“postgres”这个关键词。

### 6) notion / sequential-thinking：注册表与 npm 官方包不是一回事

- `search=notion-mcp-server` 命中第三方 `io.github.awkoy/notion-mcp-server`（npm `notion-mcp-server`，env `NOTION_TOKEN`+`NOTION_PAGE_ID`），
  不是 `@notionhq/notion-mcp-server`。内置目录选官方 npm 包。
- `search=sequential-thinking` 只命中第三方 pypi `io.github.arben-adm/mcp-sequential-thinking`，不是
  `@modelcontextprotocol/server-sequential-thinking`。
结论：registry 是**社区发布目录**，不能当成“官方包清单”；内置精选仍需人工核对 npm 包。

## 字段 → CatalogPreset 映射规则（建议）

| registry 字段 | CatalogPreset | 说明 |
| --- | --- | --- |
| `packages[].registryType === "npm"` | `command: "npx"`, `args: ["-y", identifier]` | 可选用注册表 version 固定版本；npm 版本通常更新，优先 npm latest |
| `packages[].runtimeArguments[]` | 追加到 `args` | `positional` → 直接值；`named` → `name` + `value`；值里 `{var}` 用安装输入/环境变量替换 |
| `packages[].environmentVariables[]` | `env` | `isRequired && isSecret` → `{ NAME: "env:NAME" }`（不落盘）或安装输入；非 secret → 可给默认值 |
| `packages[].registryType === "oci"` | 跳过 / 需要 Docker 支持 | `docker run -i --rm ...`；当前 `requires` 无法表达 docker 依赖 |
| `packages[].registryType === "pypi"` | 跳过 / 需要 uvx 支持 | `uvx <identifier>`；`requires` 无法表达 python/uv |
| `packages[].registryType === "nuget"` | 跳过 | 需要 dotnet |
| `remotes[].type === "streamable-http"` | `transport: "streamable-http"`, `url` | 仅当 `headers` 为空时可直接安装 |
| `remotes[].headers[]` | ❌ 当前不支持 | CatalogPreset 无 headers；需要扩展 schema 才能支持 GitHub/Linear/Sentry 等远程服务 |
| `_meta...isLatest` / semver | 版本选择 | 同一 name 去重，取最新稳定版；注意 registry 可能落后 npm |
| `name`（`io.github.owner/repo`） | `serverName` | 小写、把 `.`/`/` 换成 `-`、截断 32 字符并去重；id 用 kebab-case |

### 给 server-dev 的简明结论

- **可以直接映射安装**：`registryType=npm` 且 `remotes` 无 headers 的条目（如 Brave、DBHub、Notion 第三方…）。环境变量用 `env:NAME` 保留为引用，不要把 secret 写盘。
- **必须人工补参**：DBHub 这类 package 没有 `runtimeArguments`/`environmentVariables`，需要产品层给默认 args（例如 `--dsn`）或安装输入。
- **建议先跳过**：`oci`（GitHub 官方）、`pypi`（fetch/time/git 官方）、`nuget`；以及任何 `remotes[].headers` 含必填 Authorization 的条目。
- **如需支持远程带 header 的服务**：建议给 `CatalogPreset` 增加可选 `headers: Record<string,string>`（与 `InstalledServer.headers`、`patch.ts` 的 headers 渲染对齐），值支持 `env:NAME`；这样 GitHub 官方 remote、Linear/Sentry/Notion 官方 remote 才能进入内置目录。
- **不要把 registry 全量导入**：里面有大量个人/实验 server，版本数量巨大；内置目录应保持人工精选 + 我们的验证记录，registry 只作为“发现/导入”来源。
- **ID 冲突**：registry 的 `name` 全局唯一但很长，映射到 `serverName` 需处理 32 字符限制与重名；跨 market source 用 `sourceId:preset.id` 做稳定身份。
- **信任**：只自动展示 `_meta.status === "active"` 且能解析出 npm/HTTP 的条目；其余标记不可安装并给出原因。

## 复现

```sh
curl -sS 'https://registry.modelcontextprotocol.io/v0/servers?search=github-mcp-server&limit=5' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log(JSON.stringify(d.servers[0].server,null,2))})"
```
