import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildChildEnv,
  callStdioTool,
  probeHttp,
  probeStdio,
  resolveEnvValues,
  scrubbedParentEnv,
} from '../src/mcp/probe.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url))

describe('scrubbedParentEnv / buildChildEnv', () => {
  it('drops DSH_* and credential-shaped parent names', () => {
    const env = scrubbedParentEnv({
      PATH: '/bin',
      HOME: '/home/demo',
      DSH_HOME: '/secret',
      DSH_PROFILE: 'web',
      GITHUB_TOKEN: 't',
      API_KEY: 'k',
      MY_SECRET: 's',
      DB_PASSWORD: 'p',
      NORMAL_FLAG: '1',
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/demo', NORMAL_FLAG: '1' })
  })

  it('lets explicit env win over the scrubbed parent', () => {
    const env = buildChildEnv({ MCP_STATION_TEST: 'ok' })
    expect(env.MCP_STATION_TEST).toBe('ok')
    expect(env.DSH_HOME).toBeUndefined()
  })
})

describe('resolveEnvValues', () => {
  it('resolves env:NAME, literal values and !!js expressions', () => {
    const values = resolveEnvValues(
      { GITHUB_TOKEN: 'env:GITHUB_TOKEN', LITERAL: 'plain', NUMBER: { js: '1 + 2' } },
      { GITHUB_TOKEN: 'from-parent' },
    )
    expect(values.GITHUB_TOKEN).toBe('from-parent')
    expect(values.LITERAL).toBe('plain')
    expect(values.NUMBER).toBe('3')
  })

  it('omits undefined env references', () => {
    expect(resolveEnvValues({ MISSING: 'env:MCP_STATION_MISSING' }, {})).toEqual({})
  })
})

describe('probeStdio', () => {
  it('initializes and lists tools', async () => {
    const outcome = await probeStdio({ command: process.execPath, args: [FIXTURE], timeoutMs: 10_000 })
    expect(outcome.ok).toBe(true)
    expect(outcome.serverInfo).toEqual({ name: 'fake-mcp', version: '1.2.3' })
    expect(outcome.tools.map((tool) => tool.name)).toEqual(['echo', 'add', 'read_env', 'write_file', 'fail'])
    expect(outcome.tools.find((tool) => tool.name === 'write_file')?.dangerous).toBe(true)
    expect(outcome.tools.find((tool) => tool.name === 'echo')?.dangerous).toBeUndefined()
    expect(outcome.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('times out and kills a hanging server', async () => {
    const started = Date.now()
    const outcome = await probeStdio({
      command: process.execPath,
      args: [FIXTURE, '--hang'],
      timeoutMs: 700,
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('超时')
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('reports a spawn failure', async () => {
    const outcome = await probeStdio({ command: '/nonexistent-mcp-station-binary', timeoutMs: 3000 })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBeTruthy()
  })
})

describe('callStdioTool', () => {
  it('calls a tool and returns its text', async () => {
    const result = await callStdioTool({
      command: process.execPath,
      args: [FIXTURE],
      tool: 'echo',
      toolArgs: { text: 'hi' },
      timeoutMs: 10_000,
    })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('echo:hi')
  })

  it('surfaces isError results', async () => {
    const result = await callStdioTool({ command: process.execPath, args: [FIXTURE], tool: 'fail', timeoutMs: 10_000 })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom')
  })

  it('passes explicit env but never leaks scrubbed parent names', async () => {
    const previousToken = process.env.MCP_STATION_PARENT_TOKEN
    const previousDsh = process.env.DSH_MCP_STATION_TEST
    process.env.MCP_STATION_PARENT_TOKEN = 'parent-secret'
    process.env.DSH_MCP_STATION_TEST = 'dsh-secret'
    try {
      const read = (key: string, env?: Record<string, string>) =>
        callStdioTool({
          command: process.execPath,
          args: [FIXTURE],
          tool: 'read_env',
          toolArgs: { key },
          ...(env === undefined ? {} : { env }),
          timeoutMs: 10_000,
        })
      expect((await read('MCP_STATION_PARENT_TOKEN')).text).toBe('')
      expect((await read('DSH_MCP_STATION_TEST')).text).toBe('')
      expect((await read('MCP_STATION_TEST', { MCP_STATION_TEST: 'explicit-ok' })).text).toBe('explicit-ok')
      expect((await read('MCP_STATION_PARENT_TOKEN', { MCP_STATION_PARENT_TOKEN: 'explicit-secret' })).text).toBe(
        'explicit-secret',
      )
    } finally {
      if (previousToken === undefined) delete process.env.MCP_STATION_PARENT_TOKEN
      else process.env.MCP_STATION_PARENT_TOKEN = previousToken
      if (previousDsh === undefined) delete process.env.DSH_MCP_STATION_TEST
      else process.env.DSH_MCP_STATION_TEST = previousDsh
    }
  })
})

describe('probeHttp', () => {
  let server: ReturnType<typeof createServer>
  let url = ''

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(body) as Record<string, unknown>
        } catch {
          res.writeHead(400)
          res.end()
          return
        }
        const reply = (result: unknown): void => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
        }
        if (message.method === 'initialize') {
          reply({
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'http-fake', version: '0.1.0' },
          })
          return
        }
        if (message.method === 'notifications/initialized') {
          res.writeHead(202)
          res.end()
          return
        }
        if (message.method === 'tools/list') {
          reply({ tools: [{ name: 'search', description: 'Search the web' }] })
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    url = 'http://127.0.0.1:' + String(address.port) + '/mcp'
  })

  afterAll(async () => {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  it('initializes and lists tools over JSON responses', async () => {
    const outcome = await probeHttp({ url, timeoutMs: 5000 })
    expect(outcome.ok).toBe(true)
    expect(outcome.tools.map((tool) => tool.name)).toEqual(['search'])
    expect(outcome.serverInfo).toEqual({ name: 'http-fake', version: '0.1.0' })
  })

  it('reports an invalid URL', async () => {
    const outcome = await probeHttp({ url: 'not a url', timeoutMs: 1000 })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBeTruthy()
  })
})
