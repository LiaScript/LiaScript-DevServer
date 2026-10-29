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
      child = spawn(process.execPath, [...self, '--agent', cfg.agent, '-p', String(port), '-i', input], {
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
        child.stdout!.on('data', (d) => {
          out += d
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
  const jobs = new Map<string, { what: string; done: number; total: number }>()
  // the outcome of the jobs for the admin page, the newest last
  const notices: { t: number; text: string; bad?: boolean }[] = []
  const notice = (text: string, bad = false) => {
    notices.push({ t: Date.now(), text, bad })
    if (notices.length > 10) notices.shift()
    ;(bad ? console.error : console.log)('👥 ' + text)
  }

  // A course update for a user (also the first copy): their DevServer stops,
  // its agent must not work on files that change; the next request starts it
  // again. In the background, a course of gigabytes takes minutes.
  const baseKitOf = (name: string) => path.join(dir, '.base-kit', name)
  async function updateCourse(name: string, first = false) {
    if (jobs.has(name)) return
    running.get(name)?.child?.kill()
    const what = [users[name].course && 'Kurs ' + users[name].course, users[name].kit && cfg.kit && 'Teaching-Agent'].filter(Boolean).join(' und ')
    const job = { what: first ? what + ' wird kopiert' : what + ' wird aktualisiert', done: 0, total: 0 }
    jobs.set(name, job)
    try {
      fs.mkdirSync(path.join(dir, name), { recursive: true })
      const step = (done: number, total: number) => ((job.done = done), (job.total = total))
      const none = { updated: [] as string[], added: [] as string[], removed: [] as string[], conflicts: [] as string[] }
      const c = hasCourse(name) ? await syncCourse(users[name].source as string, baseOf(name), path.join(dir, name), undefined, step) : none
      const k = users[name].kit && cfg.kit ? await syncCourse(cfg.kit, baseKitOf(name), path.join(dir, name), KIT, step) : none
      notice(report(name, what, c, k, first))
    } catch (e: any) {
      notice('Fehler bei ' + name + ': ' + e.message, true)
    } finally {
      jobs.delete(name)
    }
  }

  function report(name: string, what: string, c: any, k: any, first: boolean) {
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
    if (first) return name + ': ' + what + ' ist bereit (' + r.added.length + ' Dateien).'
    return name + ': ' + (parts.join(', ') || 'nichts Neues') + (r.conflicts.length ? ', Konflikte: ' + r.conflicts.join(', ') : '')
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

  function login(res: http.ServerResponse, base: string, message = '') {
    page(
      res,
      'Anmelden',
      `<form method="post" action="${esc(base)}/lia-login"><h1>LiaScript</h1>
<input name="name" autocomplete="username" placeholder="Nutzername" required autofocus>
<input name="password" type="password" autocomplete="current-password" placeholder="Passwort" required>
${message ? `<p class="bad">${esc(message)}</p>` : ''}<button>Anmelden</button></form>`,
      message ? 401 : 200,
    )
  }

  async function serve(req: http.IncomingMessage, res: http.ServerResponse) {
    const lan = req.headers['x-lia-lan'] === '1'
    const base = /^https?:\/\/[\w.-]+(:\d+)?(\/[\w.~-]+)*$/.test(String(req.headers['x-lia-origin'])) ? String(req.headers['x-lia-origin']) : ''
    // the share page sends the login as a header, a browser on the network a cookie
    const cookie = lan && /(?:^|;\s*)lia=([0-9a-f]{32})/.exec(String(req.headers.cookie || ''))
    const presented = String(req.headers['x-lia-token'] || (cookie && cookie[1]) || '')
    const name = (since.get(presented) || 0) > Date.now() - LOGIN_MS ? logins.get(presented) : undefined

    if (req.url === '/lia-login' && req.method === 'POST') {
      const f = await form(req)
      const who = String(f.get('name') || '').trim().toLowerCase()
      const lock = failed.get(who)
      if (lock && lock.until > Date.now()) return login(res, base, 'Zu viele Versuche, bitte eine Minute warten.')
      const user = users[who]
      const ok =
        !!user &&
        crypto.timingSafeEqual(Buffer.from(hash(String(f.get('password') || ''), user.salt), 'hex'), Buffer.from(user.hash, 'hex'))
      if (!ok) {
        // a lock that ran out starts the count again, no lock goes on counting
        const n = (!lock || (lock.until && lock.until <= Date.now()) ? 0 : lock.n) + 1
        failed.set(who, { n, until: n >= TRIES ? Date.now() + LOCK_MS : 0 })
        return login(res, base, 'Name oder Passwort stimmt nicht.')
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
      if (['document', 'iframe'].includes(dest) || String(req.headers.accept).includes('text/html')) return login(res, base)
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
      return page(
        res,
        'Einen Moment',
        `<form><h1>Einen Moment …</h1><p>Dein Kurs wird vorbereitet${esc(share)}. Die Seite lädt gleich von selbst neu.</p></form><script>setTimeout(function(){location.reload()},3000)</script>`,
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

  // what the agents of a user cost, all their sessions (src/acp.ts writes it)
  const costOf = (name: string) => {
    try {
      const sum: { [currency: string]: number } = {}
      for (const c of Object.values(JSON.parse(fs.readFileSync(path.join(dir, name, '.chats', '.acp-costs.json'), 'utf8'))) as any[]) {
        sum[c.currency] = (sum[c.currency] || 0) + c.amount
      }
      return Object.entries(sum)
        .map(([currency, amount]) => amount.toLocaleString('de-DE', { style: 'currency', currency, maximumFractionDigits: 4 }))
        .join(', ')
    } catch (e) {
      return ''
    }
  }

  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000)
    return m < 1 ? 'gerade' : 'vor ' + m + ' min'
  }

  async function rows() {
    const names = Object.keys(users).sort()
    const states = await Promise.all(names.map((n) => (running.get(n) ? stateOf(running.get(n)!) : null)))
    if (!names.length) return '<tr><td colspan="9">Noch keine Nutzer, unten unter „Neuer Nutzer“ anlegen.</td></tr>'
    return names
      .map((n, i) => {
        const inst = running.get(n)
        const s = states[i]
        const online = !!inst && inst.open > 0
        const help = s && s.stuck && Date.now() - s.stuck.at < IDLE_MS
        // the title is "slide · course", the course has a column of its own; README.md says nothing to a teacher
        const slide = s && String(s.title || '').split(' · ')
        const where = s
          ? s.web
            ? '🌐 ' + s.web
            : [s.file !== 'README.md' && s.file, s.slide && 'Folie ' + s.slide + (s.title ? ': ' + (slide.length > 1 ? slide.slice(0, -1).join(' · ') : s.title) : '')]
                .filter(Boolean)
                .join(' · ')
          : ''
        return `<tr${help ? ' class="help"' : ''}><td><b>${esc(n)}</b><br><small>${esc(users[n].role === 'author' ? 'Autor' : 'Schüler')}</small></td>
<td>${online ? '🟢 online' : inst ? '<span title="angemeldet, die Seite ist aber zu">🟡 Seite zu</span>' : '⚪ aus'}<br><small>${inst ? esc(ago(inst.last)) : ''}</small></td>
<td>${
          jobs.get(n)
            ? `${esc(jobs.get(n)!.what)}<br><small>${jobs.get(n)!.total ? esc(jobs.get(n)!.done + ' von ' + jobs.get(n)!.total + ' Dateien') : 'beginnt …'}</small>`
            : users[n].course || users[n].kit
            ? esc(users[n].course || '') +
              (users[n].kit ? `<br><small>+ Teaching-Agent</small>` : '') +
              `<form method="post" action="/update/${esc(n)}"><button class="quiet">aktualisieren</button></form>`
            : `<form method="post" action="/assign/${esc(n)}"><select name="course"><option value="">–</option>${courseList(cfg.courses)
                .map((c) => `<option>${esc(c)}</option>`)
                .join('')}</select><button class="quiet">zuweisen</button></form>`
        }</td>
<td>${esc(where)}${help ? `<br><b>Braucht Hilfe</b> <small>${esc(ago(s.stuck.at))}, Folie ${esc(s.stuck.slide || '?')}</small>` : ''}</td>
<td>${s && s.session ? esc(s.session.count) + ' Einträge<br>' : ''}<a href="/chat/${esc(n)}" target="_blank">mitlesen</a></td>
<td>${esc(costOf(n)) || '<small>–</small>'}</td>
<td><form method="post" action="/password/${esc(n)}"><input name="password" type="password" placeholder="neues Passwort" required minlength="6"><button>setzen</button></form></td>
<td><form method="post" action="/mute/${esc(n)}"><button class="quiet">${settings.muted.includes(n) ? '🔇 stumm' : '🔈 darf schreiben'}</button></form></td>
<td><form method="post" action="/delete/${esc(n)}" onsubmit="return confirm('${esc(n)} löschen? Der Ordner bleibt erhalten.')"><button class="danger">löschen</button></form></td></tr>`
      })
      .join('')
  }

  // the class channel for the teacher: every message, also between users
  const label = (n: string) => (n === TEACHER ? 'Lehrkraft' : n === ALL ? 'alle' : n)
  function classLog() {
    if (!messages.length) return '<p><small>Noch keine Nachrichten.</small></p>'
    return messages
      .slice(-100)
      .reverse()
      .map(
        (m) =>
          `<div class="m${m.from === TEACHER ? ' me' : ''}"><small>${esc(label(m.from))} → ${esc(label(m.to))} · ${esc(
            new Date(m.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
          )}</small><br>${esc(m.text)}</div>`,
      )
      .join('')
  }

  function adminPage(res: http.ServerResponse, link: string, table: string, message = '') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LiaScript Klasse</title>
<style>:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1d2330;--muted:#5b6474;--card:#fff;--line:#d6dbe3;--accent:#0f766e;--help:#fde7e4;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e9ee;--muted:#9aa3b2;--card:#1d2128;--line:#343a45;--accent:#2dd4bf;--help:#3b1d1b;--bad:#f97066}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}small{color:var(--muted)}a{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;overflow-x:auto}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}tr.help{background:var(--help)}
input,select,button{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button{background:var(--accent);border-color:var(--accent);color:#fff;cursor:pointer}button.danger{background:transparent;color:var(--bad);border-color:var(--bad)}button.quiet{background:transparent;color:var(--fg);border-color:var(--line)}
.m{border:1px solid var(--line);border-radius:10px;padding:6px 10px;margin:6px 0;white-space:pre-wrap}.m.me{border-color:var(--accent)}#log{max-height:40vh;overflow:auto}
form.say{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}form.say textarea{flex:1;min-width:200px;font:inherit;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
form.new{display:flex;flex-wrap:wrap;gap:8px}code{word-break:break-all}.msg{color:var(--accent)}.bad{color:var(--bad);font-weight:600}</style></head><body><main>
<h1>LiaScript Klasse</h1>
<div class="card"><b>Adresse für die Schüler</b>${link ? `<br>von überall: <code>${esc(link)}</code>` : ''}${
      lanAddresses.length ? '<br>im Schulnetz: ' + lanAddresses.map((a) => `<code>${esc(a)}</code>`).join(' ') : ''
    }${link || lanAddresses.length ? '' : '<br><small>noch keine: den Server mit <code>--lan</code> (Schulnetz) oder <code>--share</code> (Internet) starten</small>'}</div>
${message ? `<p class="msg">${esc(message)}</p>` : ''}${notices
      .slice(-5)
      .reverse()
      .map((n) => `<p class="${n.bad ? 'bad' : 'msg'}"><small>${esc(new Date(n.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))}</small> ${esc(n.text)}</p>`)
      .join('')}
<h2>Nutzer</h2><div class="card"><form method="post" action="/update/all" style="margin-bottom:8px"><button class="quiet">Kurs-Updates an alle verteilen</button></form><table><thead><tr><th>Name</th><th>Status</th><th>Kurs</th><th>Wo</th><th>Chat</th><th>Kosten</th><th>Passwort</th><th>Klasse</th><th></th></tr></thead><tbody id="rows">${table}</tbody></table></div>
<h2>Klasse</h2><div class="card">
<form class="say" method="post" action="/class/say"><select name="to"><option value="${ALL}">an alle</option>${Object.keys(users)
      .sort()
      .map((n) => `<option value="${esc(n)}">an ${esc(n)}</option>`)
      .join('')}</select><textarea name="text" rows="2" required maxlength="2000" placeholder="Nachricht an die Klasse …"></textarea><button>senden</button></form>
<form method="post" action="/class/dm"><label><input type="checkbox" name="on" value="1"${settings.dm ? ' checked' : ''} onchange="this.form.submit()"> Schüler dürfen einander schreiben</label></form>
<div id="log">${classLog()}</div></div>
<h2>Neuer Nutzer</h2><div class="card"><form class="new" method="post" action="/users">
<input name="name" placeholder="Name, z. B. mia" required pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,31}" title="Buchstaben ohne Umlaute, Ziffern, - und _, keine Leerzeichen">
<input name="password" type="password" placeholder="Passwort, mind. 6 Zeichen" required minlength="6">
<select name="role"><option value="student">Schüler</option><option value="author">Autor</option></select>${
      cfg.kit ? '<label title="Die Anweisungen und Specs des Teaching-Agent in den Ordner, für Autoren"><input type="checkbox" name="kit" value="1"> mit Teaching-Agent</label>' : ''
    }
<select name="course" title="Kopie eines Kurses aus ${esc(cfg.courses)}"><option value="">ohne Kurs (leerer Ordner)</option>${courseList(cfg.courses)
      .map((c) => `<option>${esc(c)}</option>`)
      .join('')}</select>
<button>anlegen</button></form></div>
<script>setInterval(function(){fetch('/class/log').then(function(r){return r.text()}).then(function(t){document.getElementById('log').innerHTML=t})},5000)</script>
<script>setInterval(function(){fetch('/rows').then(function(r){return r.text()}).then(function(t){if(!document.activeElement||!document.getElementById('rows').contains(document.activeElement))document.getElementById('rows').innerHTML=t})},5000)</script>
</main></body></html>`)
  }

  function chatPage(res: http.ServerResponse, name: string) {
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chat: ${esc(name)}</title>
<style>:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1d2330;--card:#fff;--line:#d6dbe3;--me:#e6f4f1}@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e9ee;--card:#1d2128;--line:#343a45;--me:#173430}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:16px}
.e{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:8px 0;white-space:pre-wrap}.user{background:var(--me)}small{opacity:.7}</style></head><body><main>
<h1>Chat von ${esc(name)}</h1>${entries.length ? entries.map((e) => `<div class="e ${esc(e.type)}"><small>${esc(e.type === 'ai' ? (e.agent && (e.agent.label || e.agent.name)) || 'KI' : name)} · ${esc(e.t ? new Date(e.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '')}</small>\n${esc(text(e))}</div>`).join('') : '<p>Noch kein Chat.</p>'}</main></body></html>`)
  }

  let link = ''
  const admin = http.createServer((req, res) =>
    adminRoute(req, res).catch((e: any) => {
      notice('Fehler: ' + e.message, true)
      if (!res.headersSent) res.writeHead(303, { Location: '/?m=' + encodeURIComponent('Fehler: ' + e.message) })
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
    const [, action, who] = /^\/(\w+)?\/?([^/?]*)/.exec(req.url || '') || []

    if (req.method === 'GET' && !action) {
      const message = new URL(req.url || '/', 'http://localhost').searchParams.get('m') || ''
      return rows().then((t) => adminPage(res, link, t, message))
    }
    if (req.method === 'GET' && action === 'rows') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(await rows())
    }
    if (req.method === 'GET' && action === 'chat' && users[who]) return chatPage(res, who)
    if (req.method === 'GET' && action === 'class' && who === 'log') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(classLog())
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
      if (!NAME.test(name)) message = 'Der Name darf nur a-z, 0-9, - und _ enthalten.'
      else if (users[name]) message = name + ' gibt es schon.'
      else if (password.length < 6) message = 'Das Passwort braucht mindestens 6 Zeichen.'
      else if (!ROLES.includes(role)) message = 'Unbekannte Rolle.'
      // only a course of the list: no path from the form ever reaches the disk
      else if (course && !courseList(cfg.courses).includes(course)) message = 'Den Kurs ' + course + ' gibt es in ' + cfg.courses + ' nicht.'
      else {
        fs.mkdirSync(path.join(dir, name), { recursive: true })
        const kit = !!cfg.kit && f.get('kit') === '1'
        const salt = crypto.randomBytes(16).toString('hex')
        users[name] = { salt, hash: hash(password, salt), role, created: new Date().toISOString(), ...(course ? { course, source: path.join(cfg.courses, course) } : {}), ...(kit ? { kit } : {}) }
        save()
        // the copy in the background, the page shows how far it is
        if (course || kit) void updateCourse(name, true)
        message = name + ' ist angelegt' + (course || kit ? ', ' + [course, kit && 'Teaching-Agent'].filter(Boolean).join(' und ') + ' wird kopiert …' : '.')
      }
    } else if (action === 'password' && users[who]) {
      const password = String(f.get('password') || '')
      if (password.length < 6) message = 'Das Passwort braucht mindestens 6 Zeichen.'
      else {
        users[who].salt = crypto.randomBytes(16).toString('hex')
        users[who].hash = hash(password, users[who].salt)
        save()
        // logged in with the old one: out
        for (const [t, n] of logins) if (n === who) logins.delete(t)
        saveLogins()
        message = 'Neues Passwort für ' + who + ' gesetzt.'
      }
    } else if (action === 'update' && who === 'all') {
      const list = Object.keys(users).filter(
        (n) => hasCourse(n) || (users[n].kit && cfg.kit),
      )
      // one after the other, a class at once would read the course 30 times in parallel
      void (async () => {
        for (const n of list) await updateCourse(n)
      })()
      message = list.length ? 'Updates laufen für ' + list.join(', ') + ' …' : 'Niemand hat einen Kurs.'
    } else if (action === 'update' && users[who] && (users[who].course || users[who].kit)) {
      void updateCourse(who)
      message = 'Update für ' + who + ' läuft …'
    } else if (action === 'assign' && users[who] && !users[who].course) {
      const course = String(f.get('course') || '')
      if (!courseList(cfg.courses).includes(course)) message = 'Bitte einen Kurs wählen.'
      else {
        users[who].course = course
        users[who].source = path.join(cfg.courses, course)
        save()
        void updateCourse(who, true)
        message = course + ' wird für ' + who + ' kopiert …'
      }
    } else if (action === 'settings' && who === 'share') {
      message = setShare(f.get('on') === '1')
    } else if (action === 'settings' && who === 'share-new') {
      message = setShare(true, true)
    } else if (action === 'settings' && who === 'lan') {
      const port = Number(f.get('port') || cfg.lan.port)
      if (Number.isInteger(port) && port > 0 && port < 65536 && port !== cfg.lan.port) {
        // a new port: the old server goes first
        if (lanFront) await setLan(false)
        cfg.lan.port = port
      }
      message = await setLan(f.get('on') === '1')
    } else if (action === 'class' && who === 'say') {
      const to = String(f.get('to') || ALL)
      const text = String(f.get('text') || '').trim()
      if (text && text.length <= 2000 && (to === ALL || users[to])) post(TEACHER, to, text), (message = 'Gesendet an ' + (to === ALL ? 'alle' : to) + '.')
    } else if (action === 'class' && who === 'dm') {
      settings.dm = f.get('on') === '1'
      saveSettings()
      classChanged()
      message = settings.dm ? 'Schüler dürfen einander schreiben.' : 'Schüler schreiben nur noch der Lehrkraft.'
    } else if (action === 'mute' && users[who]) {
      settings.muted = settings.muted.includes(who) ? settings.muted.filter((n) => n !== who) : [...settings.muted, who]
      saveSettings()
      classChanged()
      message = who + (settings.muted.includes(who) ? ' ist stummgeschaltet.' : ' darf wieder schreiben.')
    } else if (action === 'delete' && users[who]) {
      running.get(who)?.child?.kill()
      for (const [t, n] of logins) if (n === who) logins.delete(t)
      saveLogins()
      delete users[who]
      save()
      message = who + ' ist gelöscht, der Ordner ' + path.join(path.basename(dir), who) + ' bleibt.'
    }
    // after a POST back to the page, so F5 does not send the form again
    res.writeHead(303, { Location: '/?m=' + encodeURIComponent(message) })
    res.end()
  }

  // stop what nobody uses
  const idle = setInterval(() => {
    for (const [name, inst] of running) if (inst.open <= 0 && Date.now() - inst.last > IDLE_MS) inst.child?.kill(), running.delete(name)
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
  function setShare(on: boolean, fresh = false): string {
    if (stopShare && (!on || fresh)) stopShare(), (stopShare = null), (link = '')
    if (on && !stopShare) {
      const shared = share({ local: frontOrigin, proxy: frontOrigin, root: dir, page: cfg.share.page, web: cfg.share.web || otherOrigin(cfg.share.page), fresh })
      if ('holder' in shared) return 'Ein anderes Programm (pid ' + shared.holder + ') teilt diesen Klassenordner schon.'
      link = shared.link
      stopShare = shared.stop
    }
    cfg.share.on = on
    saveConfig()
    return on ? (fresh ? 'Neuer Link: der alte geht nicht mehr.' : 'Zugang über das Internet ist an.') : 'Zugang über das Internet ist aus.'
  }
  // --lan: the same front for browsers on the network of the school, no
  // share page and no internet needed. What only the share host may say is
  // dropped; the address is the one the browser used.
  const lanAddresses: string[] = []
  let lanFront: http.Server | null = null
  async function setLan(on: boolean): Promise<string> {
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
        return e.code === 'EADDRINUSE' ? 'Port ' + cfg.lan.port + ' ist belegt, ein anderes Programm nutzt ihn. Bitte einen anderen Port wählen.' : 'Schulnetz geht nicht: ' + e.message
      }
      lanFront = server
      for (const [name, list] of Object.entries(os.networkInterfaces()))
        // docker0 and its bridges are no network of the school
        if (!/^(docker|br-|veth|virbr)/.test(name))
          for (const a of list || []) if (a.family === 'IPv4' && !a.internal) lanAddresses.push('http://' + a.address + ':' + cfg.lan.port + '/')
    }
    cfg.lan.on = on
    saveConfig()
    return on ? 'Zugang im Schulnetz ist an.' : 'Zugang im Schulnetz ist aus.'
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
  console.log('👥 admin page: http://localhost:' + cfg.admin + '/')
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
  if (process.stdout.isTTY) require('open')('http://localhost:' + cfg.admin + '/')
}
