// A stand-in ACP agent for the --users part of check.js: answers initialize
// and session/new, and on the chat "hi" of check.js (not on the first prompt:
// the greeting of a new chat may come first) does what the gateway has to
// notice: asks to run a command (the class server refuses), reports a
// refusal of its own through the report_refusal tool of the liascript MCP
// server, and reports what it cost (0.5, then 0.8 in all).
const readline = require('readline')

let id = 0
let mcp = null
let prompted = false
const waiting = new Map()
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
const ask = (method, params) => new Promise((resolve) => (waiting.set(++id, resolve), send({ id, method, params })))

async function tool(name, args) {
  const r = await fetch(mcp, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  return r.json()
}

async function prompt(sessionId, text) {
  if (prompted || !text.includes('"text":"hi"')) return
  prompted = true
  await ask('session/request_permission', {
    sessionId,
    toolCall: { title: 'Bash: cat /etc/passwd', kind: 'execute' },
    options: [
      { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
    ],
  })
  await tool('report_refusal', { what: 'read /etc/passwd', reason: 'outside the course' })
  for (const amount of [0.5, 0.8]) send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'usage_update', cost: { amount, currency: 'USD' } } } })
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const msg = JSON.parse(line)
  if (!msg.method) return waiting.get(msg.id)?.(msg.result)
  if (msg.method === 'initialize') send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  else if (msg.method === 'session/new' || msg.method === 'session/load') {
    mcp = msg.params.mcpServers[0].url
    send({ id: msg.id, result: msg.method === 'session/new' ? { sessionId: 's1' } : {} })
  } else if (msg.method === 'session/prompt') {
    await prompt(msg.params.sessionId, (msg.params.prompt || []).map((p) => p.text || '').join('\n'))
    send({ id: msg.id, result: { stopReason: 'end_turn' } })
  } else if (msg.id !== undefined) send({ id: msg.id, result: {} })
})
