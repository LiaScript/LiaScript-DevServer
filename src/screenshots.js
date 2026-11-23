// Screenshots of the chat for the README: `npm run build`, then `node src/screenshots.js`.
// Starts the built server with --mcp in a temporary project, speaks JSON-RPC
// to it like src/check.js and shoots headless Chromium (no window opens; the
// browser is connected before the first chat call, so the server opens none).
// Playwright comes from PLAYWRIGHT_MODULE_PATH, else the `playwright` package;
// PLAYWRIGHT_CHROMIUM_PATH names a Chromium if its own is missing.
// Writes pics/chat/*.png.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'pics/chat')
const PORT = 3998
const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'liascript-shots-'))

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(
  path.join(PROJECT, 'README.md'),
  `<!--
author: Ada Example
language: en
-->

# Photosynthesis

Plants turn light, water and carbon dioxide into sugar and oxygen.

## The equation

$$6\\,CO_2 + 6\\,H_2O \\rightarrow C_6H_{12}O_6 + 6\\,O_2$$

[Explain this simpler](agent:tutor/explain?level=easy)

## Quiz

Where does photosynthesis happen?

- [( )] in the mitochondria
- [(X)] in the chloroplasts
- [( )] in the nucleus
`,
)
fs.writeFileSync(path.join(PROJECT, 'other.md'), '# Another course\n\nA second file of the project.\n')

// a HOME of its own: --share keeps its room in ~/.config/liascript
const child = spawn(process.execPath, [path.join(ROOT, 'dist/index.js'), '--mcp', '-p', PORT, '-i', 'README.md'], {
  cwd: PROJECT,
  env: { ...process.env, HOME: PROJECT, USERPROFILE: PROJECT },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let stderr = ''
child.stderr.on('data', (c) => (stderr += c))

const pending = new Map()
let buffer = ''
let nextId = 1
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (pending.has(msg.id)) pending.get(msg.id)(msg), pending.delete(msg.id)
  }
})

function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer to ' + method)), 30000)
    pending.set(id, (msg) => (clearTimeout(timer), resolve(msg)))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

async function tool(name, args) {
  const { result } = await rpc('tools/call', { name, arguments: args })
  const text = result.content[0].text
  if (result.isError) throw new Error(name + ': ' + text)
  return JSON.parse(text)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// the browser has voices, as most have: the read-aloud buttons and the box show
const VOICES = () => {
  const voice = { name: 'English (demo)', lang: 'en-US', localService: true, default: true, voiceURI: 'demo' }
  speechSynthesis.getVoices = () => [voice]
}

// numbered badges at the controls, for the overview
async function mark(page, marks) {
  await page.evaluate((marks) => {
    marks.forEach(([n, selector, at]) => {
      const el = document.querySelector(selector)
      if (!el || !el.getClientRects().length) return
      const r = el.getBoundingClientRect()
      // a small control: its top right corner; a wide one: inside its right end; c: next to its middle
      at = at || (r.width < 60 ? 'corner' : 'end')
      const x = at == 'c' ? r.left + r.width / 2 + 24 : at == 'end' ? r.right - 30 : r.right - 13
      const y = at == 'end' ? r.top + r.height / 2 - 11 : r.top - 9
      const b = document.createElement('div')
      b.className = 'shot-mark'
      b.textContent = n
      b.style.cssText =
        'position:fixed;z-index:99999;width:22px;height:22px;border-radius:50%;background:#e11d48;color:#fff;' +
        'font:700 12px/22px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff;pointer-events:none;' +
        'left:' + Math.min(innerWidth - 24, x) + 'px;top:' + Math.max(0, y) + 'px'
      document.body.append(b)
    })
  }, marks)
}
const unmark = (page) => page.evaluate(() => document.querySelectorAll('.shot-mark').forEach((m) => m.remove()))

async function shoot(target, name) {
  await sleep(600)
  await target.screenshot({ path: path.join(OUT, name + '.png') })
  console.log('📸 pics/chat/' + name + '.png')
}

async function main() {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  let state
  for (let i = 0; i < 60 && !(state && state.url); i++) {
    await sleep(250)
    state = await tool('get_state', {}).catch(() => null)
  }

  const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  await context.addInitScript(VOICES)
  const page = await context.newPage()
  await page.goto(state.url)
  await page.waitForSelector('#who')
  await sleep(2500)

  await tool('set_agent', {
    name: 'tutor',
    agents: [
      { name: 'tutor', emoji: '🧑‍🏫', label: 'Tutor' },
      { name: 'author', emoji: '✍️', label: 'Author' },
    ],
  })
  await tool('chat', { markdown: 'Hello! I am your tutor for this course. Ask me anything about **photosynthesis**.' })
  await tool('chat', {
    markdown: 'How would you like to continue?',
    inputs: [
      { id: 'next', type: 'buttons', options: ['Explain the equation', 'Give me a quiz'] },
      { id: 'level', type: 'radio', label: 'Level', options: ['easy', 'normal', 'hard'] },
      { id: 'extras', type: 'checkbox', label: 'Extras', options: ['examples', 'read aloud'] },
    ],
    wait: false,
  })
  await tool('chat', { status: 'Reading the course …' })
  await sleep(1500)

  // 1 the overview, docked (the first visit on a wide window docks)
  const MARKS = [
    [1, '#who'],
    [2, '#sessions'],
    [3, '#agents'],
    [4, '#new'],
    [5, '#autoread-box'],
    [6, '#browse'],
    [7, '#files'],
    [8, '#home'],
    [9, '#phone'],
    [10, '#dock'],
    [11, '#log'],
    [12, '#bot'],
    [13, '#status'],
    [14, '#stretch', 'c'],
    [15, '#attach'],
    [16, 'textarea[name=text]'],
    [17, '#send'],
  ]
  await mark(page, MARKS)
  await shoot(page, 'overview')
  await unmark(page)

  // the form in the message, close up
  await shoot(page.locator('#panel'), 'panel')

  // floating over the course
  await page.click('#dock')
  await shoot(page, 'floating')

  // closed: only the button with the agent
  await page.click('#who')
  await shoot(page, 'closed')
  await page.click('#who')

  // the address field of 🌐
  await page.click('#browse')
  await shoot(page.locator('#panel'), 'address')
  await page.click('#browse')

  // another file: ⌂ leads back, 📁 to the listing
  await tool('goto', { file: 'other.md' })
  await sleep(1500)
  await mark(page, [[7, '#files'], [8, '#home']])
  await shoot(page, 'home')
  await unmark(page)
  await page.click('#files')
  await shoot(page, 'listing')
  await page.click('#home')
  await sleep(1500)

  // the answered form folds to the choice
  const chatFrame = page.frameLocator('#log iframe').first()
  await chatFrame.getByText('Explain the equation').click()
  await chatFrame.getByText('easy', { exact: true }).click()
  await chatFrame.getByText('Send answer').click()
  await tool('chat', { status: '' }).catch(() => {})
  await tool('chat', { markdown: 'Here it comes: light energy splits water, the hydrogen ends up in sugar.' })
  await shoot(page.locator('#panel'), 'answered')

  // the teacher form and the learner view
  // each line is "id · name · …"
  const found = await tool('find_teacher', { topic: 'biology' })
  const pick = found.teachers.slice(0, 3).map((line) => line.split(' · ')[0])
  if (pick.length) {
    await tool('chat', { markdown: 'Who should teach you?', inputs: [{ id: 'teacher', type: 'teacher', options: pick }], wait: false })
    await shoot(page.locator('#panel'), 'teacher')
    await chatFrame.locator('.msg').last().locator('button').first().click()
    await tool('set_agent', { name: 'tutor', emoji: '🧑‍🏫', persona: pick[0] })
    await tool('chat', { markdown: 'An AI plays this role. Shall we begin with the light reactions?' })
    await shoot(page, 'learner')
    await tool('set_agent', { name: 'tutor', emoji: '🧑‍🏫', label: 'Tutor', persona: null, view: 'author' })
  } else console.error('find_teacher gave no ids, no teacher shots')

  // 📱 share: needs the signalling servers on the internet, else no shot
  try {
    await tool('share', { on: true })
    await sleep(2000)
    await shoot(page.locator('#panel'), 'share')
    await tool('share', { on: false })
  } catch (e) {
    console.error('no share shot: ' + e.message)
  }

  // a phone: course and chat take turns
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', isMobile: true, hasTouch: true })
  await phone.addInitScript(VOICES)
  const small = await phone.newPage()
  await small.goto(state.url)
  await small.waitForSelector('#switch')
  await sleep(2500)
  await tool('chat', { markdown: 'On a phone the course and the chat take turns.' })
  await shoot(small, 'phone-course')
  await small.click('#to-chat')
  await shoot(small, 'phone-chat')
  await phone.close()

  // a browser without voices: the muted speaker and its note
  const silent = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  const quiet = await silent.newPage()
  await page.close()
  await quiet.goto(state.url)
  await quiet.waitForSelector('#who')
  await sleep(4000)
  if (await quiet.isVisible('#mute')) {
    await quiet.click('#mute')
    await shoot(quiet.locator('#panel'), 'mute')
  } else console.error('no mute shot: the browser has voices')

  await browser.close()
}

main()
  .catch((e) => {
    console.error(e)
    console.error('--- stderr of the server ---\n' + stderr)
    process.exitCode = 1
  })
  .finally(() => {
    child.kill()
    fs.rmSync(PROJECT, { recursive: true, force: true })
  })
