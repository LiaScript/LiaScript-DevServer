import * as express from 'express'

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
const packageJson = require('../package.json')
import { EventEmitter } from 'events'

import * as chats from './chats'
import * as git from './git'
import * as web from './web'
import { startFull, Full } from './full'

const cors = require('cors')
const handlebars = require('express-handlebars')
const open = require('open')
const reload = require('reload')
const chokidar = require('chokidar')

// a request of the page itself. A browser with the referrer policy
// no-referrer (hardened Firefox) sends Origin: null even then, but never
// leaves out Sec-Fetch-Site, which no page can set.
export function sameOrigin(req: http.IncomingMessage) {
  const origin = req.headers.origin
  return origin === 'http://' + req.headers.host || ((!origin || origin === 'null') && req.headers['sec-fetch-site'] === 'same-origin')
}

const app: express.Application = express()
app.use(express.json())
app.locals.version = packageJson.version

var dirname = ''
var node_modules
var liascriptPath = ''
// @liascript/chat: renders the messages of the chat shell as LiaScript
var liachatPath = ''
var reloadInstance: any = null
var watcher: any = null

// file types that trigger a live reload, unless start() gets its own list
export const WATCH = [
  'md',
  'html',
  'htm',
  'js',
  'css',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'bmp',
  'ico',
  'mp4',
  'webm',
  'ogv',
  'ogg',
  'mov',
  'm4v',
]

var clients: any[] = []

// agent bridge (--mcp): what the browser last reported, and the events it sends.
// Never emit an event named 'error' on the bus, an unhandled one throws.
export const bus = new EventEmitter()

var origin = ''
var home = ''

// The addresses the browser sees: --share (src/share.ts) names those of its
// page (x-lia-origin) and of the page for web pages (x-lia-web-origin), with
// the folder of the page (https://liascript.github.io/share), a tab on this
// machine sees ours. Every path the server hands out starts with it.
function validOrigin(o: any) {
  return typeof o == 'string' && /^https?:\/\/[\w.-]+(:\d+)?(\/[\w.~-]+)*$/.test(o) ? o : ''
}
function originOf(req: express.Request) {
  return validOrigin(req.headers['x-lia-origin']) || origin
}

// the servers for src/share.ts, and the link it hands out
var shared = ''
export function localOrigin(link?: string) {
  if (link) shared = link
  return origin
}
export function proxyOrigin() {
  return proxyMode == 'read' ? webOrigin : ''
}
// in agent mode the chat shell, which shows the player in an iframe
var player = '/liascript/index.html'
// --test: the course in the player of the LiaScript website
const ONLINE = 'https://LiaScript.github.io/course/'
// web: the address of a web page the shell shows instead of a course
const state = { root: '', file: '', slide: 1, title: '', selection: '', web: '' }
// the proxy of the web pages, a server and origin of its own (src/web.ts),
// or hammerhead's with --proxy full (src/full.ts)
export const PROXY = ['off', 'read', 'full']
var proxyMode = 'read'
var webOrigin = ''
var webServer: http.Server | null = null
var fullProxy: Full | null = null

// the course file of --input, relative to root, '' for a folder: what the
// agent reads before a browser reports which file it shows
var inputFile = ''
export function inputCourse() {
  return inputFile
}

// What the browser says about text-to-speech, kept out of state, which is the
// context of every event. voices: number of speechSynthesis voices, -1 until a
// browser reported. automated: navigator.webdriver, a browser driven by
// Playwright or Puppeteer. fallback: responsiveVoice is loaded in the player,
// which --responsiveVoice only achieves with a valid key. names: the voices in
// the language of the course, for an agent to pick its own (set_agent voice).
const speech = { voices: -1, automated: false, fallback: false, names: [] as string[] }
// navigator.language: an agent greets in it before the course says its own
var browserLang = ''

// Who the user talks to: the agents of a workflow, each with an emoji that the
// chat shows on its button and under every message. Kept out of state too.
// label: what the user reads instead of the name, e.g. "Planungsassistent"
// persona: a historical person of src/teachers/ the chat shows instead of the robot
// voice: the name of a speech voice of the browser this agent reads aloud with
export type Agent = { name: string; emoji: string; label?: string; persona?: string; voice?: string }
// view: author shows every agent of the roster, learner only the current
// one, with a larger portrait (a teacher persona in front of learners)
export type View = 'author' | 'learner'
const agents = { current: '', list: [] as Agent[], view: 'author' as View }

export function currentAgent(): Agent | undefined {
  return agents.list.find((a) => a.name === agents.current)
}

// list replaces the roster, name has to be in it (the caller checks that)
export function setAgent(name: string, list?: Agent[], view?: View) {
  if (list) agents.list = list
  if (view) agents.view = view
  agents.current = name
  send(agentsMessage())
}

// The chat the user sees, saved in .chats/ of the project (see chats.ts):
// continued after F5 and after a restart, until the user starts a new one.
// The progress line is no part of it, a reloaded shell gets it from here.
var session: chats.Session | null = null
var progress = ''

// The one form the user can still answer: the newest one of this process.
// A newer form replaces it, so an old "Save" cannot save an old draft, and a
// form from before a restart was asked by an agent that is gone.
var openAsk = ''

function openIn(chat: chats.Session) {
  return openAsk && chat.entries.some((e) => e.ask === openAsk) ? openAsk : undefined
}

// the agent withdraws the open form, returns its id or ''. The reason shows
// under the form: a form closed without one looked like a refusal.
export function closeForm(reason?: string) {
  const closed = openAsk
  openAsk = ''
  if (closed) send(reason ? { closed, reason } : { closed })
  return closed
}

// user entries of the chat after entry n: what came while the agent wrote
export function newerThan(n: number) {
  if (!session) return 0
  return session.entries.slice(n + 1).filter((e) => e.type !== 'ai').length
}

// Is anybody there? A plain "Thinking…" kept users waiting for minutes while
// no agent listened, or while one waited for a permission in the terminal.
// So the progress line says only what the server knows: the message waits,
// an agent took it (adapters call activity() on every tool call and when they
// hand an event over, a watcher of the event stream counts too), and after a
// while without any sign of the agent a hint below it says so.
const WAITING = 'Waiting for the assistant…'
// for a learner who is stuck, see needsHelp()
const LOOKING = 'Looking at your answer…'
const THINKING = 'Thinking…'
const NO_REACTION_MS = 30000
// the server cannot know whether an idle agent listens (a channel wakes it)
const NO_REACTION =
  'The assistant has not reacted yet, maybe it is not connected. The message is saved, it answers once it starts.'
const NOT_YET = 'The assistant has not reacted yet.'
const QUIET_MS = 60000
// nothing about a permission prompt: it worried users while the agent worked
const QUIET = 'The assistant is still working, this can take a while.'
// an event waits for the first sign of an agent
var pending = false
var hint = ''
var quiet: any = null

export function activity() {
  pending = false
  if (progress === WAITING || progress === LOOKING) send({ status: THINKING })
  else watchQuiet()
}

// A learner who is stuck gets help without asking: the 3rd wrong check of a
// quiz, giving up on it, or the 3rd failed run of a code block. Once per
// task until it is solved, the same wrong answer seven times is one call.
const HELP_AFTER = 3
const helped = new Set<string>()

function needsHelp(p: { [key: string]: string | string[] }, file: string) {
  // slide in the course, chat the number of a message in the chat
  const key = [file, p.kind, p.slide, p.chat, p.block].join(':')
  if (p.solved === 'solved' || p.ok === 'true') {
    helped.delete(key)
    return false
  }
  const stuck =
    p.solved === 'resolved' ||
    (p.kind === 'quiz' && Number(p.trial) >= HELP_AFTER) ||
    (p.kind === 'code' && Number(p.runs) >= HELP_AFTER)
  if (!stuck || helped.has(key)) return false
  helped.add(key)
  return true
}

// One reload for a burst of changes, and while an agent works (a progress line
// shows, and it reacted) at most every HOLD_MS: an agent that edits section by section made
// the preview flicker and lose its scroll position with every step. The end of
// the progress line, usually its answer, reloads at once.
const BURST_MS = 300
const HOLD_MS = 30000
// when the first change since the last reload came, 0 for none
var changedAt = 0
var reloading: any = null

function changed() {
  if (!changedAt) changedAt = Date.now()
  reloadLater(BURST_MS)
}

function reloadLater(ms: number) {
  clearTimeout(reloading)
  reloading = setTimeout(reloadNow, ms)
  if (reloading.unref) reloading.unref()
}

function reloadNow() {
  if (!changedAt || !reloadInstance) return
  const held = Date.now() - changedAt
  // not for a message that waits for an agent, nobody works on it yet
  if (progress && !pending && held < HOLD_MS) return reloadLater(HOLD_MS - held)
  changedAt = 0
  console.log('🔄 reloading')
  reloadInstance.reload()
  // the WebSocket of reload does not pass the tunnel of --share, its stream does
  clients.forEach((client) => client.remote && client.write('data: {"reload":true}\n\n'))
}

// Does the preview show this file? Another Markdown file changes nothing in
// it, and a reload reset the quizzes the user was answering: an agent writes
// journal.md while the user tries README.md. A file the shown one names
// (import:) counts as shown, so does everything that is no Markdown.
function shows(filePath: string) {
  if (!filePath.endsWith('.md')) return true
  if (!state.file) return false
  const file = path.join(state.root, state.file)
  if (path.resolve(filePath) === file) return true
  try {
    return fs.readFileSync(file, 'utf8').includes(path.basename(filePath))
  } catch (e) {
    return true
  }
}

// restarts the clock whenever something happens while a progress line shows
function watchQuiet() {
  clearTimeout(quiet)
  if (hint) send({ hint: (hint = '') })
  if (!progress) return
  quiet = setTimeout(
    () =>
      send({
        hint: (hint = pending ? (progress === LOOKING ? NOT_YET : NO_REACTION) : QUIET),
      }),
    pending ? NO_REACTION_MS : QUIET_MS,
  )
  // a pending hint must not keep a stopped server alive
  if (quiet.unref) quiet.unref()
}

// the tables of @liascript/chat that the chat file keeps. Code brings every
// version and its output: ponytail: a block over the cap is not saved,
// trim old versions if that happens. express.json() takes 100 kB.
const STORED = ['quiz', 'survey', 'task', 'code']
const STORE_MAX = 90000

// returns the entry as saved, with its time
function record(entry: { type: string; [key: string]: any }) {
  if (!session) return
  const before = session.entries.length ? chats.title(session) : ''
  if (!session.file) session.file = state.file
  try {
    chats.append(session, entry)
  } catch (e: any) {
    console.warn('chat not saved:', e.message)
  }
  // a new session or a new title for the menu
  if (chats.title(session) !== before) send({ sessions: chats.list() })
  return session.entries[session.entries.length - 1]
}

function sessionMessage() {
  return {
    session: { id: session!.id, entries: session!.entries, open: openIn(session!), db: session!.db },
  }
}

export function readChat(id?: string) {
  const chat = id === undefined || (session && id === session.id) ? session : chats.load(id)
  return chat
    ? { ...chats.summary(chat), file: chat.file, open: openIn(chat), entries: chat.entries }
    : undefined
}

function agentsMessage() {
  return { agents: { current: currentAgent() || null, list: agents.list, view: agents.view } }
}

// Automation tools start Chrome with this flag, which takes away its online
// voices (checked with Playwright MCP 0.0.83 and Chrome 154).
const NO_VOICES_FLAG = '--disable-component-extensions-with-background-pages'

function ttsHint() {
  if (speech.voices !== 0 || speech.fallback) return undefined

  const silent =
    'The browser has no speech voices, so LiaScript cannot read the course aloud (narrator, play buttons, spoken comments). '
  const fallback =
    ' Alternatively start the devServer with --responsiveVoice <key> and a valid key of that service, it needs no browser voices.'

  if (speech.automated) {
    return (
      silent +
      'It is driven by an automation tool, and those start Chrome with ' +
      NO_VOICES_FLAG +
      ", which removes Chrome's online voices. Do not change this on your own: tell the user and ask. " +
      'With Playwright MCP, write a config file ' +
      JSON.stringify({
        browser: { launchOptions: { ignoreDefaultArgs: [NO_VOICES_FLAG] } },
      }) +
      ', pass it with --config or the environment variable PLAYWRIGHT_MCP_CONFIG and restart that MCP server. ' +
      'Other tools: start Chrome without that flag.' +
      fallback
    )
  }
  return (
    silent +
    'Firefox on Linux takes its voices from speech-dispatcher, which has to be installed with a voice; ' +
    'Google Chrome brings online voices of its own.' +
    fallback
  )
}

// agents that watch the event stream, e.g. with the Monitor tool of Claude
// Code. The token in the path keeps other local users and pages out.
var watchers: express.Response[] = []
// --users (src/gateway.ts) starts this server and passes the token, to read
// its state for the dashboard
const token = /^[0-9a-f]{32}$/.test(process.env.LIA_TOKEN || '') ? (process.env.LIA_TOKEN as string) : crypto.randomBytes(16).toString('hex')
// the last time a learner got stuck, for that dashboard
var stuck: { at: number; file: string; slide?: string; chat?: string } | null = null
var events = ''
// events while nobody watched, for the next watcher. Not for long: an agent
// that starts tomorrow must not answer the questions of today. 10 minutes
// lost a click of a tester while the agent worked without a Monitor.
const MISSED_MS = 60 * 60 * 1000
var missed: { t: number; line: string }[] = []

// The browser comes and goes: F5 and a live reload of the bare player close
// its stream and open a new one within a moment. So a change of connected or
// chat is reported as a 'connection' event only once it lasted for a while.
const SETTLE_MS = 2000
const reported = { connected: false, chat: false }
var settling: any = null
// the last shell closed its stream since the last report: F5 or a restart of
// the browser, the agent learns of it even if the state is the same again
var shellClosed = false

// the page where the user hands over a GitHub token, see src/git.ts
export function gitLogin() {
  return origin + '/git/' + token
}

export function getState() {
  return {
    url: state.web ? webPageURL(state.web) : state.file ? playerURL(state.file, state.slide) : home,
    ...state,
    connected: clients.length > 0,
    chat: clients.some((client) => client.chat),
    events,
    watched: watchers.length > 0,
    voices: speech.voices,
    voice_names: speech.names,
    ...(browserLang ? { browser_lang: browserLang } : {}),
    agent: agents.current,
    agents: agents.list,
    view: agents.view,
    session: session && chats.summary(session),
    proxy: proxyMode,
    ...(shared ? { share: shared } : {}),
    // a change waits for its reload, held while the agent works: title and
    // slide are those of the old version
    ...(changedAt ? { reload_pending: true } : {}),
    // only present when the course cannot be read aloud
    tts: ttsHint(),
  }
}

// The table of express (mime 1) is older than these, both were a download.
// An .opus file is Ogg, which every browser plays as audio/ogg.
express.static.mime.define({ 'image/avif': ['avif'], 'audio/ogg': ['opus'] })

// text types a browser shows itself, any other text of the listing is plain
const SHOWN = ['text/html', 'text/plain', 'application/xhtml+xml', 'image/svg+xml', 'application/json']

// no NUL in the first 8 KB, the test of git and grep
function isText(file: string) {
  const buffer = Buffer.alloc(8192)
  const fd = fs.openSync(file, 'r')
  try {
    return !buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).includes(0)
  } finally {
    fs.closeSync(fd)
  }
}

export function playerURL(file: string, slide?: number) {
  return (
    origin +
    player +
    '?' +
    origin +
    '/' +
    encodeURI(file) +
    (slide ? '#' + slide : '')
  )
}

// the chat shell with a web page in its frame
export function webPageURL(url: string) {
  return origin + player + '?web=' + encodeURIComponent(url)
}

const gotoScript = `<script>
if (!window.LIA) {
  window.LIA = {}
}

// '' here, the folder of the share page through --share (e.g. /share)
var base__ = document.location.pathname.slice(0, document.location.pathname.lastIndexOf("/liascript/"))
var filename__ = document.location.search.replace("?"+document.location.origin+base__, "")

window.LIA.lineGoto = function(linenumber) {
  fetch(base__ + "/lineGoto", {
    method: "POST",
    headers: {'Content-Type': 'application/json'}, 
    body: JSON.stringify({
      "linenumber": linenumber,
      "filename": filename__
    })
  }).then(res => {
    console.log("Goto line", linenumber);
  });
}

const events = new EventSource(base__ + '/gotoLine');
events.onmessage = (event) => {
  // the server opens every stream with an empty message
  if (!event.data) return
  try {
    const data = JSON.parse(event.data);
    // live reload in a browser elsewhere (--share)
    if (data.reload) return location.reload()
    if (data.filename == filename__) {
      console.log("goto line:", data.linenumber);
      window.LIA.gotoLine(data.linenumber)
    }
  } catch (e) {
    console.warn("gotoLine failed", e)
  }
};
</script>`

// in agent mode after gotoScript: reports to the agent, see views/agent.js
const agentScript =
  '<script src="activity.js"></script><script src="agent.js"></script>'

var serverPointer: any

init(__dirname)

export function init(serverPath?: string, nodeModulesPath?: string) {
  dirname = serverPath || path.join(__dirname, '..')

  node_modules = nodeModulesPath || path.join(dirname, 'node_modules')

  liascriptPath = path.resolve(
    path.join(node_modules, '@liascript/editor/dist'),
  )
  liachatPath = path.resolve(path.join(node_modules, '@liascript/chat/dist'))
}

export async function start(
  port?: number,
  hostname?: string,
  input?: string,
  responsiveVoice?: string,
  liveReload?: boolean,
  openInBrowser?: boolean,
  testOnline?: boolean,
  gotoCallback?: (linenumber: number, filename: string) => void,
  agent?: boolean,
  watch?: string[],
  proxy?: string,
) {
  port = port || 3000
  hostname = hostname || 'localhost'
  input = input || '.'
  liveReload = liveReload || !!watch
  proxyMode = proxy || 'read'
  if (!PROXY.includes(proxyMode)) {
    throw new Error(`--proxy is one of ${PROXY.join(', ')}, not ${proxyMode}`)
  }
  const proxies = !agent || proxyMode == 'off' ? [] : proxyMode == 'full' ? [webPort, webPort2] : [webPort]

  // the agent bridge is for this machine only
  const bind = agent
    ? hostname === 'localhost'
      ? '127.0.0.1'
      : hostname
    : undefined

  // In agent mode every MCP client starts its own instance from the same
  // config (VS Code autostarts a workspace .mcp.json next to Claude Code), so
  // a busy port is normal and must not kill the server: take the next free
  // one. The agent learns the address from get_state.
  if (agent) {
    const wanted = port
    while (
      !(await isFree(port, bind)) ||
      (await Promise.all(proxies.map((proxyPort) => isFree(proxyPort(port), bind)))).includes(false) ||
      (liveReload && !(await isFree(reloadPort(port))))
    ) {
      if (++port > wanted + 20) {
        throw new Error(`no free port from ${wanted} to ${wanted + 20}`)
      }
    }
  }

  // a file: its folder is the project, the file the course
  const project: { path: string; readme?: string } = { path: input }
  if (fs.lstatSync(input).isFile()) {
    project.path = path.dirname(input)
    project.readme = inputFile = path.basename(input)
  }

  app.set('view engine', 'hbs')
  app.engine(
    'hbs',
    handlebars({
      layoutsDir: path.resolve(path.join(dirname, 'views/layouts')),
      defaultLayout: 'main',
      extname: 'hbs',
    }),
  )
  app.set('views', path.resolve(path.join(dirname, 'views')))

  origin = 'http://' + hostname + ':' + port
  state.root = path.resolve(project.path)

  if (agent) {
    player = '/liascript/chat.html'
    events = origin + '/agent/events/' + token
    // where the MCP client opened the project, which is usually root
    chats.open(path.join(process.cwd(), '.chats'))
    session = chats.latest() || chats.create('')

    // Browser content becomes agent prompts here, so only answer requests
    // addressed to this machine: a rebound DNS name sends its own Host.
    const hosts = ['localhost', '127.0.0.1', '[::1]', hostname].map((h) =>
      port == 80 ? h : h + ':' + port,
    )

    // started by --users (src/gateway.ts): only the gateway may ask, not the
    // agents of the other users, which share the network of this machine
    const gatewayKey = process.env.LIA_GATEWAY_KEY
    if (gatewayKey) {
      app.use(function (req: express.Request, res: express.Response, next: express.NextFunction) {
        if (req.headers['x-lia-gateway'] !== gatewayKey) return res.sendStatus(403)
        next()
      })
    }

    app.use(function (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) {
      if (!hosts.includes(req.headers.host || '')) {
        res.sendStatus(403)
        return
      }
      next()
    })

    // Web pages: another port is another origin, so a page and its scripts
    // never reach /agent, the chat stream or the course. Only the shell may
    // frame them. --proxy read fetches the document only (src/web.ts), full
    // all of it (src/full.ts), off none.
    const proxyPort = webPort(port)
    const proxyHosts = hosts.map((h) => h.replace(/:\d+$/, '') + ':' + proxyPort)
    // CSP knows no IPv6 addresses
    const ancestors = hosts
      .filter((h) => !h.startsWith('['))
      .map((h) => 'http://' + h)
      .join(' ')
    webOrigin = 'http://' + hostname + ':' + proxyPort
    if (proxyMode == 'full') {
      fullProxy = startFull({
        // Another site than the shell: x.com through hammerhead in a frame of
        // the same site (localhost:3000 and localhost:23000) ate all CPU and
        // memory in Firefox until the desktop froze. Under 127.0.0.1 it loads.
        hostname: hostname == 'localhost' ? '127.0.0.1' : hostname == '127.0.0.1' ? 'localhost' : hostname,
        bind,
        hosts,
        port1: proxyPort,
        port2: webPort2(port),
        script: fs.readFileSync(path.join(dirname, 'views/web.js'), 'utf8'),
      })
    } else if (proxyMode == 'read') {
      webServer = http.createServer(function (req, res) {
        const key = process.env.LIA_GATEWAY_KEY
        if (!proxyHosts.includes(req.headers.host || '') || req.method !== 'GET' || (key && req.headers['x-lia-gateway'] !== key)) {
          res.writeHead(403)
          return res.end()
        }
        if ((req.url || '').split('?')[0] === '/web.js') {
          return fs.readFile(path.join(dirname, 'views/web.js'), function (err, data) {
            res.writeHead(err ? 404 : 200, {
              'Content-Type': 'text/javascript',
              'Cache-Control': 'no-cache',
            })
            res.end(data)
          })
        }
        // /?<address>
        const address = (req.url || '').slice(2)
        web
          .fetchPage(address, req.headers)
          .then(function (page) {
            // not a page: the frame takes it from the site
            if (!page.body.length) {
              res.writeHead(302, { Location: page.url })
              return res.end()
            }
            // through --share the page of the share link is the shell, and
            // web.js comes from the other page that tunnels the web pages
            const shell = validOrigin(req.headers['x-lia-origin']) && new URL(req.headers['x-lia-origin'] as string).origin
            const own = validOrigin(req.headers['x-lia-web-origin']) || webOrigin
            // only these headers: the site's CSP, frame options and cookies stay out
            res.writeHead(200, {
              'Content-Type': page.type,
              'Cache-Control': 'no-store',
              'Content-Security-Policy': 'frame-ancestors ' + (shell ? shell + ' ' : '') + ancestors,
            })
            res.end(web.inject(page.body, page.url, own + '/web.js' + (shell ? '?shared' : '')))
          })
          .catch(function (e) {
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('Could not load ' + address + '\n\n' + e.message)
          })
      })
      webServer.on('error', (e) => console.error('web proxy:', e.message))
      webServer.listen(proxyPort, bind)
    }
  }

  // Initialize reload BEFORE routes to ensure its routes are registered first
  if (liveReload) {
    // the folder also for a single file, its images and styles belong to it
    const watchPath = path.resolve(project.path)
    watch = watch || WATCH
    console.log(
      `✨ watching for changes on: "${watchPath}" (${watch.join(', ')})`,
    )

    try {
      reloadInstance = await reload(app, { port: reloadPort(port) })

      // Watch the file for changes using chokidar (more reliable than fs.watch)
      watcher = chokidar.watch(watchPath, {
        ignored: ignored(watchPath, watch),
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      })

      watcher.on('change', (filePath: string) => {
        // which one: a reload nobody expected is easier to explain
        const name = path.relative(watchPath, filePath)
        // an agent that writes files is at work, also between its tool calls
        if (progress && !pending) watchQuiet()
        if (agent && !shows(filePath)) return console.log('📝 ' + name + ' changed, not shown')
        console.log('📝 ' + name + ' changed')
        changed()
      })

      watcher.on('error', (error: any) => {
        console.error('Watcher error:', error)
      })
    } catch (err) {
      console.error('Reload could not start:', err)
    }
  }

  // the course of --input, a folder lists its files. With a course the
  // listing showed technical files, and users had to guess which is theirs.
  app.get('/', function (req: express.Request, res: express.Response) {
    const o = originOf(req)
    res.redirect(
      project.readme
        ? (testOnline ? ONLINE : o + player) + '?' + o + '/' + project.readme
        : o + (agent ? player + '?/home' : '/home'),
    )
  })

  app.get('/gotoLine', eventsHandler)

  app.get('/home*', function (req: express.Request, res: express.Response) {
    const currentPath = path.join(project.path, req.params[0])
    // %2f arrives decoded: /home/..%2fmia listed the folder of another user
    const rel = path.relative(project.path, currentPath)
    const stats = rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel) && fs.lstatSync(currentPath, { throwIfNoEntry: false })
    if (!stats) return res.sendStatus(404)
    // agent mode: a folder or course opened in the tab gets the chat shell,
    // in the frame of the shell the listing and the bare player
    const dest = req.headers['sec-fetch-dest']

    // Is it a directory?
    if (agent && stats.isDirectory() && dest === 'document') {
      res.redirect(originOf(req) + player + '?' + req.path)
    } else if (stats.isDirectory()) {
      const files = fs.readdirSync(currentPath).filter((e: string) => {
        return e[0] !== '.'
      })

      let basePath = originOf(req) + '/home'
      let pathNames = req.params[0].split('/').filter((e: string) => {
        return e !== ''
      })

      let paths: { name: string; href: string }[] = []
      for (let i = 0; i < pathNames.length; i++) {
        basePath += '/' + pathNames[i]
        paths.push({ name: pathNames[i], href: basePath })
      }

      res.render('main', {
        layout: 'index',
        root: originOf(req),
        path: paths,
        file: files
          .map((file: string) => {
            return {
              name: file,
              href: `${originOf(req)}/home${req.params[0]}/${file}`,
              isDirectory: fs.lstatSync(currentPath + '/' + file).isDirectory(),
            }
          })
          // folders first, then by name
          .sort((a, b) =>
            a.isDirectory !== b.isDirectory
              ? a.isDirectory ? -1 : 1
              : a.name.toLocaleLowerCase() < b.name.toLocaleLowerCase() ? -1 : 1,
          ),
      })
    } else if (stats.isFile()) {
      if (req.params[0].toLocaleLowerCase().endsWith('.md')) {
        res.redirect(
          (testOnline ? ONLINE : originOf(req) + (agent && dest === 'iframe' ? '/liascript/index.html' : player)) + '?' + originOf(req) + '/' + req.params[0].replace(/^\/+/, ''),
        )
      } else {
        // the listing is for looking at a file: a LICENSE, .py or .ts was a
        // download (octet-stream, video/mp2t), every text shows as text. No
        // ETag: a 304 kept the type of the download in the cache.
        const plain = !SHOWN.includes(express.static.mime.lookup(currentPath)) && isText(currentPath)
        if (plain) res.type('text/plain; charset=utf-8')
        res.sendFile(req.params[0], { root: project.path, etag: !plain, lastModified: !plain })
      }
    } else {
      res.send('ups, something went wrong')
    }
  })

  app.get(
    '/liascript/',
    function (req: express.Request, res: express.Response) {
      res.redirect(originOf(req) + '/liascript/index.html')
    },
  )

  app.get(
    '/liascript/index.html',
    function (req: express.Request, res: express.Response) {
      fs.readFile(
        liascriptPath + '/index.html',
        'utf8',
        function (err: any, data: string) {
          if (err || !data) {
            res.status(500).send('index.html not found or could not be read')
            return
          }

          const head =
            // elsewhere (--share) the stream of gotoScript reloads instead
            (liveReload && !req.headers['x-lia-origin']
              ? `<script type='text/javascript' src='/reload/reload.js'></script>`
              : '') +
            (responsiveVoice
              ? `<script type='text/javascript' src='https://code.responsivevoice.org/responsivevoice.js?key=${responsiveVoice}'></script>`
              : '') +
            gotoScript +
            (agent ? agentScript : '')

          if (agent) {
            res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
          }

          // a function, since a replacement string would expand $& and $'
          // that occur in the injected scripts; the player of 2.6.1 is minified
          // without the optional </head>, then the scripts go before <body>
          const at = data.includes('</head>') ? '</head>' : data.includes('<body') ? '<body' : ''
          res.send(at ? data.replace(at, () => head + at) : head + data)
        },
      )
    },
  )

  // the chat shell: the player in an iframe, the chat on top of it, so that
  // a live reload of the course does not take the chat with it, the pixel
  // robots of the agents and the portraits of the teacher personas; and the
  // scripts of agentScript
  if (agent) {
    app.get(
      '/liascript/:file(chat.html|chat.js|chat.css|avatar.js|teachers.js|activity.js|agent.js|class.js|phone.js)',
      function (req: express.Request, res: express.Response) {
        res.sendFile(req.params.file, {
          root: path.resolve(path.join(dirname, 'views')),
          // revalidated on every load: a cached chat.js from an older
          // version does not understand the messages of this one
          headers: { 'Cache-Control': 'no-cache' },
        })
      },
    )

    // the icons and the text font of the player for the shell, under names
    // of their own: the files carry a hash that changes with every version
    // of the editor
    const FONTS: { [name: string]: RegExp } = {
      icon: /^icon\.[0-9a-f]+\.woff2$/,
      sans: /^source-sans-pro-v\d+-latin-regular\.[0-9a-f]+\.woff2$/,
      'sans-600': /^source-sans-pro-v\d+-latin-600\.[0-9a-f]+\.woff2$/,
    }
    app.get(
      '/liascript/font/:name(icon|sans|sans-600).woff2',
      function (req: express.Request, res: express.Response) {
        const file = fs.readdirSync(liascriptPath).find((f) => FONTS[req.params.name].test(f))
        if (!file) return res.sendStatus(404)
        res.sendFile(file, { root: liascriptPath })
      },
    )

    // a web page in the frame of the shell: links of the course, goto and
    // the address field come here and need not know the port of the proxy
    app.get('/web', function (req: express.Request, res: express.Response) {
      const url = web.webURL(req.query.url)
      // through --share only with a page for web pages, see src/share.ts
      if (proxyMode == 'off' || (req.headers['x-lia-origin'] && !req.headers['x-lia-web-origin'])) return res.sendStatus(404)
      if (!url) return res.sendStatus(400)
      res.redirect(fullProxy ? fullProxy.url(url.href) : (validOrigin(req.headers['x-lia-web-origin']) || webOrigin) + '/?' + url.href)
    })

    // the LiaScript chat that renders the messages: element.js and its app
    app.get(
      '/liascript/lia-chat/*',
      function (req: express.Request, res: express.Response) {
        res.sendFile(req.params[0], { root: liachatPath }, (err) => {
          if (err) res.sendStatus(404)
        })
      },
    )

    // browser -> agent: {type, agent, cmd, params, context}
    app.post('/agent', function (req: express.Request, res: express.Response) {
      // checked here, because the catch-all below answers the CORS preflight
      // of every path with *
      if (!sameOrigin(req)) {
        return res.sendStatus(403)
      }

      const body = req.body || {}
      if (
        !['state', 'command', 'chat', 'answer', 'session', 'activity', 'store', 'page'].includes(body.type)
      ) {
        return res.sendStatus(400)
      }

      // the quizzes, surveys or tasks of message n as the chat stores them,
      // so that F5 shows them solved again. No event, activity tells the
      // agent what the learner did.
      if (body.type === 'store') {
        const p = body.params || {}
        const entry = session && Number.isInteger(p.n) && session.entries[p.n]
        if (
          !entry ||
          entry.type !== 'ai' ||
          !STORED.includes(p.table) ||
          !Array.isArray(p.data) ||
          JSON.stringify(p.data).length > STORE_MAX
        ) {
          return res.sendStatus(400)
        }
        try {
          chats.store(session!, p.table, p.n, p.data)
        } catch (e: any) {
          console.warn('chat state not saved:', e.message)
        }
        return res.sendStatus(204)
      }

      // what run_in_page's code returned in the web page, page content
      if (body.type === 'page') {
        const p = body.params || {}
        if (!isName(p.id)) return res.sendStatus(400)
        bus.emit('page', { id: p.id, result: text(p.result, PAGE_MAX), error: text(p.error, 2000) })
        return res.sendStatus(204)
      }

      if (body.context) {
        const c = body.context
        state.file = text(c.file, 500)
        state.slide = c.slide | 0 || 1
        state.title = text(c.title, 200)
        state.selection = text(c.selection, 2000)
        state.web = text(c.web, 2000)
        if (Number.isInteger(c.voices) && c.voices >= 0) {
          speech.voices = Math.min(c.voices, 9999)
        }
        if (Array.isArray(c.voiceNames)) {
          speech.names = c.voiceNames
            .filter((n: any) => typeof n === 'string')
            .slice(0, 50)
            .map((n: string) => n.slice(0, 100))
        }
        if (typeof c.automated === 'boolean') speech.automated = c.automated
        if (typeof c.fallback === 'boolean') speech.fallback = c.fallback
        if (c.browserLang !== undefined) browserLang = text(c.browserLang, 35)
      }
      bus.emit('state', getState())

      if (body.type === 'state') {
        return res.sendStatus(204)
      }

      // agent and cmd end up as attributes of the channel tag, params in its
      // body: all of it is page content, so only names and bounded strings.
      // command: agent/cmd from the link. chat: params.text. answer:
      // params.ask plus one entry per input of the form. session: params.id
      // of a saved chat, none for a new one.
      const command = body.type === 'command'
      const agentName = (command && body.agent) || ''
      const params = body.params || {}
      if (
        (agentName !== '' && !isName(agentName)) ||
        (command && !isName(body.cmd)) ||
        typeof params !== 'object' ||
        Array.isArray(params) ||
        Object.keys(params).length > 20 ||
        (body.type === 'chat' && !text(params.text, 1).trim()) ||
        (body.type === 'answer' && !isName(params.ask)) ||
        (body.type === 'session' && (!session || (params.id !== undefined && !isName(params.id))))
      ) {
        return res.sendStatus(400)
      }

      const checked: { [key: string]: string | string[] } = {}
      for (const key of Object.keys(params)) {
        const value = params[key]
        if (!isName(key)) {
          return res.sendStatus(400)
        } else if (typeof value === 'string') {
          checked[key] = value.slice(0, 4000)
        } else if (
          Array.isArray(value) &&
          value.length <= 20 &&
          value.every((v: any) => typeof v === 'string')
        ) {
          checked[key] = value.map((v: string) => v.slice(0, 200))
        } else {
          return res.sendStatus(400)
        }
      }
      // replaced, withdrawn, answered or from before a restart
      if (body.type === 'answer' && checked.ask !== openAsk) {
        return res.sendStatus(409)
      }

      // agent:<name>/switch, from a link or the agent menu of the chat, takes
      // effect at once if the agents declared that name. The event tells them.
      if (
        command &&
        body.cmd === 'switch' &&
        agents.list.some((a) => a.name === agentName)
      ) {
        setAgent(agentName)
      }

      let entry: chats.Entry | undefined
      if (body.type === 'session') {
        const id = checked.id as string | undefined
        const next = id
          ? id === session!.id
            ? session
            : chats.load(id)
          : // a new chat, unless the current one is still empty
            session!.entries.length
            ? chats.create(state.file)
            : session
        if (!next) return res.sendStatus(400)
        session = next
        send({ sessions: chats.list() })
        send(sessionMessage())
        send({ status: '' })
        checked.id = next.id
        // what the agent needs to pick up the thread
        ;(checked as any).title = chats.title(next)
        ;(checked as any).resumed = next.entries.length > 0
      } else if (body.type === 'chat') {
        entry = record({ type: 'user', text: checked.text })
      } else if (body.type === 'answer') {
        const { ask, ...values } = checked
        openAsk = ''
        // every shell shows the choice as what the user said
        entry = record({ type: 'answer', ask, values })
        if (entry) send({ entry })
      } else if (command) {
        // a click on a link too, as its text: the user sees that it arrived,
        // and the history says what happened
        let label = text(body.label, 200).replace(/\s+/g, ' ').trim()
        // the agent menu of the chat has no link text: the name it shows
        const to = body.cmd === 'switch' && agents.list.find((a) => a.name === agentName)
        if (!label && to) label = to.label || to.name
        const params = Object.keys(checked).length ? { params: checked } : {}
        entry = label ? record({ type: 'command', agent: agentName, cmd: body.cmd, label, ...params }) : undefined
        if (entry) send({ entry })
      }

      // the user sees at once that it arrived, until the agent sends its own
      // status or answers. A switch the server handled needs no answer.
      if (
        body.type === 'chat' ||
        body.type === 'answer' ||
        (command && !(body.cmd === 'switch' && agentName === agents.current))
      ) {
        pending = true
        send({ status: WAITING })
      }

      // help only from the server, and the line only if the agent does not
      // already show what it works on
      if (body.type === 'activity') {
        delete checked.help
        if (checked.kind === 'quiz') {
          // a hit at the first try is news for a companion, who could not
          // tell solved from untouched; an author testing would hear of all
          if (checked.solved === 'solved' && checked.trial === '1' && agents.view !== 'learner') {
            return res.sendStatus(204)
          }
          checked.view = agents.view
        }
        if (needsHelp(checked, state.file)) {
          checked.help = 'true'
          stuck = { at: Date.now(), file: state.file, slide: checked.slide as string, chat: checked.chat as string }
          if (!progress) {
            pending = true
            send({ status: LOOKING })
          }
        }
      }

      emitEvent({
        type: body.type,
        // chat and answer go to the agent the user talks to right now
        agent: command ? agentName : agents.current,
        cmd: command ? body.cmd : '',
        // its number in the chat, for chat({reply_to}) and read_chat
        ...(entry && session ? { entry: session.entries.indexOf(entry) } : {}),
        params: checked,
        context: eventContext(),
      })

      return res.sendStatus(204)
    })

    // the state for the dashboard of --users, without the side effects of a
    // watcher of the event stream. Not for browsers, they send an Origin.
    app.get('/agent/state/:token', function (req: express.Request, res: express.Response) {
      if (req.params.token !== token || req.headers.origin !== undefined) return res.sendStatus(403)
      res.json({ ...getState(), stuck })
    })

    // agent <- browser for agents that watch a command's output: one JSON
    // line per event. Not for browsers, they send an Origin.
    app.get(
      '/agent/events/:token',
      function (req: express.Request, res: express.Response) {
        if (req.params.token !== token || req.headers.origin !== undefined) {
          return res.sendStatus(403)
        }
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
        })
        res.flushHeaders()
        // what happened while nobody watched, e.g. before a Monitor that
        // expired was started again
        const fresh = Date.now() - MISSED_MS
        missed.forEach((m) => m.t > fresh && res.write(m.line))
        if (missed.length) activity()
        missed = []
        watchers.push(res)
        res.on('close', () => {
          watchers = watchers.filter((watcher) => watcher !== res)
        })
      },
    )

    // the GitHub token goes from the user to src/git.ts, never past the
    // agent; the random token keeps course scripts out
    app.get('/git/:token', function (req: express.Request, res: express.Response) {
      if (req.params.token !== token) return res.sendStatus(403)
      res.send(git.page())
    })
    app.post(
      '/git/:token',
      express.urlencoded({ extended: false }),
      async function (req: express.Request, res: express.Response) {
        if (req.params.token !== token || !sameOrigin(req)) {
          return res.sendStatus(403)
        }
        try {
          res.send(git.page(await git.login(req.body.token)))
        } catch (e: any) {
          res.status(400).send(git.page(undefined, e.message))
        }
      },
    )
  }

  // load everything from the liascript folder
  app.get(
    '/liascript/*',
    function (req: express.Request, res: express.Response) {
      res.sendFile(req.params[0], { root: liascriptPath }, (err) => {
        if (err) {
          // Extract the file path by removing the '/liascript/' prefix
          const projectPath = req.params[0]
          console.log(
            `File not found in liascriptPath, trying project.path: ${projectPath}`,
            project.path,
          )
          res.sendFile(projectPath, { root: project.path })
        }
      })
    },
  )

  // react to click-events
  app.post('/lineGoto', function (req: express.Request, res: express.Response) {
    if (gotoCallback) {
      try {
        const linenumber = req.body.linenumber
        const filename = req.body.filename
        gotoCallback(linenumber, filename)
      } catch (e) {
        console.warn(
          "lineGoto event with wrong datatype, you have to provide {'linenumber': int, 'filename': string}",
        )
      }
    }
    return res.json({})
  })

  // everything else comes from the current project folder
  app.use(
    '/*',
    cors(),
    function (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) {
      // the client script of reload, its WebSocket runs on a port of its own
      if (req.originalUrl.startsWith('/reload/')) return next()
      res.sendFile(req.originalUrl, { root: project.path })
    },
  )

  // errors as a bare status: express' own page shows the paths of this computer
  app.use(function (err: any, req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!err.status) console.error(err)
    res.sendStatus(err.status || 500)
  })

  // the course of --input, else the file listing
  home = project.readme
    ? (testOnline ? ONLINE : origin + player) + '?' + origin + '/' + project.readme
    : origin

  const server = app.listen(port, bind)

  server.on('error', (e: any) => {
    throw e
  })

  if (openInBrowser) {
    open(home)
  }

  console.log('📡 starting server')
  console.log(`   - local:           ${home}`)
  if (!agent) {
    console.log(
      `   - on your network: ${home.replace(hostname, lanAddress())}`,
    )
  }

  serverPointer = server
}

export function stop() {
  clearTimeout(settling)
  clearTimeout(quiet)
  clearTimeout(reloading)
  changedAt = 0
  if (serverPointer) {
    serverPointer.close()
  }
  if (webServer) {
    webServer.close()
    webServer = null
  }
  if (fullProxy) {
    fullProxy.close()
    fullProxy = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
  }
  if (reloadInstance) {
    reloadInstance.closeServer().catch(() => {})
    reloadInstance = null
  }
}

// keeps the live-reload websocket port derived from (and as unique as) the
// main devserver port, instead of reload's hardcoded 9856 default, so
// multiple simultaneously running instances never collide
function reloadPort(port: number): number {
  return port < 55535 ? port + 10000 : port - 10000
}

// the proxy of the web pages, as unique as reloadPort
function webPort(port: number): number {
  return port < 45535 ? port + 20000 : port - 20000
}

// hammerhead's second server, for cross-domain iframes (--proxy full)
function webPort2(port: number): number {
  return port < 35535 ? port + 30000 : port - 30000
}

// chokidar 4 knows no globs: skip hidden files and folders and node_modules
// below root (a hidden folder above it does not count), and files of other
// types. chokidar asks once without stats and again with them, folders must
// pass the type check, so it waits for the stats.
function ignored(root: string, types: string[]) {
  const all = types.includes('*')

  return function (file: string, stats?: fs.Stats): boolean {
    const hidden = path
      .relative(root, file)
      .split(path.sep)
      .some((part) => part.startsWith('.') || part === 'node_modules')

    if (hidden) return true
    if (all || !stats || !stats.isFile()) return false

    return !types.includes(path.extname(file).slice(1).toLowerCase())
  }
}

// the first IPv4 address of this machine on a network, else loopback
function lanAddress() {
  const all = Object.values(os.networkInterfaces()).flat()
  const found = all.find((a) => a && a.family === 'IPv4' && !a.internal)
  return found ? found.address : '127.0.0.1'
}

function isFree(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, host, () => probe.close(() => resolve(true)))
  })
}

// what the user looks at, web only while it is a web page
function eventContext() {
  const { root, web, ...context } = state
  return web ? { ...context, web } : context
}

function text(value: any, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

// letters, digits, _ and -. typeof first: a regex test would stringify
// undefined and accept it
export function isName(value: any): boolean {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
}

// to the bus, and as one JSON line to every watcher
function emitEvent(event: { params: object; [key: string]: any }) {
  bus.emit('event', event)
  // escaped like the channel content, the line ends up inside a tag too.
  // params last: Claude Code's Monitor cuts a line at about 500 characters,
  // then only the end of a long chat text is missing (read_chat has it).
  const { params, ...rest } = event
  const line = JSON.stringify({ ...rest, params }).replace(/</g, '\\u003c') + '\n'
  if (watchers.length) {
    watchers.forEach((watcher) => watcher.write(line))
    activity()
  } else if (missed.push({ t: Date.now(), line }) > 20) {
    missed.shift()
  }
}

// a browser stream opened or closed: the state changed at once, the event
// waits until nothing changed for SETTLE_MS
function connectionChanged() {
  bus.emit('state', getState())
  clearTimeout(settling)
  settling = setTimeout(() => {
    const now = getState()
    const same = now.connected === reported.connected && now.chat === reported.chat
    const reloaded = same && shellClosed && now.chat
    shellClosed = false
    if (same && !reloaded) return
    reported.connected = now.connected
    reported.chat = now.chat
    const params: any = { connected: now.connected, chat: now.chat }
    if (reloaded) params.reloaded = true
    emitEvent({ type: 'connection', agent: '', cmd: '', params, context: eventContext() })
  }, SETTLE_MS)
  // a pending report must not keep a stopped server alive
  if (settling.unref) settling.unref()
}

// server -> every connected browser. A chat message is saved in the session
// on the way, the progress line kept for a shell that connects later.
export function send(msg: any) {
  const before = progress
  if (typeof msg.status === 'string') progress = msg.status
  if (msg.chat) {
    const { id, inputs, status, ...rest } = msg.chat
    progress = status || ''
    if (inputs && inputs.length) {
      closeForm()
      openAsk = id
    }
    if (typeof rest.markdown === 'string') rest.markdown = withLanguage(rest.markdown)
    msg = { ...msg, chat: { ...msg.chat, markdown: rest.markdown } }
    const entry = record(
      inputs && inputs.length ? { type: 'ai', ask: id, inputs, ...rest } : { type: 'ai', ...rest },
    )
    // its number in the saved chat, for the states of its quizzes
    if (entry) msg = { ...msg, chat: { ...msg.chat, n: session!.entries.length - 1 } }
  }
  clients.forEach((client) =>
    client.write(`data: ${JSON.stringify(msg)}\n\n`),
  )
  if (progress !== before || msg.chat) watchQuiet()
  // the agent is done: what it changed shows now, after a burst settled
  if (before && !progress && changedAt) reloadLater(BURST_MS)
}

// The chat takes its language from a header comment in any of its messages,
// for all of them: quiz buttons and feedback (Check, Congratulations…) were
// English in a German course. So the language of the course goes into the
// header of a message, unless the chat has it already. Checked in the
// browser with @liascript/chat 0.1.2--2.2.2: no extra message, F5 keeps it.
// language: of the header comment a course or a message starts with
function headerLanguage(markdown: string) {
  const head = markdown.match(/^\s*<!--((?:(?!-->)[^])*)/)
  const lang = head && head[1].match(/(?:^|\n)[ \t]*language[ \t]*:[ \t]*(\S+)/)
  return lang ? lang[1] : ''
}

function withLanguage(markdown: string) {
  const lang = courseLanguage()
  if (!lang || !session) return markdown
  let said = ''
  session.entries.forEach((e) => {
    if (e.type === 'ai' && typeof e.markdown === 'string') said = headerLanguage(e.markdown) || said
  })
  // English is the default, unless the chat already says another one
  if (lang === said || (!said && /^en\b/i.test(lang)) || headerLanguage(markdown)) return markdown
  // an own header of the message (import:, macros) is the one that counts
  if (/^\s*<!--/.test(markdown)) return markdown.replace('<!--', '<!--\nlanguage: ' + lang)
  return '<!--\nlanguage: ' + lang + '\n-->\n\n' + markdown
}

// language: of the header of the course the user looks at, '' if none
function courseLanguage() {
  const file = state.file || inputFile
  const full = path.resolve(state.root, file)
  if (!/\.md$/i.test(file) || !full.startsWith(state.root + path.sep)) return ''
  try {
    const lang = headerLanguage(fs.readFileSync(full, 'utf8'))
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang) ? lang : ''
  } catch (e) {
    return ''
  }
}

const PAGE_MAX = 90000

// Runs code in the web page of the shell (views/web.js, behind the proxy) and
// resolves with what it returned as JSON, or with its error.
// ponytail: every connected shell runs it, the first answer wins
export function runInPage(code: string, ms = 10000): Promise<{ result?: string; error?: string }> {
  const id = crypto.randomBytes(8).toString('hex')
  return new Promise((resolve) => {
    const done = (answer: { id: string; result?: string; error?: string }) => {
      if (answer.id !== id) return
      clearTimeout(limit)
      bus.removeListener('page', done)
      resolve(answer.error ? { error: answer.error } : { result: answer.result })
    }
    const limit = setTimeout(
      () => done({ id, error: 'no answer from the page within ' + ms / 1000 + ' s: is it shown through the proxy?' }),
      ms,
    )
    bus.on('page', done)
    send({ page: { id, code } })
  })
}

export function gotoLine(linenumber: number, filename: string) {
  send({ linenumber: linenumber, filename: filename })
}

const PING_MS = 20000

function eventsHandler(
  request: express.Request,
  response: express.Response,
  next: any,
) {
  const headers = {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  }
  response.writeHead(200, headers)

  const data = `data: \n\n`

  response.write(data)

  // the chat shell connects with ?chat, a bare player cannot show messages
  ;(response as any).chat = request.query.chat !== undefined
  // a browser elsewhere, through the tunnel of --share
  ;(response as any).remote = !!request.headers['x-lia-origin']
  // a reloaded shell has to know its chat, who it talks to and what is going on
  if ((response as any).chat) {
    const replay: object[] = []
    if (session) replay.push({ sessions: chats.list() }, sessionMessage())
    if (agents.list.length) replay.push(agentsMessage())
    if (progress) replay.push({ status: progress })
    if (hint) replay.push({ hint })
    // through --share without a page for web pages there are none
    replay.push({ proxy: request.headers['x-lia-origin'] && !request.headers['x-lia-web-origin'] ? 'off' : proxyMode })
    // the course of --input, the shell offers a way back to it
    if (inputFile) replay.push({ home: inputFile })
    replay.forEach((msg) => response.write(`data: ${JSON.stringify(msg)}\n\n`))
  }
  clients.push(response)
  connectionChanged()
  // the shell takes a stream that stays silent for a dead one, see chat.js
  const ping = (response as any).chat ? setInterval(() => response.write('data: {"ping":true}\n\n'), PING_MS) : null
  if (ping && ping.unref) ping.unref()

  request.on('close', () => {
    if (ping) clearInterval(ping)
    clients = clients.filter((client) => client !== response)
    if ((response as any).chat && !clients.some((client: any) => client.chat)) shellClosed = true
    connectionChanged()
  })
}
