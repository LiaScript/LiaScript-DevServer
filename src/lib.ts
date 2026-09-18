import * as express from 'express'

import * as fs from 'fs'
import * as net from 'net'
import * as path from 'path'
import { EventEmitter } from 'events'

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

var clients: any[] = []

// agent bridge (--mcp): what the browser last reported, and the events it sends.
// Never emit an event named 'error' on the bus, an unhandled one throws.
export const bus = new EventEmitter()

var origin = ''
var home = ''
// in agent mode the chat shell, which shows the player in an iframe
var player = '/liascript/index.html'
const state = { root: '', file: '', slide: 1, title: '', selection: '' }

export function getState() {
  return {
    url: state.file ? playerURL(state.file, state.slide) : home,
    ...state,
    connected: clients.length > 0,
    chat: clients.some((client) => client.chat),
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
  try {
    const data = JSON.parse(event.data);
    if (data.filename == filename__) {
      console.log("goto line:", data.linenumber);
      window.LIA.gotoLine(data.linenumber)
    }
  } catch (e) {
    console.warn("gotoLine failed")
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
      selection: String(getSelection()).slice(0, 2000)
    }
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
  // the title is set after the slide change
  var title = document.querySelector('title')
  if (title) new MutationObserver(report).observe(title, {childList: true})

  // Command links: [text](agent:tutor/explain?level=easy), or the same URI in
  // a data-agent attribute. One capturing listener, so it does not matter how
  // the player wires its links. The player prefixes unknown schemes with the
  // course base, so the URI is looked up inside the value.
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-agent],a[href]')
    if (!el) return
    var raw = el.getAttribute('data-agent') || el.getAttribute('href') || ''
    var at = raw.indexOf('agent:')
    if (at < 0 || (at > 0 && raw[at - 1] != '/')) return

    // the player would open the link in a new tab
    e.preventDefault()
    e.stopPropagation()

    var uri
    try { uri = new URL(raw.slice(at)) } catch (x) { return }
    var slash = uri.pathname.indexOf('/')
    var params = {}
    uri.searchParams.forEach(function (value, key) { params[key] = value })

    post({
      type: 'command',
      agent: slash < 0 ? '' : uri.pathname.slice(0, slash),
      cmd: uri.pathname.slice(slash + 1),
      params: params,
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
) {
  port = port || 3000
  hostname = hostname || 'localhost'
  openInBrowser = openInBrowser || false
  input = input || '.'
  liveReload = liveReload || false
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
    const watchPath = path.join(project.path, project.readme || '')
    console.log(`✨ watching for changes on: "${watchPath}"`)

    try {
      reloadInstance = await reload(app, { port: reloadPort(port) })

      // Watch the file for changes using chokidar (more reliable than fs.watch)
      watcher = chokidar.watch(watchPath, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      })

      watcher.on('change', (filePath: string) => {
        console.log('📝 file changed, reloading...')
        reloadInstance.reload()
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
  // ignore this one
  app.get('/sw.js', function (req: express.Request, res: express.Response) {})
  app.get(
    '/favicon.ico',
    function (req: express.Request, res: express.Response) {},
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
      if (['state', 'command', 'chat', 'answer'].indexOf(body.type) < 0) {
        return res.sendStatus(400)
      }

      if (body.context) {
        const c = body.context
        state.file = text(c.file, 500)
        state.slide = c.slide | 0 || 1
        state.title = text(c.title, 200)
        state.selection = text(c.selection, 2000)
      }
      bus.emit('state', getState())

      if (body.type === 'state') {
        return res.sendStatus(204)
      }

      // agent and cmd end up as attributes of the channel tag, params in its
      // body: all of it is page content, so only names and bounded strings.
      // command: agent/cmd from the link. chat: params.text. answer:
      // params.ask plus one entry per input of the form.
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
        (body.type === 'answer' && !isName(params.ask))
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

      const { url, root, connected, chat, ...context } = getState()

      bus.emit('event', {
        type: body.type,
        agent: agentName,
        cmd: command ? body.cmd : '',
        params: checked,
        context,
      })

      return res.sendStatus(204)
    })
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

// server -> every connected browser
export function send(msg: object) {
  clients.forEach((client) =>
    client.write(`data: ${JSON.stringify(msg)}\n\n`),
  )
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
  clients.push(response)

  request.on('close', () => {
    clients = clients.filter((client) => client !== response)
  })
}
