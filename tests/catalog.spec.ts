import { describe, expect, it } from 'vitest'
import {
  findPreset,
  findPresetForServer,
  loadCatalog,
  resolvePresetRow,
  resolvePresetValues,
  resolveTemplate,
  uniqueServerName,
  unresolvedTemplateKeys,
} from '../src/catalog.ts'
import type { CatalogPreset } from '../src/shared/types.ts'

const VARS = {
  workspace: '/workspace/demo',
  dshHome: '/home/user/.dsh',
  profile: 'web',
}

function presetOf(id: string): Promise<CatalogPreset> {
  return loadCatalog().then((catalog) => {
    const preset = findPreset(catalog, id)
    if (preset === undefined) throw new Error('missing preset ' + id)
    return preset
  })
}

describe('uniqueServerName', () => {
  it('returns the base name when free', () => {
    expect(uniqueServerName('playwright', [])).toBe('playwright')
    expect(uniqueServerName('playwright', ['github'])).toBe('playwright')
  })

  it('appends numeric suffixes case-insensitively', () => {
    expect(uniqueServerName('playwright', ['playwright'])).toBe('playwright-2')
    expect(uniqueServerName('Playwright', ['playwright'])).toBe('Playwright-2')
    expect(uniqueServerName('playwright', ['playwright', 'playwright-2'])).toBe('playwright-3')
  })

  it('throws when the namespace space is exhausted', () => {
    const taken = ['x', ...Array.from({ length: 99 }, (_, index) => 'x-' + String(index + 2))]
    expect(() => uniqueServerName('x', taken)).toThrow()
  })
})

describe('resolveTemplate', () => {
  it('replaces known variables and leaves unknown ones', () => {
    expect(resolveTemplate('{{workspace}}/data', VARS)).toBe('/workspace/demo/data')
    expect(resolveTemplate('{{ dshHome }}/mcp-station/memory.json', VARS)).toBe(
      '/home/user/.dsh/mcp-station/memory.json',
    )
    expect(resolveTemplate('{{nope}}', VARS)).toBe('{{nope}}')
    expect(unresolvedTemplateKeys('{{a}} {{b}}')).toEqual(['a', 'b'])
  })
})

describe('resolvePresetValues', () => {
  it('applies defaults and resolves template variables', async () => {
    const filesystem = await presetOf('filesystem')
    const values = resolvePresetValues(filesystem, undefined, VARS)
    expect(values.workspace).toBe('/workspace/demo')
    const memory = await presetOf('memory')
    const memoryValues = resolvePresetValues(memory, undefined, VARS)
    expect(memoryValues.memoryFile).toBe('/home/user/.dsh/mcp-station-memory.json')
  })

  it('requires required inputs and validates URL inputs', async () => {
    const tavily = await presetOf('tavily')
    expect(() => resolvePresetValues(tavily, undefined, VARS)).toThrow(/缺少必填输入/)
    expect(() => resolvePresetValues(tavily, { TAVILY_API_KEY: 'tvly-demo' }, VARS)).not.toThrow()
    expect(resolvePresetValues(tavily, { TAVILY_API_KEY: 'tvly-demo' }, VARS).TAVILY_API_KEY).toBe('tvly-demo')
  })

  it('validates url input kinds', () => {
    const preset: CatalogPreset = {
      id: 'url-preset',
      serverName: 'url-preset',
      displayName: { zh: 'x', en: 'x' },
      tagline: { zh: 'x', en: 'x' },
      description: { zh: 'x', en: 'x' },
      category: 'dev',
      transport: 'streamable-http',
      url: '{{endpoint}}',
      inputs: [
        {
          key: 'endpoint',
          label: { zh: 'x', en: 'x' },
          description: { zh: 'x', en: 'x' },
          kind: 'url',
          required: true,
        },
      ],
      risk: { level: 'low', reasons: [] },
    }
    expect(() => resolvePresetValues(preset, { endpoint: 'not a url' }, VARS)).toThrow(/URL/)
    expect(resolvePresetValues(preset, { endpoint: 'https://example.com/mcp' }, VARS).endpoint).toBe(
      'https://example.com/mcp',
    )
  })
})

describe('resolvePresetRow', () => {
  it('renders playwright exactly as a stdio row', async () => {
    const playwright = await presetOf('playwright')
    const row = resolvePresetRow(playwright, undefined, VARS)
    expect(row.serverName).toBe('playwright')
    expect(row.transport).toBe('stdio')
    expect(row.command).toBe('npx')
    expect(row.args).toEqual(['-y', '@playwright/mcp@latest', '--browser', 'chrome', '--timeout-action', '15000'])
    expect(row.env).toEqual({ npm_config_cache: '/home/user/.dsh/mcp-station/npm-cache' })
    expect(row.enabled).toBe(true)
  })

  it('keeps env:NAME references and resolves literal env values', async () => {
    const github = await presetOf('github')
    const githubRow = resolvePresetRow(github, undefined, VARS)
    expect(githubRow.env).toEqual({
      GITHUB_PERSONAL_ACCESS_TOKEN: 'env:GITHUB_PERSONAL_ACCESS_TOKEN',
      npm_config_cache: '/home/user/.dsh/mcp-station/npm-cache',
    })
    const memory = await presetOf('memory')
    const memoryRow = resolvePresetRow(memory, undefined, VARS)
    expect(memoryRow.env).toEqual({
      MEMORY_FILE_PATH: '/home/user/.dsh/mcp-station-memory.json',
      npm_config_cache: '/home/user/.dsh/mcp-station/npm-cache',
    })
  })

  it('resolves {{workspace}} in filesystem args', async () => {
    const filesystem = await presetOf('filesystem')
    const row = resolvePresetRow(filesystem, { workspace: '/projects/app' }, VARS)
    expect(row.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/projects/app'])
  })


  it('resolves streamable-http preset headers with env refs and templates', () => {
    const preset: CatalogPreset = {
      id: 'remote-header-preset',
      serverName: 'remote-header-preset',
      displayName: { zh: 'x', en: 'x' },
      tagline: { zh: 'x', en: 'x' },
      description: { zh: 'x', en: 'x' },
      category: 'dev',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'env:MCP_TOKEN', 'X-Workspace': '{{workspace}}' },
      risk: { level: 'low', reasons: [] },
    }
    const row = resolvePresetRow(preset, undefined, VARS)
    expect(row.transport).toBe('streamable-http')
    expect(row.url).toBe('https://example.com/mcp')
    expect(row.headers).toEqual({ Authorization: 'env:MCP_TOKEN', 'X-Workspace': '/workspace/demo' })
  })

  it('renders a streamable-http URL with the provided secret', async () => {
    const tavily = await presetOf('tavily')
    const row = resolvePresetRow(tavily, { TAVILY_API_KEY: 'tvly-demo' }, VARS)
    expect(row.transport).toBe('streamable-http')
    expect(row.url).toBe('https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-demo')
    expect(row.command).toBeUndefined()
  })

  it('rejects unresolved template variables', () => {
    const preset: CatalogPreset = {
      id: 'broken',
      serverName: 'broken',
      displayName: { zh: 'x', en: 'x' },
      tagline: { zh: 'x', en: 'x' },
      description: { zh: 'x', en: 'x' },
      category: 'dev',
      transport: 'stdio',
      command: 'npx',
      args: ['{{missing}}'],
      risk: { level: 'low', reasons: [] },
    }
    expect(() => resolvePresetRow(preset, undefined, VARS)).toThrow(/未解析的模板变量/)
  })

  it('renders every bundled preset without unresolved templates', async () => {
    const catalog = await loadCatalog()
    for (const preset of catalog.presets) {
      const values: Record<string, string> = {}
      for (const input of preset.inputs ?? []) values[input.key] = input.kind === 'url' ? 'https://example.com/mcp' : 'demo-value'
      const row = resolvePresetRow(preset, values, VARS)
      expect(row.serverName).toBe(preset.serverName)
      expect(row.transport).toBe(preset.transport)
      expect(JSON.stringify(row)).not.toContain('{{')
    }
  })
})

describe('findPresetForServer', () => {
  it('matches exact and suffixed server names', async () => {
    const catalog = await loadCatalog()
    expect(findPresetForServer(catalog, 'playwright')?.id).toBe('playwright')
    expect(findPresetForServer(catalog, 'playwright-2')?.id).toBe('playwright')
    expect(findPresetForServer(catalog, 'unknown-server')).toBeUndefined()
  })
})
