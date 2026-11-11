const argv = require('minimist')(process.argv.slice(2))
import packageJson from '../package.json'

// with --mcp stdout carries the MCP protocol, everything else goes to stderr
if (argv.mcp) console.log = console.error

import * as server from './lib'
import { mcp } from './mcp'
import { init } from './init'
import { PAGE as SHARE_PAGE, remembered } from './share'

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

  console.log('init             put the teaching agent, the LiaScript skills and a')
  console.log('                 .mcp.json into this folder, keeps existing files')
  console.log('update           fetch the teaching agent and the skills again,')
  console.log('                 replaces their files, keeps .mcp.json')
  console.log()
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
  console.log('    --share      share it over WebRTC, prints a link for other')
  console.log('                 browsers, e.g. a phone; --share URL names the share')
  console.log('                 page (default: ' + SHARE_PAGE + ');')
  console.log('                 the link stays the same for this folder. With')
  console.log('                 --mcp the phone button of the chat switches it')
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

const command = argv._[0]
if (command === 'init' || command === 'update') {
  init(command === 'update').then(
    () => process.exit(),
    (e: any) => {
      console.error('Error: ', e.message)
      process.exit(1)
    },
  )
} else {
  server.init(argv.node_modules)

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
      argv.mcp,
      watch,
      argv.proxy,
    )
    .then(() => {
      if (!argv.mcp) {
        if (argv.share) share(false)
        return
      }
      // the 📱 of the chat and the tool share switch it at runtime
      server.onShare({ on: share, off: () => (stopShare?.(), (stopShare = null)), remembered: remembered(server.getState().root) })
      if (argv.share) {
        const r = server.setShare(true, false)
        if (r.error) console.log('🔗 not shared: ' + r.error)
      }
    })
    .catch((e: any) => {
      console.error('Error: ', e.message)
      process.exit()
    })

  console.log('✨ hit Ctrl-c to close the server')
}

// WebRTC loads only here, when a link is asked for. share.ts is bundled, it
// loads werift itself through createRequire, parcel would hoist a require(
let stopShare: (() => void) | null = null
let renewed = false
function share(take: boolean, lost?: () => void): { link?: string; error?: string } {
  const { share, otherOrigin } = require('./share')
  const page = typeof argv.share == 'string' ? argv.share : SHARE_PAGE
  const r = share({
    local: server.localOrigin(),
    proxy: server.proxyOrigin(),
    root: server.getState().root,
    page,
    web: typeof argv['share-web'] == 'string' ? argv['share-web'] : otherOrigin(page),
    // a new link once per start
    fresh: !!argv['share-new'] && !renewed,
    take,
    lost: () => {
      stopShare = null
      console.log('🔗 another instance shares this folder now')
      lost?.()
    },
  })
  if (r.holder) {
    console.log('🔗 not shared: the instance with pid ' + r.holder + ' shares this folder')
    return { error: 'The instance with pid ' + r.holder + ' shares this folder.' }
  }
  stopShare = r.stop
  renewed = true
  console.log('🔗 share: ' + r.link)
  return { link: r.link }
}
