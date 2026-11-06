/** Host entry for MCP Station: API surface plus profile patch management. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeApiHandler } from './api.ts'

/** Stable Loader name. */
export const name = 'dsh-mcp-station'

/** Host service required before the local HTTP API is mounted. */
export const inject = ['webServer']

/** Runtime-validated MCP Station configuration. */
export interface Config {
  /** DSH Home override; defaults to DSH_HOME or ~/.dsh. */
  readonly dshHome?: string
  /** Profile override; defaults to the active profile inferred from DSH Home. */
  readonly profile?: string
  /** Workspace used by presets such as filesystem; defaults to <DSH Home>/workspace. */
  readonly workspace?: string
  /** Timeout for one MCP reachability probe, in milliseconds. */
  readonly probeTimeoutMs?: number
  /** Maximum accepted request body size, in bytes. */
  readonly maxBodyBytes?: number
}

/** Loader configuration schema. */
export const Config: z<Config> = z.object({
  dshHome: z.string(),
  profile: z.string(),
  workspace: z.string(),
  probeTimeoutMs: z.number().step(1).min(1000),
  maxBodyBytes: z.number().step(1).min(1024),
})

/** Mount the MCP Station HTTP API. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/mcp-station/api',
        handler: makeApiHandler(ctx, config),
      }),
    'dsh-mcp-station: api route',
  )
}
