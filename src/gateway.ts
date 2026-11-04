// --users DIR: one start for many users (see
// docs/superpowers/specs/2026-10-26-shared-devserver-webrtc-design.md). The
// share link (src/share.ts) leads to a front server here: who has no login
// gets the login page, everybody else a DevServer of their own, started on
// demand in DIR/<name> with its own agent (--agent, src/acp.ts) and stopped
// after IDLE_MS without an open tab. The admin page on localhost manages the
// users and shows who is where. The DevServer itself stays one user per
// process; this file only starts, routes and watches them.
import { execFileSync, spawn, ChildProcess } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as http from 'http'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { sameOrigin } from './lib'
import { share, otherOrigin, PAGE } from './share'
import { TEXTS, langOf } from './admin-texts'
import { LOGIN, loginHtml, shellHtml } from './login'
import type { Texts } from './admin-texts'
import { icon, FAVICON } from './icons'

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/
const ROLES = ['student', 'author']
const IDLE_MS = 15 * 60 * 1000
// wrong passwords in a row, then the name waits
const TRIES = 5
const LOCK_MS = 60 * 1000

// course: the folder of --courses it got a copy of, if any
// kit: the user has the tools of --kit (the Teaching-Agent) in their folder
// source: the folder of the course when it was given, so another course
// folder with a course of the same name never replaces the copy
type User = { salt: string; hash: string; role: string; created: string; course?: string; source?: string; kit?: boolean }
type Instance = {
  child: ChildProcess
  ready: Promise<number>
  port: number
  token: string
  open: number // requests in flight, the event stream of an open tab among them
  last: number
}

// What the admin page sets, kept in DIR/.gateway.json: a short start
// (--users DIR) takes the last one, flags given at the start win and are
// kept too. Never kept: --no-sandbox (one start without it would make every
// later one unsandboxed) and --share-new (a one-off).
export type Config = {
  courses: string // the folder whose subfolders the admin page offers as courses
  kit: string | null // the Teaching-Agent (or another set of agent instructions) for authors
  admin: number // port of the admin page
  agent: string
  models: { student?: string; author?: string } // ANTHROPIC_MODEL per role, e.g. a small one for students
  share: { on: boolean; page: string; web: string } // web '': the other loopback name of page
  lan: { on: boolean; port: number } // the front on the network of the school, without share page
  web: boolean // web pages in the chat
  idleMinutes: number
  // the admin page wants it as a cookie: the agents of authors run on this
  // machine with a network, and can forge Host and Origin
  key: string
}

export function loadConfig(dir: string, given: Partial<Config>): Config {
  const file = path.join(dir, '.gateway.json')
  let saved: Partial<Config> = {}
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {}
  const cfg: Config = {
    courses: process.cwd(),
    kit: null,
    admin: 3000,
    agent: 'claude',
    web: true,
    idleMinutes: 15,
    key: crypto.randomBytes(16).toString('hex'),
    ...saved,
    ...given,
    models: { ...saved.models, ...given.models },
    share: { on: false, page: PAGE, web: '', ...saved.share, ...given.share },
    lan: { on: false, port: 8000, ...saved.lan, ...given.lan },
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  return cfg
}

type Options = {
  dir: string
  given: Partial<Config> // the flags of this start
  sandbox: boolean // every agent in bubblewrap (src/acp.ts), off only with --no-sandbox
  fresh: boolean // --share-new: a new link, the old one stops working
}

const esc = (s: any) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';')

function hash(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 32).toString('hex')
}

function free(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer().once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

// the body of a request, at most 10000 characters
async function read(req: http.IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 10000) break
  }
  return body
}

// the body of a form or of the login
async function form(req: http.IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await read(req))
}

// The files of a course, relative paths, without what never belongs to it
const SKIP = /(^|[/\\])(\.git|\.chats|node_modules)$/
function filesOf(root: string, rel = ''): string[] {
  let out: string[] = []
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch (e) {
    return out
  }
  for (const e of entries) {
    const p = rel ? rel + '/' + e.name : e.name
    if (SKIP.test(p)) continue
    if (e.isDirectory()) out = out.concat(filesOf(root, p))
    else if (e.isFile()) out.push(p)
  }
  return out
}

// sha1 of a file, streamed (courses of gigabytes), null if it is not there
function hashOf(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha1')
    fs.createReadStream(file)
      .on('error', () => resolve(null))
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
  })
}

// what a user got last: path -> sha1. Until 2026-10-28 a full copy of the
// course (twice the disk, 3.8 GB more per user for a big one), which becomes
// its hashes on the first use.
type Manifest = { [path: string]: string }
async function manifestOf(base: string): Promise<Manifest> {
  try {
    if ((await fsp.stat(base)).isDirectory()) {
      const m: Manifest = {}
      for (const p of filesOf(base)) m[p] = (await hashOf(path.join(base, p))) as string
      await fsp.rm(base, { recursive: true, force: true })
      return m
    }
    return JSON.parse(await fsp.readFile(base, 'utf8'))
  } catch (e) {
    return {}
  }
}

// what of --kit goes into the folder of an author: the instructions of the
// agents and the specs they read; not the sample course, not .mcp.json (its
// agent gets the tools from the gateway, a DevServer of its own has no place
// in the sandbox)
const KIT = ['CLAUDE.md', 'AGENTS.md', '.codex', 'specs', '.gitignore']

// next to a file of the user: README.md -> README.update.md
const beside = (p: string) => p.replace(/(\.[^./]*)?$/, '.update$1')

// A course update for one user, file by file against the version delivered
// last (base: the hashes of it, a file outside the user's folder): what the
// user did not change gets the teacher's new version, what the user changed
// stays, and where both changed, the teacher's version goes beside it
// (beside()). Then base is the new version. Asynchronous: a course of
// gigabytes took minutes, in which the gateway answered nobody.
// only: the entries of source that count (KIT), else all of it
export async function syncCourse(source: string, base: string, work: string, only?: string[], progress?: (done: number, total: number) => void) {
  const report = { updated: [] as string[], added: [] as string[], removed: [] as string[], conflicts: [] as string[] }
  const of = (p: string) => !only || only.includes(p.split('/')[0])
  const sources = new Set(filesOf(source).filter(of))
  const was = await manifestOf(base)
  const next: Manifest = {}
  const all = [...new Set([...sources, ...Object.keys(was)])]
  const put = async (p: string, to = p) => {
    await fsp.mkdir(path.dirname(path.join(work, to)), { recursive: true })
    await fsp.copyFile(path.join(source, p), path.join(work, to))
  }
  let done = 0
  for (const p of all) {
    const w = path.join(work, p)
    if (sources.has(p)) {
      const now = (await hashOf(path.join(source, p))) as string
      next[p] = now
      if (was[p] === now) {
        // the teacher changed nothing
      } else {
        const mine = await hashOf(w)
        if (mine === null || (was[p] && mine === was[p])) await put(p), (was[p] ? report.updated : report.added).push(p)
        else if (mine !== now) await put(p, beside(p)), report.conflicts.push(p)
      }
    } else if (was[p] && (await hashOf(w)) === was[p]) {
      await fsp.rm(w)
      report.removed.push(p)
    }
    if (progress) progress(++done, all.length)
  }
  await fsp.mkdir(path.dirname(base), { recursive: true })
  await fsp.writeFile(base, JSON.stringify(next))
  return report
}

// the class channel: the teacher, everybody
const TEACHER = '@teacher'
const ALL = '@all'
type Message = { t: string; from: string; to: string; text: string }

// the subfolders of --courses with a Markdown file, the courses to copy
// A folder the admin page may choose: below the home of the teacher, after
// every symlink; the real path, or null
function inHome(p: string): string | null {
  try {
    const real = fs.realpathSync(path.resolve(p))
    const rel = path.relative(fs.realpathSync(os.homedir()), real)
    return rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel) && fs.statSync(real).isDirectory() ? real : null
  } catch (e) {
    return null
  }
}
const MODELS = ['haiku', 'sonnet', 'opus']
// the files of the admin page (views/admin, shipped like every view)
const ADMIN_VIEWS = path.join(__dirname, '..', 'views', 'admin')
const STATIC: { [file: string]: string } = { 'admin.css': 'text/css; charset=utf-8', 'admin.js': 'text/javascript; charset=utf-8', 'geist.woff2': 'font/woff2', 'geist-mono.woff2': 'font/woff2' }
const qrcode = require('qrcode-generator')
// a QR code as SVG, for the phone of a student
function qr(text: string): string {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  return code.createSvgTag({ cellSize: 2, margin: 2, scalable: true })
}

function courseList(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .filter((d) => fs.readdirSync(path.join(root, d.name)).some((f) => /\.md$/i.test(f)))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
  } catch (e) {
    return []
  }
}

export async function gateway(o: Options) {
  const dir = path.resolve(o.dir)
  const cfg = loadConfig(dir, o.given)
  const saveConfig = () => fs.writeFileSync(path.join(dir, '.gateway.json'), JSON.stringify(cfg, null, 2), { mode: 0o600 })
  const file = path.join(dir, 'users.json')
  let users: { [name: string]: User } = {}
  try {
    users = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {}
  const save = () => fs.writeFileSync(file, JSON.stringify(users, null, 2), { mode: 0o600 })
  // users of an older version know only the name of their course
  let named = false
  for (const u of Object.values(users))
    if (u.course && !u.source && fs.existsSync(path.join(cfg.courses, u.course))) (u.source = path.join(cfg.courses, u.course)), (named = true)
  if (named) save()
  const hasCourse = (name: string) => !!users[name].source && fs.existsSync(users[name].source as string)

  if (o.sandbox) {
    try {
      execFileSync('bwrap', ['--version'])
    } catch (e) {
      throw new Error('the agents of --users run in bubblewrap (bwrap), which is missing: install it, or start with --no-sandbox')
    }
  }
  // the DevServers of the users answer only requests with this key
  const gatewayKey = crypto.randomBytes(16).toString('hex')

  // login token -> name, kept in DIR/logins.json, so a restart keeps the
  // tabs logged in; a login ends after LOGIN_MS or with a new password
  const LOGIN_MS = 7 * 24 * 60 * 60 * 1000
  const loginFile = path.join(dir, 'logins.json')
  const logins = new Map<string, string>()
  const since = new Map<string, number>()
  try {
    for (const [t, l] of Object.entries(JSON.parse(fs.readFileSync(loginFile, 'utf8')) as any)) {
      if ((l as any).at > Date.now() - LOGIN_MS) logins.set(t, (l as any).name), since.set(t, (l as any).at)
    }
  } catch (e) {}
  const saveLogins = () =>
    fs.writeFileSync(
      loginFile,
      JSON.stringify(Object.fromEntries([...logins].map(([t, name]) => [t, { name, at: since.get(t) || Date.now() }]))),
      { mode: 0o600 },
    )
  const failed = new Map<string, { n: number; until: number }>()
  const running = new Map<string, Instance>()
  // one start at a time: two of them looked for a free port at once
  let starting: Promise<any> = Promise.resolve()
  let nextPort = 4100

  // the command of this program, also as a pkg binary
  const self = (process as any).pkg ? [] : [process.argv[1]]

  function start(name: string): Instance {
    const home = path.join(dir, name)
    fs.mkdirSync(home, { recursive: true })
    const token = crypto.randomBytes(16).toString('hex')
    // the journal of the Teaching-Agent is the dashboard of an author
    const input = ['journal.md', 'README.md'].find((f) => fs.existsSync(path.join(home, f))) || '.'
    const inst: Instance = { child: null as any, ready: null as any, port: 0, token, open: 0, last: Date.now() }
    let child: ChildProcess
    inst.ready = starting = starting.then(async () => {
      while (!(await free(nextPort))) nextPort++
      const port = nextPort++
      child = spawn(process.execPath, [...self, '--agent', cfg.agent, '-p', String(port), '-i', input, ...(cfg.web ? [] : ['--proxy', 'off'])], {
        cwd: home,
        env: {
          ...process.env,
          LIA_TOKEN: token,
          LIA_GATEWAY: '1',
          LIA_GATEWAY_KEY: gatewayKey,
          LIA_ROLE: users[name].role,
          // the GitHub login of git_login (src/git.ts), the user's own
          LIA_CONFIG_DIR: path.join(dir, '.homes', name, '.config', 'liascript'),
          ...(cfg.models[users[name].role as 'student' | 'author'] ? { ANTHROPIC_MODEL: cfg.models[users[name].role as 'student' | 'author'] } : {}),
          ...(o.sandbox ? { LIA_SANDBOX: '1', LIA_AGENT_HOME: path.join(dir, '.homes', name) } : {}),
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      })
      inst.child = child
      child.on('exit', () => {
        if (running.get(name) === inst) running.delete(name)
        console.log('👤 ' + name + ': stopped')
      })
      // the DevServer moves to the next free port if it has to, it says which
      return new Promise<number>((resolve, reject) => {
        let out = ''
        let partial = ''
        child.stdout!.on('data', (d) => {
          out += d
          // a line of refused() of src/mcp.ts: a warning for the admin page
          const lines = (partial + d).split('\n')
          partial = lines.pop() || ''
          for (const line of lines) if (line.startsWith('🚫 refused ')) warn(name, line.slice('🚫 refused '.length))
          process.stdout.write(d.toString().replace(/^(?=.)/gm, '   ' + name + ' | '))
          const m = /local:\s+http:\/\/[^:/]+:(\d+)/.exec(out)
          if (m && !inst.port) {
            inst.port = Number(m[1])
            resolve(inst.port)
          }
        })
        child.on('exit', () => reject(new Error('the DevServer of ' + name + ' stopped')))
      })
    })
    // a failed start must not stop the next one
    starting = starting.catch(() => {})
    running.set(name, inst)
    console.log('👤 ' + name + ': starting')
    return inst
  }

  // Its listen() may come a moment after the line that names the port, so a
  // GET tries again for a few seconds; a body can be sent only once.
  async function reach(port: number, req: http.IncomingMessage, res: http.ServerResponse, headers: any) {
    const again = req.method === 'GET' || req.method === 'HEAD'
    for (let i = 0; i < 20; i++) {
      const done = await new Promise<boolean>((resolve) => {
        const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (r) => {
          res.writeHead(r.statusCode || 502, r.headers)
          r.pipe(res)
          resolve(true)
        })
        up.on('error', (e: any) => {
          if (again && e.code === 'ECONNREFUSED' && !res.headersSent) return resolve(false)
          if (!res.headersSent) res.writeHead(502)
          res.end()
          resolve(true)
        })
        res.on('close', () => up.destroy())
        if (again) up.end()
        else req.pipe(up)
      })
      if (done) return
      await new Promise((r) => setTimeout(r, 250))
    }
    res.writeHead(502)
    res.end()
  }

  // the version of the course a user got last, outside the user's folder
  const baseOf = (name: string) => path.join(dir, '.base', name)

  // what runs in the background per user: copying or updating their course;
  // the admin page shows it, the user waits for it
  const jobs = new Map<string, { course: string; kit: boolean; first: boolean; done: number; total: number }>()
  // the outcome of the jobs for the admin page, the newest last
  // (words in the language of the page that shows it, English in the terminal)
  const notices: { t: number; text: (L: Texts) => string; bad?: boolean }[] = []
  const notice = (text: (L: Texts) => string, bad = false) => {
    notices.push({ t: Date.now(), text, bad })
    if (notices.length > 10) notices.shift()
    ;(bad ? console.error : console.log)('👥 ' + text(TEXTS.en))
  }

  // A course update for a user (also the first copy): their DevServer stops,
  // its agent must not work on files that change; the next request starts it
  // again. In the background, a course of gigabytes takes minutes.
  const baseKitOf = (name: string) => path.join(dir, '.base-kit', name)
  async function updateCourse(name: string, first = false) {
    if (jobs.has(name)) return
    running.get(name)?.child?.kill()
    // German for the class channel of the user, as before
    const what = [users[name].course && 'Kurs ' + users[name].course, users[name].kit && cfg.kit && 'Teaching-Agent'].filter(Boolean).join(' und ')
    const job = { course: users[name].course || '', kit: !!(users[name].kit && cfg.kit), first, done: 0, total: 0 }
    jobs.set(name, job)
    try {
      fs.mkdirSync(path.join(dir, name), { recursive: true })
      const step = (done: number, total: number) => ((job.done = done), (job.total = total))
      const none = { updated: [] as string[], added: [] as string[], removed: [] as string[], conflicts: [] as string[] }
      const c = hasCourse(name) ? await syncCourse(users[name].source as string, baseOf(name), path.join(dir, name), undefined, step) : none
      const k = users[name].kit && cfg.kit ? await syncCourse(cfg.kit, baseKitOf(name), path.join(dir, name), KIT, step) : none
      notice(report(name, what, c, k, first, job))
    } catch (e: any) {
      notice((L) => L.errorAt(name, e.message), true)
    } finally {
      jobs.delete(name)
    }
  }

  // the user hears of an update in the class channel; the admin page gets a notice
  function report(name: string, what: string, c: any, k: any, first: boolean, job: { course: string; kit: boolean }): (L: Texts) => string {
    const r = {
      updated: [...c.updated, ...k.updated],
      added: [...c.added, ...k.added],
      removed: [...c.removed, ...k.removed],
      conflicts: [...c.conflicts, ...k.conflicts],
    }
    const parts = [
      r.updated.length && r.updated.length + ' aktualisiert',
      r.added.length && r.added.length + ' neu',
      r.removed.length && r.removed.length + ' entfernt',
    ].filter(Boolean)
    const text =
      'Dein ' + what + ' wurde aktualisiert' + (parts.length ? ' (' + parts.join(', ') + ')' : ', es gab nichts Neues') + '.' +
      (r.conflicts.length
        ? ' Diese Dateien hattest du selbst geändert, sie bleiben so; die neue Version liegt daneben: ' + r.conflicts.map(beside).join(', ')
        : '')
    if (!first && (parts.length || r.conflicts.length)) post(TEACHER, name, text)
    const words = (L: Texts) => [job.course && L.course(job.course), job.kit && 'Teaching-Agent'].filter(Boolean).join(L.and)
    if (first) return (L) => L.ready(name, words(L), r.added.length)
    return (L) =>
      name +
      ': ' +
      ([r.updated.length && L.updated(r.updated.length), r.added.length && L.added(r.added.length), r.removed.length && L.removed(r.removed.length)].filter(Boolean).join(', ') ||
        L.nothingNew) +
      (r.conflicts.length ? ', ' + L.conflicts(r.conflicts.join(', ')) : '')
  }

  // ------------------------------------------------------------ the class channel
  // Messages between people beside the chat with the AI, which never sees
  // them: the teacher to all or one, a user to the teacher, users to each
  // other once the teacher allows it (settings.dm). All of it is kept in
  // DIR/.class, the teacher reads all of it, a muted user writes nothing.
  const classDir = path.join(dir, '.class')
  fs.mkdirSync(classDir, { recursive: true })
  const messagesFile = path.join(classDir, 'messages.jsonl')
  const settingsFile = path.join(classDir, 'settings.json')
  let messages: Message[] = []
  try {
    messages = fs.readFileSync(messagesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch (e) {}
  let settings = { dm: false, muted: [] as string[] }
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }
  } catch (e) {}
  const saveSettings = () => fs.writeFileSync(settingsFile, JSON.stringify(settings), { mode: 0o600 })

  // What the AI of a user refused (src/mcp.ts refused()), for the admin page
  type Warning = { id: string; name: string; t: number; by: string; what: string; reason: string }
  const warningsFile = path.join(classDir, 'warnings.jsonl')
  const doneFile = path.join(classDir, 'warnings-done.json')
  let warnings: Warning[] = []
  let done: string[] = []
  try {
    warnings = fs.readFileSync(warningsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch (e) {}
  try {
    done = JSON.parse(fs.readFileSync(doneFile, 'utf8'))
  } catch (e) {}
  function warn(name: string, json: string) {
    let w: any
    try {
      w = JSON.parse(json)
    } catch (e) {
      return
    }
    if (!['server', 'agent'].includes(w.by)) return
    const warning: Warning = { id: crypto.randomBytes(6).toString('hex'), name, t: Date.now(), by: w.by, what: String(w.what || '').slice(0, 300), reason: String(w.reason || '').slice(0, 300) }
    warnings.push(warning)
    fs.appendFileSync(warningsFile, JSON.stringify(warning) + '\n', { mode: 0o600 })
    console.log('🚫 ' + name + ': ' + warning.what)
  }
  const openWarnings = () => warnings.filter((w) => !done.includes(w.id))
  const listeners: { name: string; res: http.ServerResponse }[] = []
  const sees = (m: Message, name: string) => m.to === ALL || m.to === name || m.from === name
  const classState = (name: string) => ({
    me: name,
    dm: settings.dm,
    muted: settings.muted.includes(name),
    users: settings.dm ? Object.keys(users).filter((n) => n !== name).sort() : [],
    messages: messages.filter((m) => sees(m, name)).slice(-200),
  })
  const tell = (res: http.ServerResponse, msg: object) => res.write('data: ' + JSON.stringify(msg) + '\n\n')
  function post(from: string, to: string, text: string) {
    const m = { t: new Date().toISOString(), from, to, text }
    messages.push(m)
    fs.appendFileSync(messagesFile, JSON.stringify(m) + '\n', { mode: 0o600 })
    for (const l of listeners) if (sees(m, l.name)) tell(l.res, { message: m })
  }
  const classChanged = () => listeners.forEach((l) => tell(l.res, { state: classState(l.name) }))

  async function classRoute(name: string, req: http.IncomingMessage, res: http.ServerResponse) {
    const route = (req.url || '').split('?')[0]
    if (req.method === 'GET' && route === '/class/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify(classState(name)))
    }
    if (req.method === 'GET' && route === '/class/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      tell(res, { state: classState(name) })
      const me = { name, res }
      listeners.push(me)
      const ping = setInterval(() => res.write('data: {"ping":true}\n\n'), 20000)
      return res.on('close', () => {
        clearInterval(ping)
        listeners.splice(listeners.indexOf(me), 1)
      })
    }
    if (req.method === 'POST' && route === '/class/send') {
      let m: any = {}
      try {
        m = JSON.parse(await read(req))
      } catch (e) {}
      const to = String(m.to || '')
      const text = typeof m.text === 'string' ? m.text.trim() : ''
      const allowed = to === TEACHER || (settings.dm && users[to] && to !== name)
      if (settings.muted.includes(name) || !allowed || !text || text.length > 2000) {
        res.writeHead(403)
        return res.end()
      }
      post(name, to, text)
      res.writeHead(204)
      return res.end()
    }
    res.writeHead(404)
    res.end()
  }

  // ------------------------------------------------------------ the front

  function page(res: http.ServerResponse, title: string, body: string, status = 200, more: http.OutgoingHttpHeaders = {}) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...more })
    res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1d2330;--card:#fff;--line:#d6dbe3;--accent:#0f766e;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e9ee;--card:#1d2128;--line:#343a45;--accent:#2dd4bf;--bad:#f97066}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;width:min(320px,calc(100vw - 32px));display:grid;gap:12px}
h1{font-size:1.25rem;margin:0}input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button{background:var(--accent);border-color:var(--accent);color:#fff;cursor:pointer}.bad{color:var(--bad);margin:0}</style></head><body>${body}</body></html>`)
  }

  // the texts of the front: the language of the browser, as on the admin page
  const loginTexts = (req: http.IncomingMessage) => LOGIN[langOf(req).lang]
  // user: the name of a link of the admin page (?user=), never a password.
  // The newest message of the teacher to the class greets too, cut short.
  function login(req: http.IncomingMessage, res: http.ServerResponse, base: string, message = '', user = '') {
    const last = [...messages].reverse().find((m) => m.from === TEACHER && m.to === ALL)
    const note = last && { t: last.t, text: last.text.length > 200 ? last.text.slice(0, 200) + '…' : last.text }
    res.writeHead(message ? 401 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(loginHtml({ L: loginTexts(req), base, user, message, note: note || undefined, secure: req.headers['x-lia-lan'] !== '1' }))
  }

  async function serve(req: http.IncomingMessage, res: http.ServerResponse) {
    const lan = req.headers['x-lia-lan'] === '1'
    const base = /^https?:\/\/[\w.-]+(:\d+)?(\/[\w.~-]+)*$/.test(String(req.headers['x-lia-origin'])) ? String(req.headers['x-lia-origin']) : ''
    // the share page sends the login as a header, a browser on the network a cookie
    const cookie = lan && /(?:^|;\s*)lia=([0-9a-f]{32})/.exec(String(req.headers.cookie || ''))
    const presented = String(req.headers['x-lia-token'] || (cookie && cookie[1]) || '')
    const name = (since.get(presented) || 0) > Date.now() - LOGIN_MS ? logins.get(presented) : undefined

    // the font of the login, before any login
    if (req.url === '/lia-font/geist.woff2' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=31536000' })
      return fs.createReadStream(path.join(ADMIN_VIEWS, 'geist.woff2')).pipe(res)
    }

    if (req.url === '/lia-login' && req.method === 'POST') {
      const f = await form(req)
      const who = String(f.get('name') || '').trim().toLowerCase()
      const lock = failed.get(who)
      if (lock && lock.until > Date.now()) return login(req, res, base, loginTexts(req).wait, who)
      const user = users[who]
      const ok =
        !!user &&
        crypto.timingSafeEqual(Buffer.from(hash(String(f.get('password') || ''), user.salt), 'hex'), Buffer.from(user.hash, 'hex'))
      if (!ok) {
        // a lock that ran out starts the count again, no lock goes on counting
        const n = (!lock || (lock.until && lock.until <= Date.now()) ? 0 : lock.n) + 1
        failed.set(who, { n, until: n >= TRIES ? Date.now() + LOCK_MS : 0 })
        return login(req, res, base, loginTexts(req).wrong, who)
      }
      failed.delete(who)
      const token = crypto.randomBytes(16).toString('hex')
      logins.set(token, who)
      since.set(token, Date.now())
      saveLogins()
      console.log('👤 ' + who + ': logged in')
      // the share page sends it along with every request of this tab, a
      // browser on the network of the school keeps it as a cookie
      return page(
        res,
        'Angemeldet',
        `<script>sessionStorage.setItem('lia-share-token', ${JSON.stringify(token)}); location.replace(${JSON.stringify(base + '/')})</script>`,
        200,
        lan ? { 'Set-Cookie': 'lia=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + LOGIN_MS / 1000 } : {},
      )
    }

    if (!name || !users[name]) {
      // a page in the frame gets the login, everything else waits for it
      const dest = String(req.headers['sec-fetch-dest'] || '')
      if (['document', 'iframe'].includes(dest) || String(req.headers.accept).includes('text/html'))
        return login(req, res, base, '', new URL(req.url || '/', 'http://x').searchParams.get('user') || '')
      res.writeHead(401)
      return res.end()
    }

    // the course is still being copied: the user waits for it
    const job = jobs.get(name)
    if (job && !(req.url || '').startsWith('/class/')) {
      const dest = String(req.headers['sec-fetch-dest'] || '')
      if (!['document', 'iframe'].includes(dest) && !String(req.headers.accept).includes('text/html')) {
        res.writeHead(503)
        return res.end()
      }
      const share = job.total ? ' (' + Math.floor((job.done * 100) / job.total) + ' %)' : ''
      const L = loginTexts(req)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(
        shellHtml(
          L,
          base,
          L.moment,
          `<section class="hi"><h1>${esc(L.moment)} …</h1><p class="lead">${esc(L.preparing(share))}</p></section><script>setTimeout(function(){location.reload()},3000)</script>`,
        ),
      )
    }

    // the class channel is the gateway's, the rest the user's DevServer
    if ((req.url || '').startsWith('/class/')) return classRoute(name, req, res)

    const inst = running.get(name) || start(name)
    let port: number
    try {
      port = await inst.ready
    } catch (e) {
      res.writeHead(502)
      return res.end()
    }
    inst.open++
    inst.last = Date.now()
    const started = Date.now()
    // LIA_DEBUG=1: every request of a user and how long it stayed open
    if (process.env.LIA_DEBUG) console.log('🐞 ' + name + ' ' + req.method + ' ' + req.url + ' (' + (req.headers['sec-fetch-dest'] || '-') + ')')
    res.on('close', () => {
      inst.open--
      inst.last = Date.now()
      if (process.env.LIA_DEBUG) console.log('🐞 ' + name + ' closed ' + req.url + ' after ' + (Date.now() - started) + ' ms, ' + res.statusCode)
    })
    // the DevServer checks Host and Origin as for a tab of this machine
    const web = req.headers['x-lia-web'] === '1'
    const target = web ? (port < 45535 ? port + 20000 : port - 20000) : port
    const headers: any = { ...req.headers, host: 'localhost:' + target, 'x-lia-gateway': gatewayKey }
    if (headers.origin) headers.origin = 'http://localhost:' + target
    delete headers['x-lia-token']
    delete headers['x-lia-web']
    reach(target, req, res, headers)
  }
  const front = http.createServer(serve)

  // ------------------------------------------------------------ the admin page
  // Built on the server in the language of the request (src/admin-texts.ts).
  // Look and behaviour live in views/admin/ (admin.css, admin.js, the font):
  // the page sends a CSP without inline script or style.

  async function stateOf(inst: Instance): Promise<any> {
    if (!inst.port) return null
    try {
      const r = await fetch('http://127.0.0.1:' + inst.port + '/agent/state/' + inst.token, {
        headers: { host: 'localhost:' + inst.port, 'x-lia-gateway': gatewayKey },
        signal: AbortSignal.timeout(1000),
      })
      return r.ok ? await r.json() : null
    } catch (e) {
      return null
    }
  }
  // every user, sorted, with what their DevServer reports
  async function snapshot() {
    const names = Object.keys(users).sort()
    const states = await Promise.all(names.map((n) => (running.get(n) ? stateOf(running.get(n)!) : null)))
    return { names, states }
  }
  const stuck = (s: any) => !!(s && s.stuck && Date.now() - s.stuck.at < IDLE_MS)

  // what the agents of a user cost, all their sessions (src/acp.ts writes it)
  const costsOf = (name: string) => {
    const sum: { [currency: string]: number } = {}
    try {
      for (const c of Object.values(JSON.parse(fs.readFileSync(path.join(dir, name, '.chats', '.acp-costs.json'), 'utf8'))) as any[]) {
        sum[c.currency] = (sum[c.currency] || 0) + c.amount
      }
    } catch (e) {}
    return sum
  }
  // what all agents cost per day (src/acp.ts writes it per user)
  const daysOf = (name: string): { [day: string]: { [currency: string]: number } } => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, name, '.chats', '.acp-days.json'), 'utf8'))
    } catch (e) {
      return {}
    }
  }
  const money = (L: Texts, amount: number, currency: string, digits = 2) =>
    amount.toLocaleString(L.locale, { style: 'currency', currency, maximumFractionDigits: digits })
  const when = (L: Texts, t: number | string) => new Date(t).toLocaleString(L.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const ago = (L: Texts, t: number) => {
    const m = Math.round((Date.now() - t) / 60000)
    return m < 1 ? L.justNow : m < 60 ? L.minAgo(m) : L.hAgo(Math.floor(m / 60))
  }
  // a button with an icon; the label stays visible, a tablet has no tooltips
  const btn = (cls: string, ico: string, label: string, more = '') => `<button class="btn ${cls}"${more}>${icon(ico)}<span>${esc(label)}</span></button>`
  const extLink = (cls: string, href: string, ico: string, label: string) =>
    `<a class="btn ${cls}" href="${esc(href)}" target="_blank" rel="noopener">${icon(ico)}<span>${esc(label)}</span></a>`
  // a QR code as a button: admin.js shows it large (projector, print)
  // the big one gets the four corner brackets of the HUD
  const qrButton = (L: Texts, cls: string, href: string, title: string) =>
    `<button type="button" class="qr ${cls}" data-qr data-qr-title="${esc(title)}" data-qr-link="${esc(href)}" aria-label="${esc(L.showQr + ': ' + title)}">${qr(href)}${
      cls === 'qr-hero' ? '<span class="br tl"></span><span class="br tr"></span><span class="br bl"></span><span class="br br-r"></span>' : ''
    }</button>`
  // the head of a numbered section: 01 Nutzer and what it is for
  const secHead = (num: string, id: string, title: string, lead = '', more = '') =>
    `<div class="sec-head"><div><p class="sec-num">${num}</p><h2 id="${id}-h">${esc(title)}</h2>${lead ? `<p class="t-sm muted">${esc(lead)}</p>` : ''}</div>${more}</div>`
  // a switch that sends its form at once (admin.js); off may ask first
  const switchForm = (L: Texts, action: string, on: boolean, label: string, confirmOff = '') =>
    `<form method="post" action="${action}" class="switch"${confirmOff ? ` data-confirm-off="${esc(confirmOff)}"` : ''}><label><input type="checkbox" role="switch" name="on" value="1"${
      on ? ' checked' : ''
    }><span class="track" aria-hidden="true"></span><span class="strong">${esc(label)}</span><span class="badge ${on ? 'on' : 'off'}">${esc(on ? L.on : L.off)}</span></label><noscript>${btn(
      'quiet sm',
      'check',
      L.save,
    )}</noscript></form>`

  // the hero: get the class in, the one thing this page is for
  function accessSection(L: Texts) {
    const on = !!link
    const [h1, h2] = on ? L.heroOn : L.heroOff
    const share = on
      ? `<div class="card share">
${qrButton(L, 'qr-hero', link, L.linkFor)}
<div class="share-info">
${switchForm(L, '/settings/share', true, L.share, L.confirmOff)}
<p class="t-sm muted">${esc(L.shareHint)}</p>
<p class="label">${esc(L.linkFor)}</p>
<code class="link">${esc(link)}</code>
<div class="actions">${btn('primary', 'copy', L.copyLink, ` type="button" data-copy="${esc(link)}"`)}${extLink('quiet', link, 'arrow-square-out', L.open)}<form method="post" action="/settings/share-new" data-confirm="${esc(
          L.confirmNewLink,
        )}">${btn('quiet', 'arrows-clockwise', L.newLink)}</form></div>
</div></div>`
      : `<div class="card share share-off">
<form method="post" action="/settings/share"><input type="hidden" name="on" value="1">${btn('primary', 'globe', L.shareCta)}</form>
<p class="t-sm muted">${esc(L.shareNote)}</p>
</div>`
    const lan = `<div class="card lan">
${switchForm(L, '/settings/lan', !!lanFront, L.lan, L.confirmOff)}
<p class="t-sm muted">${esc(L.lanHelp)} <strong class="danger-text">${esc(L.lanWarn)}</strong></p>
${lanAddresses
  .map(
    (a) =>
      `<div class="addr">${qrButton(L, 'qr-sm', a, L.lanShort)}<code>${esc(a)}</code><div class="actions">${btn('quiet sm', 'copy', L.copy, ` type="button" data-copy="${esc(a)}"`)}${extLink(
        'quiet sm',
        a,
        'arrow-square-out',
        L.open,
      )}</div></div>`,
  )
  .join('')}
<form method="post" action="/settings/lan" class="row"><input type="hidden" name="on" value="${lanFront ? '1' : '0'}"><label class="inline t-sm">${esc(
      L.port,
    )} <input name="port" type="number" min="1" max="65535" value="${cfg.lan.port}" class="w-port"></label>${btn('quiet sm', 'check', L.change)}</form>
</div>`
    return `<section id="access" class="hero" aria-labelledby="hero-h">
<div class="hero-text"><p class="sec-num">00 · ${esc(L.nav.access.toLocaleUpperCase(L.locale))}</p><h1 id="hero-h" class="grad">${esc(h1)}<br>${esc(h2)}</h1><p class="lead">${esc(on ? L.leadOn : L.leadOff)}</p></div>
<div class="access">${share}${lan}</div>
</section>`
  }

  // what needs the teacher: open warnings (red) and who is stuck (amber), newest first
  async function signals(L: Texts) {
    const { names, states } = await snapshot()
    const time = (t: number) => `<time class="mono t-xs muted">${esc(new Date(t).toLocaleTimeString(L.locale, { hour: '2-digit', minute: '2-digit' }))}</time>`
    const chat = (name: string) => extLink('quiet xs', '/chat/' + name, 'chat-circle-text', L.viewChat)
    const items = [
      ...openWarnings().map((w) => ({
        t: w.t,
        html: `<li class="sig warn">${time(w.t)}<div><p><strong>${esc(w.name)}</strong> <span class="t-sm">${esc(w.what)}</span></p><p class="label">${esc(
          w.by === 'server' ? L.byServer : L.byAi,
        )}</p>${w.reason ? `<p class="t-sm muted">${esc(w.reason)}</p>` : ''}<div class="actions">${chat(w.name)}<form method="post" action="/warnings/${esc(w.id)}/done">${btn(
          'quiet xs',
          'check',
          L.markDone,
        )}</form></div></div></li>`,
      })),
      ...names
        .map((n, i) => ({ n, s: states[i] }))
        .filter(({ s }) => stuck(s))
        .map(({ n, s }) => ({
          t: s.stuck.at,
          html: `<li class="sig help">${time(s.stuck.at)}<div><p><strong>${esc(n)}</strong> <span class="t-sm">${esc(L.needsHelp)} · ${esc(L.slide(s.stuck.slide || '?'))}</span></p><div class="actions">${chat(
            n,
          )}</div></div></li>`,
        })),
    ]
      .sort((a, b) => b.t - a.t)
      .slice(0, 10)
    return items.length ? items.map((i) => i.html).join('') : `<li class="sig none t-sm muted">${esc(L.nobodyStuck)}</li>`
  }

  // the costs of all users, today big and the last 7 days as bars
  function costCard(L: Texts) {
    const sum: { [day: string]: { [currency: string]: number } } = {}
    for (const name of Object.keys(users))
      for (const [day, c] of Object.entries(daysOf(name))) for (const [cur, a] of Object.entries(c)) ((sum[day] = sum[day] || {}), (sum[day][cur] = (sum[day][cur] || 0) + a))
    const dates = [...Array(7)].map((_, i) => new Date(Date.now() - (6 - i) * 864e5))
    const week = dates.map((d) => d.toLocaleDateString('sv'))
    // shortcut: one currency in the chart, the adapters report USD; sum per currency if another comes
    const currency = Object.keys(sum[week[6]] || Object.values(sum).pop() || { USD: 0 })[0] || 'USD'
    const values = week.map((d) => (sum[d] && sum[d][currency]) || 0)
    const top = Math.max(...values, 0.01)
    const bars = values
      .map((v, i) => {
        const h = Math.max(1, Math.round((v / top) * 40))
        return `<rect class="day" x="${i * 14}" y="${40 - h}" width="10" height="${h}" rx="1"${i === 6 ? ' data-today' : ''}><title>${esc(
          dates[i].toLocaleDateString(L.locale, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + money(L, v, currency),
        )}</title></rect>`
      })
      .join('')
    return `<div class="card stat cost"><p class="k">${icon('coins')}${esc(L.costToday)}</p><p class="v"><span id="today">${esc(money(L, values[6], currency))}</span></p>
<svg class="chart" viewBox="0 0 94 40" preserveAspectRatio="none" role="img" aria-label="${esc(L.chartLabel)}">${bars}</svg>
<p class="days" aria-hidden="true">${dates.map((d) => `<span>${esc(d.toLocaleDateString(L.locale, { weekday: 'narrow' }))}</span>`).join('')}</p>
<p class="t-xs muted">${esc(L.last7)}</p></div>`
  }

  // the numbers of the class: online, stuck, costs, what the jobs reported
  async function statsRow(L: Texts) {
    const { names, states } = await snapshot()
    const online = names.filter((n) => (running.get(n)?.open || 0) > 0).length
    const help = names.filter((n, i) => stuck(states[i]))
    return `<div class="stats">
<div class="card stat" data-online="${online}" data-online-label="${esc(L.online(online))}"><p class="k">${icon('users')}${esc(L.onlineNow)}</p><p class="v">${online}</p><p class="t-sm muted">${esc(
      L.ofUsers(names.length),
    )}</p></div>
<div class="card stat${help.length ? ' alert' : ''}"><p class="k">${icon('lifebuoy')}${esc(L.needHelp)}</p><p class="v">${help.length}</p><p class="t-sm muted">${
      help.length ? help.map((n) => `<a href="#u-${esc(n)}">${esc(n)}</a>`).join(', ') : esc(L.nobodyStuck)
    }</p></div>
${costCard(L)}
<div class="card stat recent"><p class="k">${icon('arrows-clockwise')}${esc(L.recent)}</p>${
      notices.length
        ? `<ul>${notices
            .slice(-5)
            .reverse()
            .map(
              (n) =>
                `<li${n.bad ? ' class="bad"' : ''}><time class="t-xs muted">${esc(new Date(n.t).toLocaleTimeString(L.locale, { hour: '2-digit', minute: '2-digit' }))}</time> <span class="t-sm">${esc(
                  n.text(L),
                )}</span></li>`,
            )
            .join('')}</ul>`
        : `<p class="t-sm muted">${esc(L.recentEmpty)}</p>`
    }</div>
</div>`
  }

  // all of the top: the page polls it, new warnings show up at once
  async function topPart(L: Texts) {
    return accessSection(L) + (await statsRow(L))
  }

  // the links of one user: the name filled in, the password typed
  const linksOf = (L: Texts, name: string) => [
    ...(link ? [{ where: L.internet, href: link + '&user=' + encodeURIComponent(name) }] : []),
    ...lanAddresses.map((a) => ({ where: lanAddresses.length > 1 ? L.lanWhere(new URL(a).hostname) : L.lanShort, href: a + '?user=' + encodeURIComponent(name) })),
  ]
  // the name cell: one QR code (the internet if it is on) left, name, role
  // and a copy button per address right of it
  const whoCell = (L: Texts, name: string, head: string) => {
    const links = linksOf(L, name)
    if (!links.length) return `<div class="who"><div>${head}</div></div>`
    return `<div class="who">${qrButton(L, 'qr-sm', links[0].href, name + ' · ' + links[0].where)}<div>${head}<div class="ulink">${links
      .map((l) => btn('quiet xs', 'copy', links.length > 1 ? l.where : L.copyLink, ` type="button" data-copy="${esc(l.href)}" title="${esc(L.copyLink + ': ' + l.href)}"`))
      .join('')}</div></div></div>`
  }
  const what = (L: Texts, course: string, kit: boolean) => [course && L.course(course), kit && 'Teaching-Agent'].filter(Boolean).join(L.and)
  // a thin bar, drawn in SVG: the page allows no inline style
  const bar = (part: number) => `<svg class="bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="4" rx="2"/><rect width="${Math.max(
    2,
    Math.round(part * 100),
  )}" height="4" rx="2"/></svg>`

  async function rows(L: Texts) {
    const { names, states } = await snapshot()
    if (!names.length)
      return `<tr class="empty"><td colspan="7"><div class="empty-state">${icon('user-plus', 'icon big')}<p class="t-lg strong">${esc(L.noUsers)}</p><p class="t-sm muted">${esc(
        L.noUsersLead,
      )}</p><a class="btn quiet sm" href="#new">${esc(L.newUser)}</a></div></td></tr>`
    const total = (c: { [currency: string]: number }) => Object.values(c).reduce((a, b) => a + b, 0)
    const most = Math.max(0.0001, ...names.map((n) => total(costsOf(n))))
    const courses = courseList(cfg.courses)
    return names
      .map((n, i) => {
        const inst = running.get(n)
        const s = states[i]
        const online = !!inst && inst.open > 0
        const help = stuck(s)
        const job = jobs.get(n)
        const costs = costsOf(n)
        // the title is "slide · course", the course has a column of its own; README.md says nothing to a teacher
        const slide = s && String(s.title || '').split(' · ')
        const where = s
          ? s.web
            ? s.web
            : [s.file !== 'README.md' && s.file, s.slide && L.slide(s.slide) + (s.title ? ': ' + (slide.length > 1 ? slide.slice(0, -1).join(' · ') : s.title) : '')]
                .filter(Boolean)
                .join(' · ')
          : ''
        const status = online
          ? `<span class="status online"><span class="dot"></span>${esc(L.statusOnline)}</span>`
          : inst
          ? `<span class="status closed" title="${esc(L.statusClosedTitle)}"><span class="dot"></span>${esc(L.statusClosed)}</span>`
          : `<span class="status off"><span class="dot"></span>${esc(L.statusOff)}</span>`
        const course = job
          ? `<p class="t-sm">${esc((job.first ? L.copying : L.updating)(what(L, job.course, job.kit)))}</p>${job.total ? bar(job.done / job.total) : ''}<p class="t-xs muted">${esc(
              job.total ? L.files(job.done, job.total) : L.starting,
            )}</p>`
          : users[n].course || users[n].kit
          ? `<p class="t-sm strong">${esc(users[n].course || '')}</p>${users[n].kit ? `<span class="badge author">+ Teaching-Agent</span>` : ''}<form method="post" action="/update/${esc(
              n,
            )}">${btn('quiet xs', 'arrows-clockwise', L.update)}</form>`
          : `<form method="post" action="/assign/${esc(n)}" class="row tight"><label class="sr-only" for="as-${esc(n)}">${esc(L.chooseCourse)}</label><select id="as-${esc(
              n,
            )}" name="course" class="sm"><option value="">–</option>${courses.map((c) => `<option>${esc(c)}</option>`).join('')}</select>${btn('quiet xs', 'check', L.assign)}</form>`
        const muted = settings.muted.includes(n)
        return `<tr id="u-${esc(n)}" data-name="${esc(n)}" data-role="${users[n].role === 'author' ? 'author' : 'student'}" data-online="${online ? 1 : 0}" data-help="${help ? 1 : 0}"${
          help ? ' class="help"' : ''
        }>
<td data-label="${esc(L.head.name)}">${whoCell(
          L,
          n,
          `<p><strong>${esc(n)}</strong> <span class="badge ${users[n].role === 'author' ? 'author' : 'off'}">${esc(users[n].role === 'author' ? L.author : L.student)}</span>${
            muted ? ` <span class="badge off">${icon('speaker-slash')}${esc(L.muted)}</span>` : ''
          }</p>`,
        )}</td>
<td data-label="${esc(L.head.status)}">${status}<p class="t-xs muted">${inst ? esc(ago(L, inst.last)) : ''}</p></td>
<td data-label="${esc(L.head.course)}">${course}</td>
<td data-label="${esc(L.head.where)}"><p class="t-sm">${esc(where) || '<span class="muted">–</span>'}</p>${
          help ? `<span class="badge help">${icon('lifebuoy')}${esc(L.needsHelp)}</span><p class="t-xs muted">${esc(ago(L, s.stuck.at))} · ${esc(L.slide(s.stuck.slide || '?'))}</p>` : ''
        }</td>
<td data-label="${esc(L.head.chat)}">${s && s.session ? `<p class="t-xs muted">${esc(L.entries(s.session.count))}</p>` : ''}${extLink('quiet xs', '/chat/' + n, 'chat-circle-text', L.readAlong)}</td>
<td data-label="${esc(L.head.cost)}" class="num">${
          Object.keys(costs).length
            ? `<p class="t-sm">${esc(
                Object.entries(costs)
                  .map(([c, a]) => money(L, a, c, 4))
                  .join(', '),
              )}</p>${bar(total(costs) / most)}`
            : '<span class="muted">–</span>'
        }</td>
<td class="manage"><details class="menu"><summary class="btn quiet xs">${icon('gear')}<span>${esc(L.manage)}</span></summary><div class="pop">
<form method="post" action="/password/${esc(n)}" class="field"><label for="pw-${esc(n)}" class="t-sm strong">${esc(L.newPassword)}</label><div class="row tight"><input id="pw-${esc(
          n,
        )}" name="password" type="password" autocomplete="new-password" placeholder="${esc(L.passwordPlaceholder)}" required minlength="6" data-error="${esc(L.passwordError)}">${btn(
          'primary sm',
          'key',
          L.setPassword,
        )}</div><p class="error" hidden></p></form>
<form method="post" action="/mute/${esc(n)}">${btn('quiet sm wide', muted ? 'speaker-high' : 'speaker-slash', muted ? L.unmute : L.mute)}</form>
<form method="post" action="/delete/${esc(n)}" data-confirm="${esc(L.confirmDelete(n))}">${btn('danger sm wide', 'trash', L.remove)}</form>
</div></details></td></tr>`
      })
      .join('')
  }

  // the class channel for the teacher: every message, also between users
  const label = (L: Texts, n: string) => (n === TEACHER ? L.teacher : n === ALL ? L.all : n)
  function classLog(L: Texts) {
    if (!messages.length) return `<div class="empty-state">${icon('chat-circle-text', 'icon big')}<p class="t-sm muted">${esc(L.noMessages)}</p></div>`
    return messages
      .slice(-100)
      .reverse()
      .map(
        (m) =>
          `<div class="m${m.from === TEACHER ? ' me' : ''}"><p class="t-xs muted">${esc(label(L, m.from))} → ${esc(label(L, m.to))} · ${esc(when(L, m.t))}</p><p>${esc(m.text)}</p></div>`,
      )
      .join('')
  }

  // a password just set, shown once to copy: users.json has only its hash
  let fresh: { name: string; password: string } | null = null
  function freshBox(L: Texts) {
    if (!fresh) return ''
    const f = fresh
    fresh = null
    return `<div class="card fresh" role="status">${icon('key', 'icon lg')}<div><p>${esc(L.freshFor)} <strong>${esc(f.name)}</strong></p><div class="row"><code class="pw">${esc(
      f.password,
    )}</code>${btn('quiet sm', 'copy', L.copy, ` type="button" data-copy="${esc(f.password)}"`)}</div><p class="t-sm muted">${esc(L.freshNote)}</p></div></div>`
  }

  // the settings, collapsed, each with what it does
  function settingsBox(L: Texts) {
    const option = (v: string, label: string, now?: string) => `<option value="${v}"${(now || '') === v ? ' selected' : ''}>${esc(label)}</option>`
    const models = (role: 'student' | 'author') =>
      `<select id="m-${role}" name="${role}">${option('', L.modelDefault, cfg.models[role])}${option('haiku', L.modelCheap, cfg.models[role])}${option(
        'sonnet',
        'Sonnet',
        cfg.models[role],
      )}${option('opus', L.modelDear, cfg.models[role])}</select>`
    const folder = (action: string, id: string, now: string | null, empty: string) =>
      `<form method="post" action="${action}" class="row folder"><label class="sr-only" for="${id}">${esc(L.pick)}</label><input id="${id}" name="path" value="${esc(now || '')}" placeholder="${esc(
        empty,
      )}" class="path">${btn('quiet sm', 'folder', L.pick, ' type="button" data-pick')}${btn('primary sm', 'check', L.apply)}</form><div class="picker" hidden></div>`
    const block = (title: string, help: string, body: string, later = false) =>
      `<div class="setting"><h3>${esc(title)}</h3><p class="t-sm muted">${esc(help)}${later ? ' ' + esc(L.nextStart) : ''}</p>${body}</div>`
    return `<details class="card settings" id="settings"><summary><span class="sum-title"><span class="sec-num">05</span><span><span class="t-xl strong">${esc(
      L.settings,
    )}</span><span class="t-sm muted block">${esc(L.settingsLead)}</span></span></span>${icon('caret-down', 'icon caret')}</summary>
<div class="settings-grid">
${block(
  L.model,
  L.modelHelp,
  cfg.agent === 'claude'
    ? `<form method="post" action="/settings/models" class="row"><label class="inline t-sm" for="m-student">${esc(L.forStudents)}</label>${models('student')}<label class="inline t-sm" for="m-author">${esc(
        L.forAuthors,
      )}</label>${models('author')}${btn('primary sm', 'check', L.save)}</form>`
    : `<p class="t-sm muted">${esc(L.ownModel(cfg.agent))}</p>`,
  true,
)}
${block(L.web, L.webHelp, switchForm(L, '/settings/web', cfg.web, L.web), true)}
${block(
  L.idle,
  L.idleHelp,
  `<form method="post" action="/settings/idle" class="row"><label class="inline t-sm">${esc(L.idleAfter)} <input name="minutes" type="number" min="5" max="240" value="${
    cfg.idleMinutes
  }" class="w-min"> ${esc(L.minutes)}</label>${btn('primary sm', 'check', L.save)}</form>`,
)}
${block(L.courses, L.coursesHelp(courseList(cfg.courses).length), folder('/settings/courses', 'f-courses', cfg.courses, ''))}
${block(L.kit, L.kitHelp, folder('/settings/kit', 'f-kit', cfg.kit, L.kitEmpty))}
</div></details>`
  }

  function helpBox(L: Texts) {
    return `<div class="faq">${L.faq
      .map(([q, a]) => `<details><summary><span>${esc(q)}</span>${icon('caret-down', 'icon caret')}</summary><p>${esc(a)}</p></details>`)
      .join('')}</div>`
  }

  // the texts admin.js needs, as data: the CSP runs no inline script
  const clientTexts = (L: Texts) =>
    JSON.stringify({ copied: L.copied, up: L.up, loading: L.loading, nCourses: L.nCourses(0).replace('0', '{n}') }).replace(/</g, '\\u003c')

  const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  // light or dark as the switch of the page chose it (cookie), else the system's
  const themeOf = (req: http.IncomingMessage) => /(?:^|;\s*)lia-theme=(light|dark)/.exec(String(req.headers.cookie || ''))?.[1] || ''
  function shell(L: Texts, title: string, body: string, theme = '') {
    return `<!doctype html><html lang="${L.lang}"${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(L.title)}"><meta name="robots" content="noindex">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml"><link rel="preload" href="/static/geist.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/static/geist-mono.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/admin.css"></head><body>${body}
<script type="application/json" id="texts">${clientTexts(L)}</script><script src="/static/admin.js" defer></script></body></html>`
  }
  // the mark of LiaLMS: the pixel robot of the chat, outlined
  const ROBOT =
    '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="2" width="10" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="0.8"/><rect x="3.2" y="5" width="1.6" height="1.6" fill="currentColor"/><rect x="7.2" y="5" width="1.6" height="1.6" fill="currentColor"/><rect x="4.2" y="8.2" width="3.6" height="0.8" fill="currentColor"/><rect x="5.6" y="0.4" width="0.8" height="1.6" fill="currentColor"/></svg>'
  const NAV = ['access', 'users', 'class', 'settings', 'help'] as const
  const navText = (L: Texts, id: (typeof NAV)[number]) => (id === 'class' ? L.nav.cls : L.nav[id])

  async function adminPage(res: http.ServerResponse, L: Texts, message = '', theme = '') {
    const [top, table, sig] = [await topPart(L), await rows(L), await signals(L)]
    const online = [...running.values()].filter((i) => i.open > 0).length
    const links = NAV.map((id) => `<a href="#${id}" data-nav="${id}">${esc(navText(L, id))}</a>`).join('')
    const lang = (['de', 'en'] as const)
      .map((l) => `<a href="/lang/${l}" hreflang="${l}" lang="${l}"${L.lang === l ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`)
      .join('')
    const courses = courseList(cfg.courses)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP })
    res.end(
      shell(
        L,
        L.title,
        `<a class="skip" href="#main">${esc(L.skip)}</a>
<header class="bar-wrap"><nav class="navbar" aria-label="${esc(L.title)}">
<a class="brand" href="#access"><span class="mark">${ROBOT}</span><span>Lia<span class="brand-em">LMS</span></span></a>
<div class="links">${links}</div>
<span class="online" title="${esc(L.onlineNow)}"><span class="dot"></span><span id="online-label">${esc(L.online(online))}</span></span>
<div class="lang" role="group" aria-label="${esc(L.langSwitch)}">${lang}</div>
<button type="button" class="theme-btn" data-theme-toggle aria-label="${esc(L.themeSwitch)}" title="${esc(L.themeSwitch)}">${icon('sun', 'icon sun')}${icon('moon', 'icon moon')}</button>
<button type="button" class="menu-btn" aria-expanded="false" aria-controls="panel"><span class="sr-only">${esc(L.menu)}</span><span class="l1"></span><span class="l2"></span></button>
</nav></header>
<div id="panel" class="panel" hidden><nav aria-label="${esc(L.menu)}">${links}</nav></div>
<main id="main">
${freshBox(L)}<div id="top">${top}</div>

<div class="main-grid">
<section id="users" class="reveal" aria-labelledby="users-h">${secHead(
          '01',
          'users',
          L.users,
          L.usersLead,
          `<form method="post" action="/update/all">${btn('quiet sm', 'arrows-clockwise', L.updateAll)}</form>`,
        )}
<div class="filters"><div class="chips" role="group" aria-label="${esc(L.users)}">${(
          [
            ['all', L.filterAll],
            ['online', L.filterOnline],
            ['help', L.filterHelp],
            ['author', L.filterAuthors],
          ] as const
        )
          .map(([f, label]) => `<button type="button" class="chip" data-filter="${f}" aria-pressed="${f === 'all'}">${esc(label)}</button>`)
          .join('')}</div><label class="search">${icon('magnifying-glass')}<span class="sr-only">${esc(L.search)}</span><input type="search" id="user-search" placeholder="${esc(
          L.search,
        )}" autocomplete="off"></label></div>
<div class="card table-card"><table><thead><tr><th>${esc(L.head.name)}</th><th>${esc(L.head.status)}</th><th>${esc(L.head.course)}</th><th>${esc(L.head.where)}</th><th>${esc(
          L.head.chat,
        )}</th><th class="num">${esc(L.head.cost)}</th><th><span class="sr-only">${esc(L.manage)}</span></th></tr></thead><tbody id="rows">${table}</tbody></table></div></section>

<aside class="side">
<section id="signals" class="reveal" aria-labelledby="signals-h">${secHead(
          '02',
          'signals',
          L.signals,
          '',
          `<span class="label live-label"><span class="live"></span>${esc(L.live)}</span>`,
        )}<ul id="signals-list" class="card signals">${sig}</ul></section>
<section id="class" class="reveal" aria-labelledby="class-h">${secHead('03', 'class', L.cls, L.clsLead)}
<div class="card class-card"><form class="say" method="post" action="/class/say"><label class="sr-only" for="say-to">${esc(L.toAll)}</label><select id="say-to" name="to"><option value="${ALL}">${esc(
          L.toAll,
        )}</option>${Object.keys(users)
          .sort()
          .map((n) => `<option value="${esc(n)}">${esc(L.to(n))}</option>`)
          .join('')}</select><label class="sr-only" for="say-text">${esc(L.message)}</label><textarea id="say-text" name="text" rows="2" required maxlength="2000" placeholder="${esc(
          L.messagePlaceholder,
        )}"></textarea>${btn('primary', 'paper-plane-tilt', L.send)}</form>
${switchForm(L, '/class/dm', settings.dm, L.dm)}
<div id="log" class="log">${classLog(L)}</div></div></section>
</aside>
</div>
<div class="pair">

<section id="new" class="reveal" aria-labelledby="new-h">${secHead('04', 'new', L.newUser, L.newUserLead)}
<form class="card new" method="post" action="/users">
<div class="field"><label for="nu-name">${esc(L.name)}</label><input id="nu-name" name="name" placeholder="${esc(L.namePlaceholder)}" autocomplete="off" required pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,31}" data-error="${esc(
          L.nameError,
        )}"><p class="error" hidden></p></div>
<div class="field"><label for="nu-pw">${esc(L.password)}</label><input id="nu-pw" name="password" type="password" autocomplete="new-password" placeholder="${esc(
          L.passwordPlaceholder,
        )}" required minlength="6" data-error="${esc(L.passwordError)}"><p class="error" hidden></p></div>
<div class="field"><label for="nu-role">${esc(L.role)}</label><select id="nu-role" name="role"><option value="student">${esc(L.student)}</option><option value="author">${esc(
          L.author,
        )}</option></select></div>
<div class="field"><label for="nu-course">${esc(L.courseLabel)}</label><select id="nu-course" name="course" title="${esc(L.courseFrom(cfg.courses))}"><option value="">${esc(
          L.noCourse,
        )}</option>${courses.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
${cfg.kit ? `<label class="check" title="${esc(L.withKitTitle)}"><input type="checkbox" name="kit" value="1"> ${esc(L.withKit)}</label>` : ''}
<div class="submit">${btn('primary', 'user-plus', L.create)}</div>
</form></section>

<section class="reveal" aria-label="${esc(L.settings)}">${settingsBox(L)}</section>
</div>

<section id="help" class="reveal" aria-labelledby="help-h">${secHead('06', 'help', L.help)}${helpBox(L)}</section>
</main>
<footer class="foot"><span>${esc(L.footer)}</span><a href="https://github.com/LiaScript/LiaScript-DevServer" target="_blank" rel="noopener">${esc(
          L.source,
        )}</a><a href="https://github.com/LiaScript/LiaScript-DevServer/blob/main/README.md" target="_blank" rel="noopener">${esc(L.docs)}</a></footer>
<div class="toasts" role="status" aria-live="polite">${
          message ? `<div class="toast">${icon('check')}<p>${esc(message)}</p><button type="button" class="btn quiet xs icon-only" data-dismiss aria-label="${esc(L.close)}">${icon('x')}</button></div>` : ''
        }</div>
<dialog id="qr-dialog" class="dialog qr-dialog" aria-labelledby="qr-title"><p id="qr-title" class="t-2xl strong"></p><div class="qr-big"></div><code class="qr-link"></code><form method="dialog">${btn(
          'quiet',
          'x',
          L.close,
        )}</form></dialog>
<dialog id="ask" class="dialog"><p class="ask-text"></p><div class="actions"><button type="button" class="btn quiet" data-answer="no">${esc(L.cancel)}</button><button type="button" class="btn danger solid" data-answer="yes">${esc(
          L.confirm,
        )}</button></div></dialog>`,

        theme,
      ),
    )
  }

  function chatPage(res: http.ServerResponse, L: Texts, name: string, theme = '') {
    const chats = path.join(dir, name, '.chats')
    let entries: any[] = []
    try {
      const latest = fs
        .readdirSync(chats)
        .filter((f) => /^[\w-]+\.json$/.test(f))
        .map((f) => ({ f, t: fs.statSync(path.join(chats, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0]
      if (latest) entries = JSON.parse(fs.readFileSync(path.join(chats, latest.f), 'utf8')).entries || []
    } catch (e) {}
    // readable for the teacher: no header comment, a link as its text, no ** of bold
    const md = (m: string) => String(m || '').replace(/<!--[\s\S]*?-->\s*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '')
    const text = (e: any) =>
      e.type === 'user' ? e.text : e.type === 'ai' ? md(e.markdown) : e.type === 'answer' ? Object.values(e.values || {}).join(', ') : e.label || e.cmd || ''
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP })
    res.end(
      shell(
        L,
        L.chatOf(name),
        `<main id="main" class="chat-page"><a class="btn quiet sm" href="/">${icon('arrow-up')}<span>${esc(L.back)}</span></a><h1 class="t-3xl strong">${esc(L.chatOf(name))}</h1><div id="entries">${
          entries.length
            ? entries
                .map(
                  (e) =>
                    `<div class="e ${esc(e.type)}"><p class="t-xs muted">${esc(e.type === 'ai' ? (e.agent && (e.agent.label || e.agent.name)) || L.ai : name)} · ${esc(
                      e.t ? new Date(e.t).toLocaleTimeString(L.locale, { hour: '2-digit', minute: '2-digit' }) : '',
                    )}</p><p>${esc(text(e))}</p></div>`,
                )
                .join('')
            : `<div class="empty-state">${icon('chat-circle-text', 'icon big')}<p class="t-sm muted">${esc(L.noChat)}</p></div>`
        }</div></main>`,

        theme,
      ),
    )
  }

  let link = ''
  const admin = http.createServer((req, res) =>
    adminRoute(req, res).catch((e: any) => {
      notice((L) => L.error(e.message), true)
      if (!res.headersSent) res.writeHead(303, { Location: '/?m=' + encodeURIComponent(langOf(req).error(e.message)) })
      res.end()
    }),
  )
  async function adminRoute(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = String(req.headers.host)
    // this machine only, and forms only from this page
    if (!['localhost:' + cfg.admin, '127.0.0.1:' + cfg.admin].includes(host) || (req.method === 'POST' && !sameOrigin(req))) {
      res.writeHead(403)
      return res.end()
    }
    const L = langOf(req)
    // the look of the page, the same for everyone: no key needed
    const file = /^\/static\/([\w.-]+)$/.exec(req.url || '')?.[1]
    if (req.method === 'GET' && file && (file in STATIC || file === 'icon.svg')) {
      res.writeHead(200, { 'Content-Type': file === 'icon.svg' ? 'image/svg+xml' : STATIC[file], 'Cache-Control': file.endsWith('.woff2') ? 'max-age=31536000' : 'no-cache' })
      return res.end(file === 'icon.svg' ? FAVICON : fs.readFileSync(path.join(ADMIN_VIEWS, file)))
    }
    // the address with the key of the terminal becomes a cookie, nothing works without it
    const key = new URL(req.url || '/', 'http://localhost').searchParams.get('k')
    if (req.method === 'GET' && key === cfg.key) {
      res.writeHead(303, { Location: '/', 'Set-Cookie': 'lia-admin=' + cfg.key + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000' })
      return res.end()
    }
    if (/(?:^|;\s*)lia-admin=([0-9a-f]+)/.exec(String(req.headers.cookie || ''))?.[1] !== cfg.key) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP })
      return res.end(shell(L, L.title, `<main id="main" class="chat-page"><div class="empty-state">${icon('key', 'icon big')}<p class="t-lg">${esc(L.keyNeeded)}: <code>…/?k=…</code></p></div></main>`, themeOf(req)))
    }
    const [, action, who] = /^\/(\w+)?\/?([^/?]*)/.exec(req.url || '') || []

    if (req.method === 'GET' && !action) {
      const message = new URL(req.url || '/', 'http://localhost').searchParams.get('m') || ''
      return adminPage(res, L, message, themeOf(req))
    }
    // the switch of the page: the language as a cookie, back to the page
    if (req.method === 'GET' && action === 'lang' && (who === 'de' || who === 'en')) {
      res.writeHead(303, { Location: '/', 'Set-Cookie': 'lia-lang=' + who + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000' })
      return res.end()
    }
    // the signals, polled like the rows: new warnings show up at once
    if (req.method === 'GET' && action === 'signals') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(await signals(L))
    }
    // the top of the page, polled like the rows
    if (req.method === 'GET' && action === 'top') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(await topPart(L))
    }
    if (req.method === 'GET' && action === 'rows') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(await rows(L))
    }
    if (req.method === 'GET' && action === 'chat' && users[who]) return chatPage(res, L, who, themeOf(req))
    // the folder list of the settings: folders below home only
    if (req.method === 'GET' && action === 'folders') {
      const at = inHome(new URL(req.url || '/', 'http://localhost').searchParams.get('path') || os.homedir())
      if (!at) {
        res.writeHead(403)
        return res.end()
      }
      const folders = fs
        .readdirSync(at, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.') && d.name !== 'node_modules' && inHome(path.join(at, d.name)))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b))
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify({ path: at, parent: inHome(path.dirname(at)) !== at ? inHome(path.dirname(at)) : null, folders, courses: courseList(at).length }))
    }
    if (req.method === 'GET' && action === 'class' && who === 'log') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(classLog(L))
    }
    if (req.method !== 'POST') {
      res.writeHead(404)
      return res.end()
    }
    const f = await form(req)
    let message = ''
    if (action === 'users') {
      const name = String(f.get('name') || '').trim().toLowerCase()
      const password = String(f.get('password') || '')
      const role = String(f.get('role'))
      const course = String(f.get('course') || '').trim()
      if (!NAME.test(name)) message = L.badName
      else if (users[name]) message = L.exists(name)
      else if (password.length < 6) message = L.passwordError
      else if (!ROLES.includes(role)) message = L.unknownRole
      // only a course of the list: no path from the form ever reaches the disk
      else if (course && !courseList(cfg.courses).includes(course)) message = L.noSuchCourse(course, cfg.courses)
      else {
        fs.mkdirSync(path.join(dir, name), { recursive: true })
        const kit = !!cfg.kit && f.get('kit') === '1'
        const salt = crypto.randomBytes(16).toString('hex')
        users[name] = { salt, hash: hash(password, salt), role, created: new Date().toISOString(), ...(course ? { course, source: path.join(cfg.courses, course) } : {}), ...(kit ? { kit } : {}) }
        save()
        fresh = { name, password }
        // the copy in the background, the page shows how far it is
        if (course || kit) void updateCourse(name, true)
        message = L.created(name, [course, kit && 'Teaching-Agent'].filter(Boolean).join(L.and))
      }
    } else if (action === 'password' && users[who]) {
      const password = String(f.get('password') || '')
      if (password.length < 6) message = L.passwordError
      else {
        users[who].salt = crypto.randomBytes(16).toString('hex')
        users[who].hash = hash(password, users[who].salt)
        save()
        fresh = { name: who, password }
        // logged in with the old one: out
        for (const [t, n] of logins) if (n === who) logins.delete(t)
        saveLogins()
        message = L.passwordSet(who)
      }
    } else if (action === 'update' && who === 'all') {
      const list = Object.keys(users).filter(
        (n) => hasCourse(n) || (users[n].kit && cfg.kit),
      )
      // one after the other, a class at once would read the course 30 times in parallel
      void (async () => {
        for (const n of list) await updateCourse(n)
      })()
      message = list.length ? L.updatesFor(list.join(', ')) : L.nobodyHasCourse
    } else if (action === 'update' && users[who] && (users[who].course || users[who].kit)) {
      void updateCourse(who)
      message = L.updateFor(who)
    } else if (action === 'assign' && users[who] && !users[who].course) {
      const course = String(f.get('course') || '')
      if (!courseList(cfg.courses).includes(course)) message = L.pickACourse
      else {
        users[who].course = course
        users[who].source = path.join(cfg.courses, course)
        save()
        void updateCourse(who, true)
        message = L.copyingFor(course, who)
      }
    } else if (action === 'settings' && who === 'share') {
      message = setShare(f.get('on') === '1', false, L)
    } else if (action === 'settings' && who === 'share-new') {
      message = setShare(true, true, L)
    } else if (action === 'settings' && who === 'lan') {
      const port = Number(f.get('port') || cfg.lan.port)
      if (Number.isInteger(port) && port > 0 && port < 65536 && port !== cfg.lan.port) {
        // a new port: the old server goes first
        if (lanFront) await setLan(false, L)
        cfg.lan.port = port
      }
      message = await setLan(f.get('on') === '1', L)
    } else if (action === 'settings' && who === 'courses') {
      const at = inHome(String(f.get('path') || ''))
      if (!at) message = L.outside
      else (cfg.courses = at), saveConfig(), (message = L.coursesFrom(at, courseList(at).length))
    } else if (action === 'settings' && who === 'kit') {
      const given = String(f.get('path') || '')
      const at = given ? inHome(given) : null
      if (given && !at) message = L.outside
      else (cfg.kit = at), saveConfig(), (message = at ? L.kitFrom(at) : L.noKit)
    } else if (action === 'settings' && who === 'models') {
      const chosen = (['student', 'author'] as const).map((r) => [r, String(f.get(r) || '')] as const)
      if (chosen.some(([, m]) => m && !MODELS.includes(m))) message = L.unknownModel
      else {
        cfg.models = Object.fromEntries(chosen.filter(([, m]) => m))
        saveConfig()
        message = L.modelsSaved
      }
    } else if (action === 'settings' && who === 'idle') {
      const minutes = Number(f.get('minutes'))
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) message = L.idleRange
      else (cfg.idleMinutes = minutes), saveConfig(), (message = L.idleSet(minutes))
    } else if (action === 'settings' && who === 'web') {
      cfg.web = f.get('on') === '1'
      saveConfig()
      message = cfg.web ? L.webOn : L.webOff
    } else if (action === 'warnings' && /\/done$/.test(req.url || '') && warnings.some((w) => w.id === who)) {
      if (!done.includes(who)) done.push(who)
      fs.writeFileSync(doneFile, JSON.stringify(done), { mode: 0o600 })
      message = L.warningDone
    } else if (action === 'class' && who === 'say') {
      const to = String(f.get('to') || ALL)
      const text = String(f.get('text') || '').trim()
      if (text && text.length <= 2000 && (to === ALL || users[to])) post(TEACHER, to, text), (message = L.sentTo(to === ALL ? L.all : to))
    } else if (action === 'class' && who === 'dm') {
      settings.dm = f.get('on') === '1'
      saveSettings()
      classChanged()
      message = settings.dm ? L.dmOn : L.dmOff
    } else if (action === 'mute' && users[who]) {
      settings.muted = settings.muted.includes(who) ? settings.muted.filter((n) => n !== who) : [...settings.muted, who]
      saveSettings()
      classChanged()
      message = settings.muted.includes(who) ? L.isMuted(who) : L.isUnmuted(who)
    } else if (action === 'delete' && users[who]) {
      running.get(who)?.child?.kill()
      for (const [t, n] of logins) if (n === who) logins.delete(t)
      saveLogins()
      delete users[who]
      save()
      message = L.deleted(who, path.join(path.basename(dir), who))
    }
    // after a POST back to the page, so F5 does not send the form again
    res.writeHead(303, { Location: '/?m=' + encodeURIComponent(message) })
    res.end()
  }

  // stop what nobody uses
  const idle = setInterval(() => {
    for (const [name, inst] of running) if (inst.open <= 0 && Date.now() - inst.last > cfg.idleMinutes * 60 * 1000) inst.child?.kill(), running.delete(name)
  }, 60 * 1000)
  idle.unref()

  // children go with this process, also on Ctrl-C
  process.on('exit', () => running.forEach((inst) => inst.child?.kill()))
  process.on('SIGINT', () => process.exit())
  process.on('SIGTERM', () => process.exit())

  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve))
  const frontOrigin = 'http://127.0.0.1:' + (front.address() as net.AddressInfo).port
  await new Promise<void>((resolve, reject) => admin.once('error', reject).listen(cfg.admin, '127.0.0.1', resolve))
  // Share and LAN, switched on the admin page too: off ends the open tabs
  let stopShare: (() => void) | null = null
  function setShare(on: boolean, fresh = false, L: Texts = TEXTS.en): string {
    if (stopShare && (!on || fresh)) stopShare(), (stopShare = null), (link = '')
    if (on && !stopShare) {
      const shared = share({ local: frontOrigin, proxy: frontOrigin, root: dir, page: cfg.share.page, web: cfg.share.web || otherOrigin(cfg.share.page), fresh })
      if ('holder' in shared) return L.holder(shared.holder)
      link = shared.link
      stopShare = shared.stop
    }
    cfg.share.on = on
    saveConfig()
    return on ? (fresh ? L.linkIsNew : L.shareIsOn) : L.shareIsOff
  }
  // --lan: the same front for browsers on the network of the school, no
  // share page and no internet needed. What only the share host may say is
  // dropped; the address is the one the browser used.
  const lanAddresses: string[] = []
  let lanFront: http.Server | null = null
  async function setLan(on: boolean, L: Texts = TEXTS.en): Promise<string> {
    if (lanFront && !on) {
      lanFront.close()
      lanFront.closeAllConnections()
      lanFront = null
      lanAddresses.length = 0
    }
    if (on && !lanFront) {
      const server = http.createServer((req, res) => {
        for (const h of ['x-lia-origin', 'x-lia-web-origin', 'x-lia-web', 'x-lia-token', 'x-lia-lan']) delete req.headers[h]
        req.headers['x-lia-lan'] = '1'
        req.headers['x-lia-origin'] = 'http://' + req.headers.host
        serve(req, res)
      })
      try {
        await new Promise<void>((resolve, reject) => server.once('error', reject).listen(cfg.lan.port, '0.0.0.0', resolve))
      } catch (e: any) {
        return e.code === 'EADDRINUSE' ? L.portBusy(cfg.lan.port) : L.lanFailed(e.message)
      }
      lanFront = server
      for (const [name, list] of Object.entries(os.networkInterfaces()))
        // docker0 and its bridges are no network of the school
        if (!/^(docker|br-|veth|virbr)/.test(name))
          for (const a of list || []) if (a.family === 'IPv4' && !a.internal) lanAddresses.push('http://' + a.address + ':' + cfg.lan.port + '/')
    }
    cfg.lan.on = on
    saveConfig()
    return on ? L.lanIsOn : L.lanIsOff
  }
  if (cfg.share.on) {
    const said = setShare(true, o.fresh)
    if (!link) throw new Error(said)
  }
  if (cfg.lan.on) {
    const said = await setLan(true)
    if (!lanFront) console.log('⚠️  ' + said)
  }
  console.log('👥 users in ' + dir + ' (' + Object.keys(users).length + ')')
  const adminUrl = 'http://localhost:' + cfg.admin + '/?k=' + cfg.key
  console.log('👥 admin page: ' + adminUrl)
  console.log('📚 courses from ' + cfg.courses + ' (' + courseList(cfg.courses).length + ')')
  if (cfg.kit) console.log('🧰 kit for authors: ' + cfg.kit + ' (' + KIT.filter((e) => fs.existsSync(path.join(cfg.kit as string, e))).join(', ') + ')')
  console.log(o.sandbox ? '🔒 every agent in bubblewrap, in the folder of its user' : '⚠️  no sandbox: the agents can read everything this user can')
  if (cfg.agent == 'claude' && !process.env.ANTHROPIC_API_KEY) {
    console.log('⚠️  no ANTHROPIC_API_KEY: every agent uses your own Claude login, and its limits')
  }
  for (const [role, model] of Object.entries(cfg.models)) console.log('🧠 ' + role + ': ' + model)
  // reachable through the share link, or on this machine with the headers it sets
  console.log('👥 front: ' + frontOrigin)
  if (link) console.log('🔗 share: ' + link)
  for (const a of lanAddresses) console.log('🏫 on the network of the school: ' + a)
  // the teacher need not type the address; not in a script (check.js)
  // a machine without xdg-open (over ssh) must not end the gateway
  if (process.stdout.isTTY)
    require('open')(adminUrl)
      .then((child: any) => child.on('error', () => {}))
      .catch(() => {})
}
