const argv = require('minimist')(process.argv.slice(2))
import packageJson from '../package.json'

// with --mcp stdout carries the MCP protocol, everything else goes to stderr
if (argv.mcp) console.log = console.error

import * as server from './lib'
import { mcp } from './mcp'
import { host } from './acp'

import { PAGE as SHARE_PAGE } from './share'

function liascript() {
  console.log(' _     _       ____            _       _')
  console.log('| |   (_) __ _/ ___|  ___ _ __(_)_ __ | |_')
  console.log("| |   | |/ _` \\___ \\ / __| '__| | '_ \\| __|")
  console.log('| |___| | (_| |___) | (__| |  | | |_) | |_ ')
  console.log('|_____|_|\\__,_|____/ \\___|_|  |_| .__/ \\__|')
  console.log('                                |_|')
  console.log()
}

if (argv.v || argv.version) {
  console.log('DevServer:', packageJson.version.split('--')[0])
  console.log('LiaScript:', packageJson.version.split('--')[1])
  process.exit()
}

if (argv.h || argv.help) {
  liascript()

  console.log('-h  --help       show this help')
  console.log('-v  --version    show version information')
  console.log('-i  --input      input README.md file or folder (default: .)')
  console.log('-n  --hostname   hostname of your server (default: localhost)')
  console.log('-p  --port       used port number (default: 3000)')
  console.log('-l  --live       do live reload on file change')
  console.log('-w  --watch      file types that trigger the live reload,')
  console.log('                 comma separated, * for all, implies --live,')
  console.log('                 hidden files and node_modules never count')
  console.log('                 (default: ' + server.WATCH.join(',') + ')')
  console.log('-o  --open       open in default browser')
  console.log('-t  --test       test online on https://LiaScript.github.io')
  console.log('    --mcp        serve as MCP server on stdio for AI agents,')
  console.log('                 to be started from the MCP config of the agent')
  console.log('    --agent      start an AI for the chat over ACP: claude (default),')
  console.log('                 codex, gemini or the command of an ACP agent')
  console.log('    --users      DIR: one start for many users, each logs in over')
  console.log('                 the share link and gets DIR/<name> and an agent')
  console.log('                 of their own (with --share); -p is the port of')
  console.log('                 the admin page')
  console.log('    --lan        [PORT] --users also on the network of the school,')
  console.log('                 without share page and internet (default: 8000)')
  console.log('    --no-sandbox the agents of --users without bubblewrap')
  console.log('    --student-model, --author-model  the model of the agents of')
  console.log('                 that role (ANTHROPIC_MODEL), e.g. haiku; the key')
  console.log('                 comes from ANTHROPIC_API_KEY, else your login')
  console.log('    --kit        DIR: the Teaching-Agent (its CLAUDE.md, AGENTS.md,')
  console.log('                 specs/) for authors of --users, chosen per user')
  console.log('    --courses    DIR: its subfolders are the courses the admin')
  console.log('                 page copies for a new user (default: .)')
  console.log('    --share      share it over WebRTC, prints a link for other')
  console.log('                 browsers; --share URL names the share page')
  console.log('                 (default: ' + SHARE_PAGE + ');')
  console.log('                 the link stays the same for this folder')
  console.log('    --share-new  a new link, the old one stops working')
  console.log('    --share-web  the share page under another origin, for web')
  console.log('                 pages (default: the other one of localhost and')
  console.log('                 127.0.0.1, else none)')
  console.log('    --proxy      web pages in the chat of --mcp: off, read (default:')
  console.log('                 the document only, no logins) or full (experimental:')
  console.log('                 everything, cookies, forms, single page apps; some')
  console.log('                 sites hang Firefox, the browser extension is safer)')
  console.log()
  console.log('-r  --responsiveVoice  add optional responsiveVoice support,')
  console.log('                       or pass your own responsiveVoice key.')
  console.log('                       Adding this feature might slow down')
  console.log('                       the reloading speed.')
  console.log('                       For more information visit:')
  console.log('                       https://responsivevoice.org')

  process.exit()
}

liascript()

// --users DIR: one start for many users, each with a DevServer of their own
if (argv.users) {
  if (argv.mcp) {
    console.error('--users starts a DevServer with its agent per user, --mcp does not fit')
    process.exit(1)
  }
  if (typeof argv.users != 'string') {
    console.error('--users needs the folder of the users, e.g. --users ../klasse')
    process.exit(1)
  }
  if (argv.i || argv.input) {
    console.error('-i does not apply to --users: every user has a folder of their own,')
    console.error('copy a course into it on the admin page when you create the user')
    process.exit(1)
  }
  // only the flags given: the rest comes from the last start (DIR/.gateway.json)
  const resolve = require('path').resolve
  const given: any = {}
  if (typeof argv.courses == 'string') given.courses = resolve(argv.courses)
  if (typeof argv.kit == 'string') given.kit = resolve(argv.kit)
  if (argv.p || argv.port) given.admin = Number(argv.p || argv.port)
  if (typeof argv.agent == 'string') given.agent = argv.agent
  const models = Object.fromEntries(['student', 'author'].filter((r) => typeof argv[r + '-model'] == 'string').map((r) => [r, argv[r + '-model']]))
  if (Object.keys(models).length) given.models = models
  if (argv.share)
    given.share = {
      on: true,
      ...(typeof argv.share == 'string' ? { page: argv.share } : {}),
      ...(typeof argv['share-web'] == 'string' ? { web: argv['share-web'] } : {}),
    }
  if (argv.lan) given.lan = { on: true, ...(argv.lan !== true ? { port: Number(argv.lan) } : {}) }
  require('./gateway')
    .gateway({
      dir: argv.users,
      given,
      // minimist turns --no-sandbox into sandbox: false
      sandbox: argv.sandbox !== false,
      fresh: !!argv['share-new'],
    })
    .catch((e: any) => {
      console.error('Error: ', e.message)
      process.exit(1)
    })
} else serve()

// one DevServer, the way it always was
function serve() {
  server.init(argv.node_modules)

  if (argv.mcp && argv.agent) {
    console.error('--mcp waits for an agent, --agent starts one: take one of them')
    process.exit(1)
  }

  // before start(), so the handshake does not wait for the reload setup
  if (argv.mcp) mcp()

  // -w md,css or -w .md,*.css, a bare -w keeps the default types
  const types = argv.w ?? argv.watch
  const watch =
    types === undefined
      ? undefined
      : types === true
        ? server.WATCH
        : String(types)
            .split(',')
            .map((type) => type.trim().toLowerCase().replace(/^\*?\./, ''))
            .filter(Boolean)

  server
    .start(
      argv.p || argv.port,
      argv.n || argv.hostname,
      argv.i || argv.input,
      argv.r || argv.responsiveVoice || process.env.RESPONSIVE_VOICE_KEY,
      argv.l || argv.live,
      argv.o || argv.open,
      argv.t || argv.test,
      undefined,
      argv.mcp || !!argv.agent,
      watch,
      argv.proxy,
    )
    .then(() => {
      if (argv.agent) host(typeof argv.agent == 'string' ? argv.agent : 'claude').catch((e) => console.error('🤖', e.message))
      if (!argv.share) return
      // loaded only here: WebRTC is a module of its own
      const { share, otherOrigin } = require('./share')
      const page = typeof argv.share == 'string' ? argv.share : SHARE_PAGE
      const { link, holder } = share({
        local: server.localOrigin(),
        proxy: server.proxyOrigin(),
        root: server.getState().root,
        page,
        web: typeof argv['share-web'] == 'string' ? argv['share-web'] : otherOrigin(page),
        fresh: !!argv['share-new'],
      })
      if (holder) return console.log('🔗 not shared: the instance with pid ' + holder + ' shares this folder')
      server.localOrigin(link)
      console.log('🔗 share: ' + link)
    })
    .catch((e: any) => {
      console.error('Error: ', e.message)
      process.exit()
    })

  console.log('✨ hit Ctrl-c to close the server')
}
