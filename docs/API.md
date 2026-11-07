# MCP Station HTTP API (v0.1)

All routes live under `/mcp-station/api`. Responses are JSON:
`{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code": string, "message": string } }`.

Mutating routes require a same-origin request (same guard as other DSH plugins).

| Method | Path | Body / Query | Data |
| --- | --- | --- | --- |
| GET | `/status` | — | `StationStatus` |
| GET | `/catalog` | — | `{ catalog: CatalogFile, servers: InstalledServer[] }` |
| GET | `/servers` | — | `{ servers: InstalledServer[] }` |
| POST | `/servers/install` | `{ presetId, serverName?, values?: Record<string,string> }` | `{ server: InstalledServer }` |
| POST | `/servers/test` | `{ serverName }` | `{ result: ProbeResult }` |
| POST | `/servers/toggle` | `{ serverName, enabled: boolean }` | `{ server: InstalledServer }` |
| POST | `/servers/smoke` | `{ serverName }` | `{ result: SmokeResult }` |
| DELETE | `/servers` | `?name=<serverName>` | `{ removed: boolean }` |
| GET | `/doctor` | — | `{ checks: DoctorCheck[] }` |

## Types

The canonical types live in `src/shared/types.ts`.

### CatalogPreset

- `id`: stable preset id (kebab-case).
- `serverName`: namespace used by the MCP client (`[A-Za-z0-9_-]{1,32}`), also the
  `mcp__<serverName>__*` tool prefix.
- `transport`: `stdio` or `streamable-http`.
- `command` / `args` / `url` / `env`: template fields. Templates support:
  - `{{inputKey}}` — replaced with the value supplied at install time;
  - `env:NAME` — emitted as `!!js process.env.NAME` so the secret is not written to disk;
  - `{{workspace}}` — resolved to the current workspace directory.
- `inputs`: fields the install dialog asks for (`text`, `secret`, `path`, `url`).
- `risk`: `low` / `medium` / `high` plus localized reasons.
- `smoke`: optional MCP tool call used after install to prove the server works.

### InstalledServer

A row of `@deepseek-ai/dsh-mcp-client` in the active profile's
`cordis.patch.yml`, merged with runtime probe results:

- `origin`: `station` (inside the managed block) or `external` (hand-written or
  another plugin's row — read-only for MCP Station).
- `enabled`: whether the row is disabled via the loader patch.
- `status`: `connected` / `error` / `unknown` / `disabled`.
- `tools`: tool summaries from `tools/list`.

## Managed block

MCP Station owns exactly one block in `cordis.patch.yml`:

```yaml
# >>> dsh-mcp-station:begin
- insert:
    - id: mcp-station-playwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: playwright
        transport: stdio
        command: npx
        args: ['-y', '@playwright/mcp@latest', '--browser', 'chrome']
# <<< dsh-mcp-station:end
```

The `- insert:` wrapper follows DSH app-boot patch semantics: a bare row with a
new id is treated as an override and skipped with a warning, so every new MCP
server must be inside an insert list. Disabling a managed server writes
`disabled: true` on that inserted row.

Everything outside the block is preserved byte-for-byte. Rows outside the block
are never modified by MCP Station.

## 0.1.1 additions

| Method | Path | Body | Data |
| --- | --- | --- | --- |
| POST | `/servers/custom` | `CustomServerInput` | `{ server: InstalledServer }` |
| POST | `/servers/custom/update` | `CustomServerInput` | `{ server: InstalledServer }` |
| POST | `/servers/import` | `{ json: string }` | `{ imported: InstalledServer[], skipped: { name, reason }[] }` |

`POST /servers/install` accepts an optional `test: boolean`; when true the
server is probed before the response and carries `status`, `toolCount`,
`tools` and `latencyMs`.

### CustomServerInput

- `serverName`: unique name, `[A-Za-z0-9_-]{1,32}`.
- `transport`: `stdio` or `streamable-http`.
- stdio: `command`, optional `args: string[]`, `env: Record<string,string>`.
- HTTP: `url`, optional `headers: Record<string,string>`.
- `enabled?: boolean` (default true).

Header and env values support `env:NAME`, which is written as
`!!js process.env.NAME` so the secret itself is not persisted.

### Import formats

Accepted JSON documents:

```json
{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "pkg"] } } }
{ "mcpServers": { "name": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer x" } } } }
{ "servers": [ { "name": "name", "command": "npx" } ] }
```

Invalid, duplicate or already-installed names are skipped with a reason;
valid entries are installed into the managed block.

## 0.2.0 market sources

The bundled catalog is one market source (`builtin`). Users can add remote
JSON sources; the store merges all enabled sources and tags each preset with
its source.

| Method | Path | Body / Query | Data |
| --- | --- | --- | --- |
| GET | `/sources` | — | `{ sources: MarketSourceStatus[] }` |
| POST | `/sources` | `{ url, name?, language?, headers?, enabled? }` | `{ source }` (new/updated sources are fetched eagerly) |
| POST | `/sources/update` | `{ id, ... }` | `{ source }` |
| DELETE | `/sources` | `?id=<sourceId>` | `{ removed: boolean }` |
| POST | `/sources/refresh` | `{ id?: string }` | `{ sources }` |
| GET | `/market` | `?search=&source=&cursor=&limit=` | `{ items, nextCursor?, sources, warnings }` |
| GET | `/settings` | — | `{ settings: { displayLanguage, autoTest } }` |
| POST | `/settings` | `{ displayLanguage?: "auto"\|"zh"\|"en", autoTest?: boolean }` | `{ settings }` |

`GET /catalog` now returns presets merged from every enabled source. Each
preset carries `sourceId` and `sourceName`. Install requests accept an
optional `sourceId`; a preset id is only unique inside one source.

### Custom source format

Users add a URL that returns:

```json
{
  "version": 1,
  "name": "My MCP market",
  "presets": [ { "id": "x", "serverName": "x", "displayName": { "zh": "…", "en": "…" }, "tagline": { … }, "description": { … }, "category": "dev", "transport": "stdio", "command": "npx", "args": ["-y", "pkg"], "risk": { "level": "low", "reasons": [] } } ]
}
```

Presets use the same `CatalogPreset` schema as the bundled catalog. Remote
sources are fetched host-side with a 15s timeout, a 5 MB cap and a 10 minute
cache; a failed refresh keeps the last good snapshot.
