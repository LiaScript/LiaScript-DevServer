require('dotenv').config()
import express from 'express'
const app = express()
import doOpen from 'open'
import fs from 'fs'
import path from 'path'
const cors = require('cors')
const handlebars = require('express-handlebars')
const ip = require('ip')

var dirname
var liascriptPath
var reloadPath

init(__dirname)

export function init(node_modules?: string) {
  dirname = node_modules || path.join(__dirname, '../node_modules')

  liascriptPath = path.resolve(path.join(dirname, '@liascript/editor/dist'))

  reloadPath = path.resolve(
    path.join(dirname, 'reloadsh.js/reloader.browser.js')
  )
}

export function run(
  port?: number,
  hostname?: string,
  input?: string,
  responsiveVoice?: string,
  liveReload?: boolean,
  openInBrowser?: boolean,
  testOnline?: boolean
) {
  port = port || 3000
  hostname = hostname || 'localhost'
  openInBrowser = openInBrowser || false
  input = input || '.'
  liveReload = liveReload || false
  testOnline = testOnline || false

  var project = {
    path: null,
    readme: null,
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
      layoutsDir: path.resolve(__dirname + '/../views/layouts'),
      defaultLayout: 'main',
      extname: 'hbs',
    })
  )
  app.set('views', path.resolve(__dirname + '/../views'))

  app.get('/', function (req, res) {
    res.redirect('/home')
  })

  app.get('/home*', function (req, res) {
    const currentPath = project.path + '/' + req.params[0]

    const stats = fs.lstatSync(currentPath)

    // Is it a directory?
    if (stats.isDirectory()) {
      const files = fs.readdirSync(currentPath).filter((e) => {
        return e[0] !== '.'
      })

      let basePath = '/home'
      let pathNames = req.params[0].split('/').filter((e) => {
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
          .map((file) => {
            return {
              name: file,
              href: `http://${hostname}:${port}/home${req.params[0]}/${file}`,
              isDirectory: fs.lstatSync(currentPath + '/' + file).isDirectory(),
            }
          })
          .sort((a, b) => {
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
          }),
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

  app.get('/liascript/', function (req, res) {
    res.redirect('/liascript/index.html')
  })

  app.get('/liascript/index.html', function (req, res) {
    // ------------------------------------
    if (liveReload && responsiveVoice) {
      fs.readFile(liascriptPath + '/index.html', 'utf8', function (err, data) {
        res.send(
          data.replace(
            '</head>',
            `<script type='text/javascript' src='/reloader/reloader.js'></script>
             <script type='text/javascript' src='https://code.responsivevoice.org/responsivevoice.js?key=${responsiveVoice}'></script>
             </head>`
          )
        )
      })
    }
    // ------------------------------------
    else if (liveReload) {
      fs.readFile(liascriptPath + '/index.html', 'utf8', function (err, data) {
        res.send(
          data.replace(
            '</head>',
            `<script type='text/javascript' src='/reloader/reloader.js'></script></head>`
          )
        )
      })
    }
    // ------------------------------------
    else if (responsiveVoice) {
      fs.readFile(liascriptPath + '/index.html', 'utf8', function (err, data) {
        res.send(
          data.replace(
            '</head>',
            `<script type='text/javascript' src='https://code.responsivevoice.org/responsivevoice.js?key=${responsiveVoice}'></script></head>`
          )
        )
      })
    }
    // ------------------------------------
    else {
      res.sendFile(liascriptPath + '/index.html')
    }
  })

  // load everything from the liascript folder
  app.get('/liascript/*', function (req, res) {
    res.sendFile(req.params[0], { root: liascriptPath })
  })
  // ignore this one
  app.get('/sw.js', function (req, res) {})
  app.get('/favicon.ico', function (req, res) {})

  // pass the reloader, to be used for live updates
  app.get('/reloader/reloader.js', function (req, res) {
    res.sendFile(reloadPath)
  })

  // everything else comes from the current project folder
  app.get('/*', cors(), function (req, res) {
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
        project.path,
        project.readme || ''
      )}"`
    )
  }

  server.on('error', (e: any) => {
    console.error('🚨 error =>', e.message)
    process.exit()
  })

  server.listen(port)

  if (openInBrowser) {
    doOpen(localURL)
  }

  console.log('📡 starting server')
  console.log(`   - local:           ${localURL}`)
  console.log(
    `   - on your network: ${localURL.replace(localURL, ip.address())}`
  )
  console.log('✨ hit Ctrl-c to close the server')
}
