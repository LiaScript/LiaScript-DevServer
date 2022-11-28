const argv = require('minimist')(process.argv.slice(2))

import * as server from './lib'

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
  console.log('DevServer: 1.1.2')
  console.log('LiaScript: 0.10.24')
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
  console.log('-o  --open       open in default browser')
  console.log('-t  --test       test online on https://LiaScript.github.io')
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

try {
  server.start(
    argv.p || argv.port,
    argv.n || argv.hostname,
    argv.i || argv.input,
    argv.r || argv.responsiveVoice || process.env.RESPONSIVE_VOICE_KEY,
    argv.l || argv.live,
    argv.o || argv.open,
    argv.t || argv.test
  )
} catch (e) {
  console.error('Error: ', e.message)
  process.exit()
}

console.log('✨ hit Ctrl-c to close the server')
