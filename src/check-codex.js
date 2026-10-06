// Real MCP + a deterministic app-server peer; --live uses Codex and Playwright.
const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { spawn } = require('child_process')

function mockAgent() {
  let serial = 0, active
  const send = (msg) => console.log(JSON.stringify(msg))
  const notify = (method, params) => send({ method, params })
  const finish = (text) => {
    const turn = active
    notify('item/completed', { threadId: turn.threadId, turnId: turn.id, item: { type: 'agentMessage', phase: 'final_answer', text } })
    // Follow-up input can arrive between the final message and completion.
    setTimeout(() => notify('turn/completed', { threadId: turn.threadId, turn: { id: turn.id, status: 'completed' } }), 100)
    active = null
  }
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line), p = m.params || {}
    fs.appendFileSync(process.env.BRIDGE_TEST_LOG, JSON.stringify(m) + '\n')
    if (m.id === 'form') { finish('FORM_READY'); return }
    if (m.id === 'approval') { finish('DECISION_' + m.result.decision); return }
    if (!m.id) return
    if (m.method === 'initialize' || m.method === 'turn/interrupt') send({ id: m.id, result: {} })
    else if (m.method === 'thread/start' || m.method === 'thread/resume') send({ id: m.id, result: { thread: { id: p.threadId || 'thread-' + ++serial } } })
    else if (m.method === 'turn/start') {
      active = { id: 'turn-' + ++serial, threadId: p.threadId }
      notify('turn/started', { threadId: p.threadId, turn: { id: active.id } })
      send({ id: m.id, result: { turn: { id: active.id } } })
      const text = p.input[0].text
      if (text.includes('FORM_TEST')) send({ id: 'form', method: 'item/tool/call', params: { threadId: p.threadId, turnId: active.id, tool: 'lia_chat', arguments: { markdown: 'FORM_TEST', inputs: [{ id: 'choice', type: 'buttons', options: ['Proceed'] }] } } })
      else if (text.includes('APPROVAL_TEST')) send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: p.threadId, turnId: active.id, command: 'echo test' } })
      else if (!text.includes('HOLD_TEST')) finish('ACK ' + text)
    } else if (m.method === 'turn/steer') {
      assert.strictEqual(p.expectedTurnId, active.id)
      send({ id: m.id, result: { turnId: active.id } })
      finish('STEER ' + p.input[0].text)
    }
  })
}

async function check() {
  const live = process.argv.includes('--live')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'liascript-codex-check-'))
  fs.writeFileSync(path.join(root, 'README.md'), '# Bridge Test\n\n## Browser und Terminal\n\nLive-Test der Codex-Bridge.\n')
  const logFile = path.join(root, 'rpc.jsonl')
  const mock = path.join(root, 'mock-codex')
  fs.writeFileSync(mock, '#!' + process.execPath + '\nrequire(' + JSON.stringify(__filename) + ').mockAgent()\n', { mode: 0o700 })
  const port = live ? 3968 : 3969
  const origin = 'http://127.0.0.1:' + port
  let child, browser, sse, output = '', wire = ''
  const wait = async (condition, label, ms = live ? 90000 : 10000) => {
    const limit = Date.now() + ms
    while (!condition()) {
      if (Date.now() > limit) throw new Error('Timed out: ' + label)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  const start = async () => {
    output = ''
    child = spawn(process.execPath, [path.join(__dirname, '../dist/codex-bridge.js'), ...(live ? [] : ['--codex', mock]), '--', '-p', String(port), '-i', path.join(root, 'README.md')], { cwd: root, env: { ...process.env, BRIDGE_TEST_LOG: logFile }, stdio: ['pipe', 'pipe', 'pipe'] })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += chunk; if (live) process.stdout.write(chunk) })
    await wait(() => output.includes('Bridge ready:') || child.exitCode !== null, 'bridge startup')
    assert.strictEqual(child.exitCode, null, output)
  }
  const quit = async () => {
    if (sse) { sse.destroy(); sse = null }
    child.stdin.write('/quit\n')
    await wait(() => child.exitCode !== null || child.signalCode !== null, 'bridge shutdown', 10000)
  }
  const post = (body) => new Promise((resolve, reject) => {
    const req = http.request(origin + '/agent', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' } }, (res) => {
      res.resume(); res.on('end', () => { assert.strictEqual(res.statusCode, 204); resolve() })
    })
    req.on('error', reject); req.end(JSON.stringify(body))
  })
  const history = () => {
    const dir = path.join(root, '.chats')
    return fs.readdirSync(dir).filter((f) => !f.startsWith('.') && f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f))))
  }
  const has = (text) => history().some((s) => s.entries.some((e) => e.type === 'ai' && e.markdown.includes(text)))
  const messages = () => fs.readFileSync(logFile, 'utf8').trim().split('\n').map(JSON.parse)
  try {
    await start()
    let page
    if (live) {
      const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
      browser = await chromium.launch({ headless: !!process.env.HEADLESS, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) })
      page = await browser.newPage()
      await page.goto(origin + '/liascript/chat.html?' + origin + '/README.md')
      await page.locator('#chat').evaluate((el) => { el.open = true })
    } else {
      sse = http.get(origin + '/gotoLine?chat', (res) => res.on('data', (chunk) => { wire += chunk }))
      await wait(() => wire.includes('session'), 'browser connection')
    }
    const say = async (text) => {
      if (!live) return post({ type: 'chat', params: { text } })
      await page.locator('#say textarea').fill(text)
      await page.locator('#say button').click()
    }
    await say(live ? 'Merke dir den Testcode HAMBURG_7391. Antworte ausschließlich mit BRIDGE_BROWSER_OK.' : 'BROWSER_TEST')
    await wait(() => has(live ? 'BRIDGE_BROWSER_OK' : 'BROWSER_TEST'), 'browser reply')
    console.log('ok: browser input wakes idle Codex')
    child.stdin.write((live ? 'Antworte ausschließlich mit BRIDGE_TERMINAL_OK.' : 'TERMINAL_TEST') + '\n')
    await wait(() => has(live ? 'BRIDGE_TERMINAL_OK' : 'TERMINAL_TEST'), 'terminal reply')
    console.log('ok: terminal and browser share the thread')

    const previousTurns = (output.match(/Codex turn:/g) || []).length
    child.stdin.write((live ? 'Führe im Terminal sleep 8 aus. Antworte danach ausschließlich mit BEFORE_STEER.' : 'HOLD_TEST') + '\n')
    await wait(() => (output.match(/Codex turn:/g) || []).length > previousTurns, 'active turn')
    await new Promise((resolve) => setTimeout(resolve, live ? 2000 : 100))
    await say(live ? 'Korrektur: Antworte am Ende ausschließlich mit BRIDGE_STEER_OK.' : 'STEER_TEST')
    await wait(() => output.includes('Codex steering:') && has(live ? 'BRIDGE_STEER_OK' : 'STEER_TEST'), 'steering')
    console.log('ok: browser steers a running terminal turn')

    await say(live ? 'Rufe lia_chat auf mit markdown FORM_TEST und inputs [{"id":"choice","type":"buttons","options":["Proceed"]}]. Danach antworte ausschließlich FORM_READY. Warte nicht auf die Antwort. Wenn das answer-Event mit choice Proceed kommt, antworte ausschließlich BRIDGE_FORM_ANSWER.' : 'FORM_TEST')
    await wait(() => has('FORM_READY'), 'nonblocking form')
    if (live) await page.getByRole('button', { name: 'Proceed', exact: true }).last().click()
    else {
      const entry = history()[0].entries.filter((e) => e.inputs).pop()
      await post({ type: 'answer', params: { ask: entry.ask, choice: 'Proceed' } })
    }
    if (live) await wait(() => has('BRIDGE_FORM_ANSWER'), 'form answer turn')
    else await wait(() => has('"choice":"Proceed"'), 'form answer turn')
    console.log('ok: form posts immediately; answer returns as an event')
    if (!live) {
      await say('APPROVAL_TEST')
      await wait(() => output.includes('Codex request approval'), 'approval request')
      assert.ok(!messages().some((m) => m.id === 'approval' && m.result), 'browser cannot approve')
      child.stdin.write('/approve approval no\n')
      await wait(() => has('DECISION_decline'), 'terminal approval')
      console.log('ok: approvals stay in the trusted terminal')
    }
    const mapping = JSON.parse(fs.readFileSync(path.join(root, '.chats/.codex-threads.json')))
    const firstSession = Object.keys(mapping)[0]
    if (live) await page.screenshot({ path: path.join(root, 'browser.png') })
    await quit()
    await start()
    if (live) await page.reload()
    else { wire = ''; sse = http.get(origin + '/gotoLine?chat', (res) => res.on('data', (chunk) => { wire += chunk })); await wait(() => wire.includes('session'), 'reconnect') }
    await say(live ? 'Wie lautet der gemerkte Testcode? Antworte ausschließlich mit dem Code.' : 'RESTART_TEST')
    await wait(() => has(live ? 'HAMBURG_7391' : 'RESTART_TEST'), 'resumed conversation')
    const after = JSON.parse(fs.readFileSync(path.join(root, '.chats/.codex-threads.json')))
    assert.strictEqual(after[firstSession], mapping[firstSession])
    console.log('ok: restart resumes the saved Codex thread')
    if (live) await page.screenshot({ path: path.join(root, 'resumed.png') })
    else {
      await post({ type: 'session', params: {} })
      await say('NEW_SESSION_TEST')
      await wait(() => has('NEW_SESSION_TEST'), 'new session')
      await post({ type: 'session', params: { id: firstSession } })
      await say('OLD_SESSION_TEST')
      await wait(() => has('OLD_SESSION_TEST'), 'old session')
      const starts = messages().filter((m) => m.method === 'turn/start')
      assert.strictEqual(starts[starts.length - 1].params.threadId, mapping[firstSession])
      console.log('ok: session switch returns to its own thread')
    }
    console.log('Artifacts:', root)
  } catch (e) { console.error(output); throw e }
  finally {
    if (browser) await browser.close()
    if (child && child.exitCode === null) await quit().catch(() => child.kill())
  }
}

if (require.main === module) check().catch((e) => { console.error(e); process.exitCode = 1 })
module.exports = { mockAgent }
