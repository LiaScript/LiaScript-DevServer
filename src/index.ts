const argv = require('minimist')(process.argv.slice(2))

// with --mcp stdout carries the MCP protocol, everything else goes to stderr
if (argv.mcp) console.log = console.error

import * as server from './lib'
import { mcp } from './mcp'

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
  console.log('DevServer: 1.2.18')
  console.log('LiaScript: 2.2.2')
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
  )
  .catch((e: any) => {
    console.error('Error: ', e.message)
    process.exit()
  })

console.log('✨ hit Ctrl-c to close the server')
