require('dotenv').config()
import * as express from 'express'

import * as fs from 'fs'
import * as path from 'path'

const cors = require('cors')
const handlebars = require('express-handlebars')
const ip = require('ip')
const open = require('open')
const bodyParser = require('body-parser')

const app: express.Application = express()
app.use(bodyParser.json())

var dirname = ''
var node_modules
var reloadPath = ''
var liascriptPath = ''

var clients: any[] = []

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

var serverPointer: any

init(__dirname)

export function init(serverPath?: string, nodeModulesPath?: string) {
  dirname = serverPath || path.join(__dirname, '..')

  node_modules = nodeModulesPath || path.join(dirname, 'node_modules')

  reloadPath = path.resolve(
    path.join(node_modules, 'reloadsh.js/reloader.browser.js')
  )

  liascriptPath = path.resolve(
    path.join(node_modules, '@liascript/editor/dist')
  )
}

export function start(
  port?: number,
  hostname?: string,
  input?: string,
  responsiveVoice?: string,
  liveReload?: boolean,
  openInBrowser?: boolean,
  testOnline?: boolean,
  gotoCallback?: (linenumber: number, filename: string) => void
) {
  port = port || 3000
  hostname = hostname || 'localhost'
  openInBrowser = openInBrowser || false
  input = input || '.'
  liveReload = liveReload || false
  testOnline = testOnline || false

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
    })
  )
  app.set('views', path.resolve(path.join(dirname, 'views')))

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
              }
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
            }
          ),
      })
    } else if (stats.isFile()) {
      if (req.params[0].toLocaleLowerCase().endsWith('.md')) {
        if (testOnline) {
          res.redirect(
            `https://LiaScript.github.io/course/?http://${hostname}:${port}/${req.params[0]}`
          )
        } else {
          res.redirect(
            `/liascript/index.html?http://${hostname}:${port}/${req.params[0]}`
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
    }
  )

  app.get(
    '/liascript/index.html',
    function (req: express.Request, res: express.Response) {
      // ------------------------------------
      if (liveReload && responsiveVoice) {
        fs.readFile(
          liascriptPath + '/index.html',
          'utf8',
          function (err: any, data: string) {
            res.send(
              data.replace(
                '</head>',
                `<script type='text/javascript' src='/reloader/reloader.js'></script>
             <script type='text/javascript' src='https://code.responsivevoice.org/responsivevoice.js?key=${responsiveVoice}'></script>
             ${gotoScript}
             </head>`
              )
            )
          }
        )
      }
      // ------------------------------------
      else if (liveReload) {
        fs.readFile(
          liascriptPath + '/index.html',
          'utf8',
          function (err: any, data: string) {
            res.send(
              data.replace(
                '</head>',
                `<script type='text/javascript' src='/reloader/reloader.js'></script>
                ${gotoScript}
                </head>`
              )
            )
          }
        )
      }
      // ------------------------------------
      else if (responsiveVoice) {
        fs.readFile(
          liascriptPath + '/index.html',
          'utf8',
          function (err: any, data: string) {
            res.send(
              data.replace(
                '</head>',
                `<script type='text/javascript' src='https://code.responsivevoice.org/responsivevoice.js?key=${responsiveVoice}'></script>
                ${gotoScript}
                </head>`
              )
            )
          }
        )
      }
      // ------------------------------------
      else {
        fs.readFile(
          liascriptPath + '/index.html',
          'utf8',
          function (err: any, data: string) {
            res.send(data.replace('</head>', `${gotoScript}</head>`))
          }
        )
      }
    }
  )

  // load everything from the liascript folder
  app.get(
    '/liascript/*',
    function (req: express.Request, res: express.Response) {
      res.sendFile(req.params[0], { root: liascriptPath })
    }
  )
  // ignore this one
  app.get('/sw.js', function (req: express.Request, res: express.Response) {})
  app.get(
    '/favicon.ico',
    function (req: express.Request, res: express.Response) {}
  )

  // pass the reloader, to be used for live updates
  app.get(
    '/reloader/reloader.js',
    function (req: express.Request, res: express.Response) {
      res.sendFile(reloadPath)
    }
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
          "lineGoto event with wrong datatype, you have to provide {'linenumber': int, 'filename': string}"
        )
      }
    }
    return res.json({})
  })

  // everything else comes from the current project folder
  app.get('/*', cors(), function (req: express.Request, res: express.Response) {
    res.sendFile(req.originalUrl, { root: project.path })
  })

  let localURL = 'http://' + hostname + ':' + port

  if (project.path && project.readme) {
    localURL +=
      '/liascript/index.html?http://' +
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

  const server = require('reloadsh.js')(
    app,
    liveReload ? [path.join(project.path, project.readme || '')] : []
  )

  if (liveReload) {
    console.log(
      `✨ watching for changes on: "${path.join(
        project.path || '',
        project.readme || ''
      )}"`
    )
  }

  server.on('error', (e: any) => {
    throw e
  })

  server.listen(port)

  if (openInBrowser) {
    open(localURL)
  }

  console.log('📡 starting server')
  console.log(`   - local:           ${localURL}`)
  console.log(
    `   - on your network: ${localURL.replace(hostname, ip.address())}`
  )

  serverPointer = server
}

export function stop() {
  if (serverPointer) {
    serverPointer.close()
  }
}

export function gotoLine(linenumber: number, filename: string) {
  clients.forEach((client) =>
    client.response.write(
      `data: ${JSON.stringify({
        linenumber: linenumber,
        filename: filename,
      })}\n\n`
    )
  )
}

function eventsHandler(
  request: express.Request,
  response: express.Response,
  next: any
) {
  const headers = {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  }
  response.writeHead(200, headers)

  const data = `data: \n\n`

  response.write(data)

  const clientId = Date.now()

  const newClient = {
    id: clientId,
    response,
  }

  clients.push(newClient)

  request.on('close', () => {
    console.log(`${clientId} Connection closed`)
    clients = clients.filter((client) => client.id !== clientId)
  })
}
