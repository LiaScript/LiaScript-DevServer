// --users DIR: one start for many users (see
// docs/superpowers/specs/2026-10-26-shared-devserver-webrtc-design.md). The
// share link (src/share.ts) leads to a front server here: who has no login
// gets the login page, everybody else a DevServer of their own, started on
// demand in DIR/<name> with its own agent (--agent, src/acp.ts) and stopped
// after IDLE_MS without an open tab. The admin page on localhost manages the
// users and shows who is where. The DevServer itself stays one user per
// process; this file only starts, routes and watches them.
import { spawn, ChildProcess } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as net from 'net'
import * as path from 'path'

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/
const ROLES = ['student', 'author']
const IDLE_MS = 15 * 60 * 1000
// wrong passwords in a row, then the name waits
const TRIES = 5
const LOCK_MS = 60 * 1000

// course: the folder of --courses it got a copy of, if any
type User = { salt: string; hash: string; role: string; created: string; course?: string }
type Instance = {
  child: ChildProcess
  ready: Promise<number>
  port: number
  token: string
  open: number // requests in flight, the event stream of an open tab among them
  last: number
}

type Options = {
  dir: string
  admin: number // port of the admin page
  agent: string
  courses: string // the folder whose subfolders the admin page offers as courses
  share?: (front: string) => string // starts the share host, returns the link
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

// the body of a form or of the login
async function form(req: http.IncomingMessage): Promise<URLSearchParams> {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 10000) break
  }
  return new URLSearchParams(body)
}

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
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'users.json')
  let users: { [name: string]: User } = {}
  try {
    users = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {}
  const save = () => fs.writeFileSync(file, JSON.stringify(users, null, 2), { mode: 0o600 })

  // login token -> name; in memory, a restart asks everybody to log in again
  const logins = new Map<string, string>()
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
    const input = fs.existsSync(path.join(home, 'README.md')) ? 'README.md' : '.'
    const inst: Instance = { child: null as any, ready: null as any, port: 0, token, open: 0, last: Date.now() }
    let child: ChildProcess
    inst.ready = starting = starting.then(async () => {
      while (!(await free(nextPort))) nextPort++
      const port = nextPort++
      child = spawn(process.execPath, [...self, '--agent', o.agent, '-p', String(port), '-i', input], {
        cwd: home,
        env: { ...process.env, LIA_TOKEN: token, LIA_GATEWAY: '1', LIA_ROLE: users[name].role },
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

  // ------------------------------------------------------------ the front

  function page(res: http.ServerResponse, title: string, body: string, status = 200) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
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

  const front = http.createServer(async (req, res) => {
    const base = /^https?:\/\/[\w.-]+(:\d+)?(\/[\w.~-]+)*$/.test(String(req.headers['x-lia-origin'])) ? String(req.headers['x-lia-origin']) : ''
    const name = logins.get(String(req.headers['x-lia-token'] || ''))

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
      console.log('👤 ' + who + ': logged in')
      // the share page sends it along with every request of this tab
      return page(
        res,
        'Angemeldet',
        `<script>sessionStorage.setItem('lia-share-token', ${JSON.stringify(token)}); location.replace(${JSON.stringify(base + '/')})</script>`,
      )
    }

    if (!name || !users[name]) {
      // a page in the frame gets the login, everything else waits for it
      const dest = String(req.headers['sec-fetch-dest'] || '')
      if (['document', 'iframe'].includes(dest) || String(req.headers.accept).includes('text/html')) return login(res, base)
      res.writeHead(401)
      return res.end()
    }

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
    const since = Date.now()
    // LIA_DEBUG=1: every request of a user and how long it stayed open
    if (process.env.LIA_DEBUG) console.log('🐞 ' + name + ' ' + req.method + ' ' + req.url + ' (' + (req.headers['sec-fetch-dest'] || '-') + ')')
    res.on('close', () => {
      inst.open--
      inst.last = Date.now()
      if (process.env.LIA_DEBUG) console.log('🐞 ' + name + ' closed ' + req.url + ' after ' + (Date.now() - since) + ' ms, ' + res.statusCode)
    })
    // the DevServer checks Host and Origin as for a tab of this machine
    const web = req.headers['x-lia-web'] === '1'
    const target = web ? (port < 45535 ? port + 20000 : port - 20000) : port
    const headers: any = { ...req.headers, host: 'localhost:' + target }
    if (headers.origin) headers.origin = 'http://localhost:' + target
    delete headers['x-lia-token']
    delete headers['x-lia-web']
    reach(target, req, res, headers)
  })

  // ------------------------------------------------------------ the admin page

  async function stateOf(inst: Instance): Promise<any> {
    if (!inst.port) return null
    try {
      const r = await fetch('http://127.0.0.1:' + inst.port + '/agent/state/' + inst.token, {
        headers: { host: 'localhost:' + inst.port },
        signal: AbortSignal.timeout(1000),
      })
      return r.ok ? await r.json() : null
    } catch (e) {
      return null
    }
  }

  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000)
    return m < 1 ? 'gerade' : 'vor ' + m + ' min'
  }

  async function rows() {
    const names = Object.keys(users).sort()
    const states = await Promise.all(names.map((n) => (running.get(n) ? stateOf(running.get(n)!) : null)))
    if (!names.length) return '<tr><td colspan="7">Noch keine Nutzer.</td></tr>'
    return names
      .map((n, i) => {
        const inst = running.get(n)
        const s = states[i]
        const online = !!inst && inst.open > 0
        const help = s && s.stuck && Date.now() - s.stuck.at < IDLE_MS
        const where = s ? (s.web ? '🌐 ' + s.web : (s.file || '') + (s.slide ? ' · Folie ' + s.slide : '') + (s.title ? ' · ' + s.title : '')) : ''
        return `<tr${help ? ' class="help"' : ''}><td><b>${esc(n)}</b><br><small>${esc(users[n].role === 'author' ? 'Autor' : 'Schüler')}</small></td>
<td>${online ? '🟢 online' : inst ? '🟡 läuft' : '⚪ aus'}<br><small>${inst ? esc(ago(inst.last)) : ''}</small></td>
<td>${users[n].course ? esc(users[n].course) : '<small>–</small>'}</td>
<td>${esc(where)}${help ? `<br><b>Braucht Hilfe</b> <small>${esc(ago(s.stuck.at))}, Folie ${esc(s.stuck.slide || '?')}</small>` : ''}</td>
<td>${s && s.session ? esc(s.session.count) + ' Einträge<br><a href="/chat/' + esc(n) + '" target="_blank">mitlesen</a>' : ''}</td>
<td><form method="post" action="/password/${esc(n)}"><input name="password" type="password" placeholder="neues Passwort" required minlength="6"><button>setzen</button></form></td>
<td><form method="post" action="/delete/${esc(n)}" onsubmit="return confirm('${esc(n)} löschen? Der Ordner bleibt erhalten.')"><button class="danger">löschen</button></form></td></tr>`
      })
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
button{background:var(--accent);border-color:var(--accent);color:#fff;cursor:pointer}button.danger{background:transparent;color:var(--bad);border-color:var(--bad)}
form.new{display:flex;flex-wrap:wrap;gap:8px}code{word-break:break-all}.msg{color:var(--accent)}</style></head><body><main>
<h1>LiaScript Klasse</h1>
<div class="card"><b>Link für alle:</b><br>${link ? `<code>${esc(link)}</code>` : 'nicht geteilt, mit <code>--share</code> starten'}</div>
${message ? `<p class="msg">${esc(message)}</p>` : ''}
<h2>Nutzer</h2><div class="card"><table><thead><tr><th>Name</th><th>Status</th><th>Kurs</th><th>Wo</th><th>Chat</th><th>Passwort</th><th></th></tr></thead><tbody id="rows">${table}</tbody></table></div>
<h2>Neuer Nutzer</h2><div class="card"><form class="new" method="post" action="/users">
<input name="name" placeholder="name (a-z, 0-9, - _)" required pattern="[a-z0-9][a-z0-9_-]{0,31}">
<input name="password" type="password" placeholder="Passwort" required minlength="6">
<select name="role"><option value="student">Schüler</option><option value="author">Autor</option></select>
<select name="course" title="Kopie eines Kurses aus ${esc(o.courses)}"><option value="">ohne Kurs (leerer Ordner)</option>${courseList(o.courses)
      .map((c) => `<option>${esc(c)}</option>`)
      .join('')}</select>
<button>anlegen</button></form></div>
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
    const text = (e: any) =>
      e.type === 'user' ? e.text : e.type === 'ai' ? e.markdown : e.type === 'answer' ? JSON.stringify(e.values) : e.label || e.cmd || ''
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chat: ${esc(name)}</title>
<style>:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1d2330;--card:#fff;--line:#d6dbe3;--me:#e6f4f1}@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e9ee;--card:#1d2128;--line:#343a45;--me:#173430}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:16px}
.e{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:8px 0;white-space:pre-wrap}.user{background:var(--me)}small{opacity:.7}</style></head><body><main>
<h1>Chat von ${esc(name)}</h1>${entries.length ? entries.map((e) => `<div class="e ${esc(e.type)}"><small>${esc(e.type === 'ai' ? (e.agent && e.agent.name) || 'KI' : name)} · ${esc(e.t ? new Date(e.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '')}</small>\n${esc(text(e))}</div>`).join('') : '<p>Noch kein Chat.</p>'}</main></body></html>`)
  }

  let link = ''
  const admin = http.createServer(async (req, res) => {
    const host = String(req.headers.host)
    // this machine only, and forms only from this page
    if (!['localhost:' + o.admin, '127.0.0.1:' + o.admin].includes(host) || (req.method === 'POST' && req.headers.origin !== 'http://' + host)) {
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
      else if (course && !courseList(o.courses).includes(course)) message = 'Den Kurs ' + course + ' gibt es in ' + o.courses + ' nicht.'
      else {
        const home = path.join(dir, name)
        // ponytail: a copy; later a git clone, so that an update can merge
        if (course)
          fs.cpSync(path.join(o.courses, course), home, {
            recursive: true,
            filter: (src) => !/(^|[/\\])(\.git|\.chats|node_modules)$/.test(src),
          })
        fs.mkdirSync(home, { recursive: true })
        const salt = crypto.randomBytes(16).toString('hex')
        users[name] = { salt, hash: hash(password, salt), role, created: new Date().toISOString(), ...(course ? { course } : {}) }
        save()
        message = name + ' ist angelegt' + (course ? ', mit einer Kopie von ' + course : '') + '.'
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
        message = 'Neues Passwort für ' + who + ' gesetzt.'
      }
    } else if (action === 'delete' && users[who]) {
      running.get(who)?.child?.kill()
      for (const [t, n] of logins) if (n === who) logins.delete(t)
      delete users[who]
      save()
      message = who + ' ist gelöscht, der Ordner ' + path.join(dir, who) + ' bleibt.'
    }
    // after a POST back to the page, so F5 does not send the form again
    res.writeHead(303, { Location: '/?m=' + encodeURIComponent(message) })
    res.end()
  })

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
  await new Promise<void>((resolve, reject) => admin.once('error', reject).listen(o.admin, '127.0.0.1', resolve))
  link = o.share ? o.share(frontOrigin) : ''
  console.log('👥 users in ' + dir + ' (' + Object.keys(users).length + ')')
  console.log('👥 admin page: http://localhost:' + o.admin + '/')
  console.log('📚 courses from ' + o.courses + ' (' + courseList(o.courses).length + ')')
  // reachable through the share link, or on this machine with the headers it sets
  console.log('👥 front: ' + frontOrigin)
  if (link) console.log('🔗 share: ' + link)
}
