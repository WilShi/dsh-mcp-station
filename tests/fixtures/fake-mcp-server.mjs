// Minimal newline-delimited JSON-RPC MCP server used by probe tests.
// It implements initialize / notifications/initialized / tools/list /
// tools/call for a few deterministic tools. Pass --hang to never answer
// (timeout tests); pass --stderr to emit a diagnostic line on stderr.
import process from 'node:process'

const hang = process.argv.includes('--hang')
const noisy = process.argv.includes('--stderr')

if (noisy) process.stderr.write('fake-mcp-server ready\n')

const tools = [
  { name: 'echo', description: 'Echo the given text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
  { name: 'read_env', description: 'Read one environment variable', inputSchema: { type: 'object', properties: { key: { type: 'string' } } } },
  { name: 'write_file', description: 'Pretend to write a file' },
  { name: 'fail', description: 'Always fails with isError' },
]

let buffer = ''

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function callTool(id, params) {
  const name = params !== null && typeof params === 'object' ? params.name : undefined
  const args = params !== null && typeof params === 'object' && params.arguments !== null && typeof params.arguments === 'object' ? params.arguments : {}
  if (name === 'echo') {
    respond(id, { content: [{ type: 'text', text: 'echo:' + String(args.text ?? '') }] })
    return
  }
  if (name === 'add') {
    respond(id, { content: [{ type: 'text', text: String(Number(args.a ?? 0) + Number(args.b ?? 0)) }] })
    return
  }
  if (name === 'read_env') {
    const key = String(args.key ?? '')
    respond(id, { content: [{ type: 'text', text: process.env[key] ?? '' }] })
    return
  }
  if (name === 'write_file') {
    respond(id, { content: [{ type: 'text', text: 'written' }] })
    return
  }
  if (name === 'fail') {
    respond(id, { isError: true, content: [{ type: 'text', text: 'boom' }] })
    return
  }
  rpcError(id, -32602, 'unknown tool: ' + String(name))
}

function dispatch(message) {
  if (hang) return
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return
  if (message.method === 'initialize') {
    respond(message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'fake-mcp', version: '1.2.3' },
      instructions: 'fake server for tests',
    })
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'tools/list') {
    respond(message.id, { tools })
    return
  }
  if (message.method === 'tools/call') {
    callTool(message.id, message.params)
    return
  }
  if (message.id !== undefined) rpcError(message.id, -32601, 'Method not found')
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  for (;;) {
    const index = buffer.indexOf('\n')
    if (index < 0) break
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    dispatch(message)
  }
})

if (hang) {
  setInterval(() => {}, 1000)
}
