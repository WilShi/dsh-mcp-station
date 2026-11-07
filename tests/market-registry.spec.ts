import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mapRegistryResponse, RegistryClient } from '../src/market-registry.ts'

interface RecordedRequest {
  search: string
  cursor: string
  limit: string
  version: string
}

const PAGE_ONE = {
  servers: [
    {
      server: {
        name: 'io.github.acme/weather',
        title: 'Weather MCP',
        description: 'Weather tools for agents',
        repository: { url: 'https://github.com/acme/weather', source: 'github' },
        packages: [
          {
            registryType: 'npm',
            identifier: '@acme/weather-mcp',
            version: '1.2.0',
            runtimeHint: 'npx',
            transport: { type: 'stdio' },
            runtimeArguments: [
              { type: 'positional', value: '-y' },
              { type: 'positional', value: '--verbose' },
            ],
            environmentVariables: [
              { name: 'WEATHER_API_KEY', description: 'API key', isSecret: true, isRequired: true },
              { name: 'LANG', description: 'Language', isRequired: false },
            ],
          },
        ],
      },
    },
    {
      server: {
        name: 'io.github.acme/remote',
        description: 'Remote MCP',
        remotes: [
          {
            type: 'streamable-http',
            url: 'https://remote.example/mcp',
            headers: [
              { name: 'Authorization', value: 'env:TOKEN' },
              { name: 'X-Static', value: 'v1' },
            ],
          },
        ],
      },
    },
    {
      server: {
        name: 'io.github.acme/docker',
        packages: [{ registryType: 'docker', identifier: 'acme/docker', transport: { type: 'stdio' } }],
      },
    },
    {
      server: {
        name: 'io.github.acme/sse',
        remotes: [{ type: 'sse', url: 'https://sse.example/mcp' }],
      },
    },
    {
      server: {
        name: 'io.github.acme/no-transport',
        packages: [{ registryType: 'npm', identifier: 'not-installable' }],
      },
    },
    {
      server: {
        name: 'io.github.other/weather',
        packages: [{ registryType: 'npm', identifier: '@other/weather', transport: { type: 'stdio' } }],
      },
    },
  ],
  metadata: { nextCursor: 'cursor-2', count: 6 },
}

const PAGE_TWO = {
  servers: [
    {
      server: {
        name: 'io.github.acme/page-two',
        description: 'Second page',
        packages: [{ registryType: 'npm', identifier: '@acme/page-two', transport: { type: 'stdio' } }],
      },
    },
  ],
  metadata: { count: 1 },
}

const requests: RecordedRequest[] = []
let server: ReturnType<typeof createServer>
let baseUrl = ''
let pageOne: unknown = PAGE_ONE
const timers = new Set<NodeJS.Timeout>()

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const search = url.searchParams.get('search') ?? ''
    requests.push({
      search,
      cursor: url.searchParams.get('cursor') ?? '',
      limit: url.searchParams.get('limit') ?? '',
      version: url.searchParams.get('version') ?? '',
    })
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (search === 'fail') {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('boom')
      return
    }
    if (search === 'badjson') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{nope')
      return
    }
    if (search === 'slow') {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!res.writableEnded) send(200, PAGE_ONE)
      }, 500)
      timers.add(timer)
      return
    }
    if (url.searchParams.get('cursor') === 'cursor-2') {
      send(200, PAGE_TWO)
      return
    }
    send(200, pageOne)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = 'http://127.0.0.1:' + String(address.port) + '/v0/servers'
})

afterAll(async () => {
  for (const timer of timers) clearTimeout(timer)
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
})

describe('RegistryClient mapping', () => {
  it('maps npm stdio packages and streamable-http remotes', async () => {
    const client = new RegistryClient({ baseUrl, now: () => 1000 })
    requests.length = 0
    const page = await client.fetchPage({ search: 'weather', limit: 10 })
    expect(page.items).toHaveLength(3)
    expect(page.nextCursor).toBe('cursor-2')
    expect(page.totalCount).toBe(6)
    const weather = page.items[0]!
    expect(weather.id).toBe('io.github.acme-weather')
    expect(weather.serverName).toBe('weather')
    expect(weather.transport).toBe('stdio')
    expect(weather.command).toBe('npx')
    expect(weather.args).toEqual(['-y', '--verbose', '@acme/weather-mcp'])
    expect(weather.displayName).toEqual({ zh: 'Weather MCP', en: 'Weather MCP' })
    expect(weather.description.en).toBe('Weather tools for agents')
    expect(weather.description.zh).toBe('Weather tools for agents')
    expect(weather.docs).toBe('https://github.com/acme/weather')
    expect(weather.risk?.level).toBe('medium')
    expect(weather.risk?.reasons[0]?.zh).toContain('官方注册表')
    expect(weather.inputs).toEqual([
      {
        key: 'WEATHER_API_KEY',
        label: { zh: 'WEATHER_API_KEY', en: 'WEATHER_API_KEY' },
        description: { zh: 'API key', en: 'API key' },
        kind: 'secret',
        required: true,
      },
      {
        key: 'LANG',
        label: { zh: 'LANG', en: 'LANG' },
        description: { zh: 'Language', en: 'Language' },
        kind: 'text',
      },
    ])
    expect(weather.env).toEqual({ WEATHER_API_KEY: '{{WEATHER_API_KEY}}', LANG: '{{LANG}}' })
    const remote = page.items[1]!
    expect(remote.transport).toBe('streamable-http')
    expect(remote.url).toBe('https://remote.example/mcp')
    expect(remote.headers).toEqual({ Authorization: 'env:TOKEN', 'X-Static': 'v1' })
    expect(page.items.map((item) => item.serverName)).toEqual(['weather', 'remote', 'weather-2'])
    expect(requests[0]!.search).toBe('weather')
    expect(requests[0]!.limit).toBe('10')
    expect(requests[0]!.version).toBe('latest')
  })

  it('finds a mapped preset by sanitized id through the registry-name index', async () => {
    const first = new RegistryClient({ baseUrl, now: () => 2000 })
    const page = await first.fetchPage({ search: 'weather', limit: 10 })
    const id = page.items[0]!.id
    requests.length = 0
    const second = new RegistryClient({ baseUrl, now: () => 2000 })
    const found = await second.findPreset(id)
    expect(found?.id).toBe(id)
    expect(found?.serverName).toBe('weather')
    expect(requests.some((request) => request.search === 'io.github.acme/weather')).toBe(true)
  })
  it('caches identical queries for five minutes', async () => {
    let clock = 1000
    const client = new RegistryClient({ baseUrl, now: () => clock })
    requests.length = 0
    const first = await client.fetchPage({ limit: 5 })
    expect(requests).toHaveLength(1)
    const second = await client.fetchPage({ limit: 5 })
    expect(requests).toHaveLength(1)
    expect(second).toBe(first)
    clock += 4 * 60 * 1000
    await client.fetchPage({ limit: 5 })
    expect(requests).toHaveLength(1)
    clock += 2 * 60 * 1000
    await client.fetchPage({ limit: 5 })
    expect(requests).toHaveLength(2)
  })

  it('passes the cursor through and maps the second page', async () => {
    const client = new RegistryClient({ baseUrl, now: () => 1000 })
    requests.length = 0
    const page = await client.fetchPage({ cursor: 'cursor-2', limit: 5 })
    expect(requests[0]!.cursor).toBe('cursor-2')
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.serverName).toBe('page-two')
    expect(page.nextCursor).toBeUndefined()
  })

  it('finds a cached preset without another request', async () => {
    const client = new RegistryClient({ baseUrl, now: () => 1000 })
    requests.length = 0
    await client.fetchPage({ limit: 5 })
    const requestCount = requests.length
    const preset = await client.findPreset('io.github.acme-weather')
    expect(preset?.serverName).toBe('weather')
    expect(requests).toHaveLength(requestCount)
    const missing = await client.findPreset('does-not-exist')
    expect(missing).toBeUndefined()
    expect(requests.length).toBeGreaterThan(requestCount)
  })
})

describe('mapRegistryResponse', () => {
  it('skips unsupported entries and tolerates missing metadata', () => {
    const page = mapRegistryResponse({
      servers: [
        { server: { name: 'io.github.x/unmapped', packages: [{ registryType: 'oci', identifier: 'x', transport: { type: 'stdio' } }] } },
        { server: { name: 'io.github.x/sse', remotes: [{ type: 'sse', url: 'https://x/sse' }] } },
        { server: { name: 'io.github.x/npm', packages: [{ registryType: 'npm', identifier: 'x-mcp', transport: { type: 'stdio' } }] } },
      ],
    })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.serverName).toBe('npm')
    expect(page.nextCursor).toBeUndefined()
  })


  it('prefers the latest active version per registry name', () => {
    const official = 'io.modelcontextprotocol.registry/official'
    const page = mapRegistryResponse({
      servers: [
        {
          server: {
            name: 'io.github.x/dup',
            title: 'Old',
            packages: [{ registryType: 'npm', identifier: 'dup-old', transport: { type: 'stdio' } }],
          },
          _meta: { [official]: { status: 'active', isLatest: false } },
        },
        {
          server: {
            name: 'io.github.x/dup',
            title: 'New',
            packages: [{ registryType: 'npm', identifier: 'dup-new', transport: { type: 'stdio' } }],
          },
          _meta: { [official]: { status: 'active', isLatest: true } },
        },
        {
          server: {
            name: 'io.github.x/hidden',
            packages: [{ registryType: 'npm', identifier: 'hidden', transport: { type: 'stdio' } }],
          },
          _meta: { [official]: { status: 'deleted' } },
        },
      ],
    })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.displayName.en).toBe('New')
    expect(page.items[0]!.args).toEqual(['dup-new'])
  })

  it('maps named runtime arguments and required remote headers', () => {
    const page = mapRegistryResponse({
      servers: [
        {
          server: {
            name: 'io.github.x/named',
            packages: [
              {
                registryType: 'npm',
                identifier: 'named-mcp',
                transport: { type: 'stdio' },
                runtimeArguments: [
                  {
                    type: 'named',
                    name: '-e',
                    value: 'TOKEN={token}',
                    variables: { token: { isRequired: true, isSecret: true } },
                  },
                ],
                environmentVariables: [{ name: 'TOKEN', isSecret: true, isRequired: true }],
              },
            ],
          },
        },
        {
          server: {
            name: 'io.github.x/remote-auth',
            remotes: [
              {
                type: 'streamable-http',
                url: 'https://x.example/mcp',
                headers: [{ name: 'Authorization', isSecret: true, isRequired: true }],
              },
            ],
          },
        },
      ],
    })
    const named = page.items[0]!
    expect(named.args).toEqual(['-e', 'TOKEN={{token}}', 'named-mcp'])
    expect(named.inputs?.some((input) => input.key === 'token' && input.kind === 'secret' && input.required === true)).toBe(
      true,
    )
    const remote = page.items[1]!
    expect(remote.headers).toEqual({ Authorization: '{{AUTHORIZATION}}' })
    expect(remote.inputs?.[0]).toMatchObject({
      key: 'AUTHORIZATION',
      kind: 'secret',
      required: true,
    })
  })

  it('rejects non-object payloads', () => {
    expect(() => mapRegistryResponse('nope')).toThrow()
    expect(() => mapRegistryResponse(null)).toThrow()
  })
})

describe('RegistryClient failures', () => {
  it('times out and records the last error', async () => {
    const client = new RegistryClient({ baseUrl, now: () => 1000, timeoutMs: 100 })
    await expect(client.fetchPage({ search: 'slow', limit: 5 })).rejects.toThrow(/超时/)
    expect(client.lastError).toContain('超时')
  })

  it('rejects bad JSON and HTTP errors', async () => {
    const client = new RegistryClient({ baseUrl, now: () => 1000, timeoutMs: 1000 })
    await expect(client.fetchPage({ search: 'badjson', limit: 5 })).rejects.toThrow(/JSON/)
    expect(client.lastError).toContain('JSON')
    await expect(client.fetchPage({ search: 'fail', limit: 5 })).rejects.toThrow(/HTTP 500/)
    expect(client.lastError).toContain('HTTP 500')
  })
})
