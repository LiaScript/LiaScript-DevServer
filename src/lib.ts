import * as express from 'express'

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import { EventEmitter } from 'events'

import * as chats from './chats'

const cors = require('cors')
const handlebars = require('express-handlebars')
const ip = require('ip')
const open = require('open')
const bodyParser = require('body-parser')
const reload = require('reload')
const chokidar = require('chokidar')

const app: express.Application = express()
app.use(bodyParser.json())

var dirname = ''
var node_modules
var liascriptPath = ''
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
// in agent mode the chat shell, which shows the player in an iframe
var player = '/liascript/index.html'
const state = { root: '', file: '', slide: 1, title: '', selection: '' }

// What the browser says about text-to-speech, kept out of state, which is the
// context of every event. voices: number of speechSynthesis voices, -1 until a
// browser reported. automated: navigator.webdriver, a browser driven by
// Playwright or Puppeteer. fallback: responsiveVoice is loaded in the player,
// which --responsiveVoice only achieves with a valid key.
const speech = { voices: -1, automated: false, fallback: false }

// Who the user talks to: the agents of a workflow, each with an emoji that the
// chat shows on its button and under every message. Kept out of state too.
// label: what the user reads instead of the name, e.g. "Unterrichtsplanung"
export type Agent = { name: string; emoji: string; label?: string }
const agents = { current: '', list: [] as Agent[] }

export function currentAgent(): Agent | undefined {
  // not find(): the lib build compiles against ES5
  return agents.list.filter((a) => a.name === agents.current)[0]
}

// list replaces the roster, name has to be in it (the caller checks that)
export function setAgent(name: string, list?: Agent[]) {
  if (list) agents.list = list
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

// the agent withdraws the open form, returns its id or ''
export function closeForm() {
  const closed = openAsk
  openAsk = ''
  if (closed) send({ closed })
  return closed
}

// Is anybody there? A plain "Thinking…" kept users waiting for minutes while
// no agent listened, or while one waited for a permission in the terminal.
// So the progress line says only what the server knows: the message waits,
// an agent took it (adapters call activity() on every tool call and when they
// hand an event over, a watcher of the event stream counts too), and after a
// while without any sign of the agent a hint below it says so.
const WAITING = 'Waiting for the assistant…'
const THINKING = 'Thinking…'
const NO_REACTION_MS = 30000
const NO_REACTION =
  'The assistant has not reacted yet. Your message is saved and waits for it.'
const QUIET_MS = 60000
const QUIET =
  'No sign of the assistant for a minute. It may still be working, or wait for a permission on the computer.'
// an event waits for the first sign of an agent
var pending = false
var hint = ''
var quiet: any = null

export function activity() {
  pending = false
  if (progress === WAITING) send({ status: THINKING })
  else watchQuiet()
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
}

// restarts the clock whenever something happens while a progress line shows
function watchQuiet() {
  clearTimeout(quiet)
  if (hint) send({ hint: (hint = '') })
  if (!progress) return
  quiet = setTimeout(
    () => send({ hint: (hint = pending ? NO_REACTION : QUIET) }),
    pending ? NO_REACTION_MS : QUIET_MS,
  )
  // a pending hint must not keep a stopped server alive
  if (quiet.unref) quiet.unref()
}

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
  return { session: { id: session!.id, entries: session!.entries, open: openIn(session!) } }
}

export function readChat(id?: string) {
  const chat = id === undefined || (session && id === session.id) ? session : chats.load(id)
  return chat
    ? { ...chats.summary(chat), file: chat.file, open: openIn(chat), entries: chat.entries }
    : undefined
}

function agentsMessage() {
  return { agents: { current: currentAgent() || null, list: agents.list } }
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
const token = crypto.randomBytes(16).toString('hex')
var events = ''
// events while nobody watched, for the next watcher. Not for long: an agent
// that starts tomorrow must not answer the questions of today.
const MISSED_MS = 10 * 60 * 1000
var missed: { t: number; line: string }[] = []

// The browser comes and goes: F5 and a live reload of the bare player close
// its stream and open a new one within a moment. So a change of connected or
// chat is reported as a 'connection' event only once it lasted for a while.
const SETTLE_MS = 2000
const reported = { connected: false, chat: false }
var settling: any = null

export function getState() {
  return {
    url: state.file ? playerURL(state.file, state.slide) : home,
    ...state,
    connected: clients.length > 0,
    chat: clients.some((client) => client.chat),
    events,
    watched: watchers.length > 0,
    voices: speech.voices,
    agent: agents.current,
    agents: agents.list,
    session: session && chats.summary(session),
    // only present when the course cannot be read aloud
    tts: ttsHint(),
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

const gotoScript = `<script>
if (!window.LIA) {
  window.LIA = {}
}

var filename__ = document.location.search.replace("?"+document.location.origin, "")

window.LIA.lineGoto = function(linenumber) {
  fetch("/lineGoto", {
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

const events = new EventSource('/gotoLine');
events.onmessage = (event) => {
  // the server opens every stream with an empty message
  if (!event.data) return
  try {
    const data = JSON.parse(event.data);
    if (data.filename == filename__) {
      console.log("goto line:", data.linenumber);
      window.LIA.gotoLine(data.linenumber)
    }
  } catch (e) {
    console.warn("gotoLine failed", e)
  }
};
</script>`

// Injected after gotoScript in agent mode, reuses its filename__ and events.
// Keep it free of backslashes, backticks and dollar-brace: this is a template
// literal, an escape like \w would silently turn into w.
const agentScript = `<script>
(function () {
  var file = filename__, timer
  while (file[0] == '/') file = file.slice(1)
  try { file = decodeURIComponent(file) } catch (e) {}

  function ctx() {
    return {
      file: file,
      slide: parseInt(location.hash.slice(1)) || 1,
      title: document.title,
      selection: String(getSelection()).slice(0, 2000),
      voices: voices(),
      automated: navigator.webdriver === true,
      fallback: typeof responsiveVoice != 'undefined'
    }
  }

  // Chrome loads its voices on the first call and tells when they are there
  function voices() {
    try { return speechSynthesis.getVoices().length } catch (e) { return 0 }
  }

  function post(msg) {
    return fetch('/agent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(msg)
    })
  }

  // ponytail: one tab, the last reporter wins. Key the state by client if
  // several tabs on different courses ever matter.
  function report() {
    // inside the chat shell: keep its address and title in step, so that
    // reloading the shell comes back to this course and slide
    if (parent != window) {
      try {
        parent.history.replaceState(null, '',
          parent.location.pathname + location.search + location.hash)
        parent.document.title = document.title
      } catch (e) {}
    }
    clearTimeout(timer)
    timer = setTimeout(function () { post({type: 'state', context: ctx()}) }, 150)
  }

  // The player's message handler has an eval command and checks no origin, so
  // any website could drive this page. Registered first, this one wins.
  addEventListener('message', function (e) {
    if (e.origin != location.origin) e.stopImmediatePropagation()
  }, true)

  // slide changes are history.pushState, which fires no event at all
  var push = history.pushState
  history.pushState = function () { push.apply(this, arguments); report() }
  addEventListener('hashchange', report)
  addEventListener('popstate', report)
  addEventListener('load', report)
  document.addEventListener('selectionchange', report)
  try { speechSynthesis.addEventListener('voiceschanged', report) } catch (e) {}
  // the title is set after the slide change
  var title = document.querySelector('title')
  if (title) new MutationObserver(report).observe(title, {childList: true})

  // Command links: [text](agent:tutor/explain?level=easy), or the same URI in
  // a data-agent attribute. One capturing listener, so it does not matter how
  // the player wires its links. agent://tutor/explain means the same, the
  // slashes are dropped: new URL() would take tutor as the host otherwise.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-agent],a[href]')
    if (!el) return
    var raw = el.getAttribute('data-agent') || el.getAttribute('href') || ''
    if (raw.indexOf('agent:') != 0) return

    // the player would hand the link to the browser
    e.preventDefault()
    e.stopPropagation()

    var uri
    try { uri = new URL('agent:' + raw.slice(6).replace(/^[/]+/, '')) } catch (x) { return }
    var slash = uri.pathname.indexOf('/')
    var params = {}
    uri.searchParams.forEach(function (value, key) { params[key] = value })

    post({
      type: 'command',
      agent: slash < 0 ? '' : uri.pathname.slice(0, slash),
      cmd: uri.pathname.slice(slash + 1),
      params: params,
      // the chat shows it as what the user said
      label: el.textContent.trim(),
      context: ctx()
    })
  }, true)

  events.addEventListener('message', function (event) {
    var go
    try { go = JSON.parse(event.data).goto } catch (e) {}
    if (!go) return

    // ponytail: file and line in one step is not supported, the line is lost
    // on the page load. Two goto calls do it; hand it over in sessionStorage
    // if that gets annoying.
    if (go.file && go.file != file) {
      location.href = location.pathname + '?' + location.origin + '/' +
        encodeURI(go.file) + (go.slide ? '#' + go.slide : '')
      return
    }
    // not LIA.goto: its dedup guard remembers the last requested slide, not
    // the current one, so asking for the same slide twice does nothing
    if (go.slide) location.hash = '#' + go.slide
    if (go.line) window.LIA.gotoLine(go.line)
  })
})()
</script>`

var serverPointer: any

init(__dirname)

export function init(serverPath?: string, nodeModulesPath?: string) {
  dirname = serverPath || path.join(__dirname, '..')

  node_modules = nodeModulesPath || path.join(dirname, 'node_modules')

  liascriptPath = path.resolve(
    path.join(node_modules, '@liascript/editor/dist'),
  )
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
) {
  port = port || 3000
  hostname = hostname || 'localhost'
  openInBrowser = openInBrowser || false
  input = input || '.'
  liveReload = liveReload || !!watch
  testOnline = testOnline || false
  agent = agent || false

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
      (liveReload && !(await isFree(reloadPort(port))))
    ) {
      if (++port > wanted + 20) {
        throw new Error(`no free port from ${wanted} to ${wanted + 20}`)
      }
    }
  }

  var project: {
    path: string
    readme?: string
  } = {
    path: input,
    readme: undefined,
  }

  if (input) {
    const stats = fs.lstatSync(input)

    // Is it a directory?
    if (stats.isDirectory()) {
      project.path = input
    } else if (stats.isFile()) {
      project.path = path.dirname(input)
      project.readme = path.basename(input)
    }
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

    app.use(function (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) {
      if (hosts.indexOf(req.headers.host || '') < 0) {
        res.sendStatus(403)
        return
      }
      next()
    })
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
        console.log('📝 ' + path.relative(watchPath, filePath) + ' changed')
        changed()
      })

      watcher.on('error', (error: any) => {
        console.error('Watcher error:', error)
      })
    } catch (err) {
      console.error('Reload could not start:', err)
    }
  }

  app.get('/', function (req: express.Request, res: express.Response) {
    res.redirect('/home')
  })

  app.get('/gotoLine', eventsHandler)

  app.get('/home*', function (req: express.Request, res: express.Response) {
    const currentPath = project.path + '/' + req.params[0]

    const stats = fs.lstatSync(currentPath)

    // Is it a directory?
    if (stats.isDirectory()) {
      const files = fs.readdirSync(currentPath).filter((e: string) => {
        return e[0] !== '.'
      })

      let basePath = '/home'
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
        path: paths,
        file: files
          .map((file: string) => {
            return {
              name: file,
              href: `http://${hostname}:${port}/home${req.params[0]}/${file}`,
              isDirectory: fs.lstatSync(currentPath + '/' + file).isDirectory(),
            }
          })
          .sort(
            (
              a: {
                name: string
                href: string
                isDirectory: boolean
              },
              b: {
                name: string
                href: string
                isDirectory: boolean
              },
            ) => {
              if (a.isDirectory && !b.isDirectory) {
                return -1
              } else if (!a.isDirectory && b.isDirectory) {
                return 1
              } else {
                if (a.name.toLocaleLowerCase() < b.name.toLocaleLowerCase()) {
                  return -1
                } else {
                  return 1
                }
              }
              return 0
            },
          ),
      })
    } else if (stats.isFile()) {
      if (req.params[0].toLocaleLowerCase().endsWith('.md')) {
        if (testOnline) {
          res.redirect(
            `https://LiaScript.github.io/course/?http://${hostname}:${port}/${req.params[0]}`,
          )
        } else {
          res.redirect(
            `${player}?http://${hostname}:${port}/${req.params[0]}`,
          )
        }
      } else {
        res.sendFile(req.params[0], { root: project.path })
      }
    } else {
      res.send('ups, something went wrong')
    }
  })

  app.get(
    '/liascript/',
    function (req: express.Request, res: express.Response) {
      res.redirect('/liascript/index.html')
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
            (liveReload
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
          // that occur in the injected scripts
          res.send(data.replace('</head>', () => head + '</head>'))
        },
      )
    },
  )

  // the chat shell: the player in an iframe, the chat on top of it, so that
  // a live reload of the course does not take the chat with it
  if (agent) {
    app.get(
      '/liascript/chat.:ext(html|js)',
      function (req: express.Request, res: express.Response) {
        res.sendFile('chat.' + req.params.ext, {
          root: path.resolve(path.join(dirname, 'views')),
          // revalidated on every load: a cached chat.js from an older
          // version does not understand the messages of this one
          headers: { 'Cache-Control': 'no-cache' },
        })
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

  // browser -> agent: {type, agent, cmd, params, context}
  if (agent) {
    app.post('/agent', function (req: express.Request, res: express.Response) {
      // checked here, because the catch-all below answers the CORS preflight
      // of every path with *
      if (req.headers.origin !== 'http://' + req.headers.host) {
        return res.sendStatus(403)
      }

      const body = req.body || {}
      if (['state', 'command', 'chat', 'answer', 'session'].indexOf(body.type) < 0) {
        return res.sendStatus(400)
      }

      if (body.context) {
        const c = body.context
        state.file = text(c.file, 500)
        state.slide = c.slide | 0 || 1
        state.title = text(c.title, 200)
        state.selection = text(c.selection, 2000)
        if (Number.isInteger(c.voices) && c.voices >= 0) {
          speech.voices = Math.min(c.voices, 9999)
        }
        if (typeof c.automated === 'boolean') speech.automated = c.automated
        if (typeof c.fallback === 'boolean') speech.fallback = c.fallback
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
        record({ type: 'user', text: checked.text })
      } else if (body.type === 'answer') {
        const { ask, ...values } = checked
        openAsk = ''
        // every shell shows the choice as what the user said
        const entry = record({ type: 'answer', ask, values })
        if (entry) send({ entry })
      } else if (command) {
        // a click on a link too, as its text: the user sees that it arrived,
        // and the history says what happened
        const label = text(body.label, 200).replace(/\s+/g, ' ').trim()
        const entry = label && record({ type: 'command', agent: agentName, cmd: body.cmd, label })
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

      const { root, ...context } = state
      emitEvent({
        type: body.type,
        // chat and answer go to the agent the user talks to right now
        agent: command ? agentName : agents.current,
        cmd: command ? body.cmd : '',
        params: checked,
        context,
      })

      return res.sendStatus(204)
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
  }

  // everything else comes from the current project folder
  app.use(
    '/*',
    cors(),
    function (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) {
      // Skip reload and socket.io paths - let reload package handle them
      if (
        req.originalUrl.startsWith('/reload/') ||
        req.originalUrl.startsWith('/socket.io')
      ) {
        return next()
      }
      res.sendFile(req.originalUrl, { root: project.path })
    },
  )

  let localURL = 'http://' + hostname + ':' + port

  if (project.path && project.readme) {
    localURL +=
      player +
      '?http://' +
      hostname +
      ':' +
      port +
      '/' +
      project.readme
  }

  if (testOnline && project.readme) {
    localURL =
      'https://LiaScript.github.io/course/?http://' +
      hostname +
      ':' +
      port +
      '/' +
      project.readme
  }

  home = localURL

  const server = app.listen(port, bind)

  server.on('error', (e: any) => {
    throw e
  })

  if (openInBrowser) {
    open(localURL)
  }

  console.log('📡 starting server')
  console.log(`   - local:           ${localURL}`)
  if (!agent) {
    console.log(
      `   - on your network: ${localURL.replace(hostname, ip.address())}`,
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

// chokidar 4 knows no globs: skip hidden files and folders and node_modules
// below root (a hidden folder above it does not count), and files of other
// types. chokidar asks once without stats and again with them, folders must
// pass the type check, so it waits for the stats.
function ignored(root: string, types: string[]) {
  const all = types.indexOf('*') >= 0

  return function (file: string, stats?: fs.Stats): boolean {
    const hidden = path
      .relative(root, file)
      .split(path.sep)
      .some((part) => part.startsWith('.') || part === 'node_modules')

    if (hidden) return true
    if (all || !stats || !stats.isFile()) return false

    return types.indexOf(path.extname(file).slice(1).toLowerCase()) < 0
  }
}

function isFree(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, host, () => probe.close(() => resolve(true)))
  })
}

function text(value: any, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

// typeof first: a regex test would stringify undefined and accept it
function isName(value: any): boolean {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
}

// to the bus, and as one JSON line to every watcher
function emitEvent(event: object) {
  bus.emit('event', event)
  // escaped like the channel content, the line ends up inside a tag too
  const line = JSON.stringify(event).replace(/</g, '\\u003c') + '\n'
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
    if (now.connected === reported.connected && now.chat === reported.chat) {
      return
    }
    reported.connected = now.connected
    reported.chat = now.chat
    const { root, ...context } = state
    emitEvent({
      type: 'connection',
      agent: '',
      cmd: '',
      params: { connected: now.connected, chat: now.chat },
      context,
    })
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
    record(
      inputs && inputs.length ? { type: 'ai', ask: id, inputs, ...rest } : { type: 'ai', ...rest },
    )
  }
  clients.forEach((client) =>
    client.write(`data: ${JSON.stringify(msg)}\n\n`),
  )
  if (progress !== before || msg.chat) watchQuiet()
  // the agent is done: what it changed shows now, after a burst settled
  if (before && !progress && changedAt) reloadLater(BURST_MS)
}

export function gotoLine(linenumber: number, filename: string) {
  send({ linenumber: linenumber, filename: filename })
}

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
  // a reloaded shell has to know its chat, who it talks to and what is going on
  if ((response as any).chat) {
    const replay: object[] = []
    if (session) replay.push({ sessions: chats.list() }, sessionMessage())
    if (agents.list.length) replay.push(agentsMessage())
    if (progress) replay.push({ status: progress })
    if (hint) replay.push({ hint })
    replay.forEach((msg) => response.write(`data: ${JSON.stringify(msg)}\n\n`))
  }
  clients.push(response)
  connectionChanged()

  request.on('close', () => {
    clients = clients.filter((client) => client !== response)
    connectionChanged()
  })
}
