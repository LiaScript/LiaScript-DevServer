// The share page: joins the room of the link (#room=…&key=…), holds the
// WebRTC connection to the DevServer of the teacher (src/share.ts) and shows
// its UI in a frame. The service worker hands every request of that frame
// here, this page sends it over the data channel and passes the answer back.
// Web pages in the shell run under another origin (web=… of the link), so
// they never reach the chat: there lia-share-relay.html hands their requests
// here, and they go to the proxy of the DevServer.
import { joinRoom } from 'https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.26.0/+esm'

const APP = 'liascript-devserver-share'
const status = document.getElementById('status')
const link = new URLSearchParams(location.hash.slice(1))
const web = link.get('web') ? new URL(link.get('web')) : null
// this page may sit in a folder (https://liascript.github.io/share/): the
// server hands out paths below it, the service worker strips it again
// and the UI of this tab sits below tab-<id>, apart from other tabs
const tab = Math.random().toString(36).slice(2, 10)
const folder = new URL('.', location.href).href.replace(/\/$/, '')
const here = folder + '/tab-' + tab

// &debug in the link: a log of every request and of every error of the
// frames at the bottom of the page, to see on a phone what goes wrong
const debug = link.has('debug') ? document.createElement('pre') : null
const trace = new Map()
if (debug) {
  debug.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;height:35vh;margin:0;overflow:auto;z-index:9;font:11px/1.3 monospace;background:#000c;color:#0f0;padding:4px;white-space:pre-wrap'
  document.body.append(debug)
  addEventListener('error', (e) => log('ERR top: ' + e.message))
  // the frames are of this origin: their errors and console.error
  setInterval(() => {
    const visit = (w) => {
      for (let i = 0; i < w.frames.length; i++) {
        try {
          const f = w.frames[i]
          if (!f.__liaDebug) {
            f.__liaDebug = true
            const where = f.location.pathname.split('/').slice(-1)[0] || '/'
            f.addEventListener('error', (e) => log('ERR ' + where + ': ' + (e.message || e.target?.src || e.type)), true)
            f.addEventListener('unhandledrejection', (e) => log('REJ ' + where + ': ' + (e.reason?.message || e.reason)))
            const error = f.console.error
            f.console.error = (...a) => (log('CON ' + where + ': ' + a.join(' ').slice(0, 300)), error.apply(f.console, a))
          }
          visit(f)
        } catch (e) {}
      }
    }
    visit(window)
  }, 50)
}
function log(line) {
  if (!debug) return
  debug.textContent += new Date().toTimeString().slice(0, 8) + ' ' + line + '\n'
  debug.scrollTop = debug.scrollHeight
}

function say(text) {
  log(text)
  status.textContent = text
  status.hidden = false
}

if (!link.get('room') || !link.get('key')) {
  say('This link is incomplete, ask for a new one.')
} else {
  start().catch((e) => say('Could not connect: ' + e.message))
}

async function start() {
  // the newest worker before the frame: an older one from the cache of the
  // browser does not know the paths of this page and answered 404
  const reg = await navigator.serviceWorker.register('lia-share-sw.js', { updateViaCache: 'none' })
  await reg.update().catch(() => {})
  const fresh = reg.installing || reg.waiting
  if (fresh && fresh.state != 'activated') {
    await new Promise((resolve) => fresh.addEventListener('statechange', () => fresh.state == 'activated' && resolve()))
  }
  await navigator.serviceWorker.ready

  // TURN servers for networks without a direct way (mobile, school firewalls):
  // ice.json is written from the secret ICE_SERVERS when this page is published
  const ice = await fetch('ice.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
  const peers = joinRoom(
    { appId: APP, password: link.get('key'), ...(Array.isArray(ice) && ice.length ? { turnConfig: ice } : {}) },
    link.get('room'),
  )
  const hello = peers.makeAction('hello')
  const req = peers.makeAction('req')
  const res = peers.makeAction('res')
  const abort = peers.makeAction('abort')

  let host = null
  let next = 0
  const pending = new Map()
  let frame = null
  let lost = false

  // the requests of a host that left fail, their pages ask again
  function gone() {
    for (const port of pending.values()) port.postMessage({ error: 'The teacher’s server is gone.' })
    pending.clear()
    lost = true
  }

  hello.onMessage = (data, { peerId }) => {
    if (!data?.host) return
    // a restarted host is a new peer, the old one may not have left yet
    if (host && host != peerId) gone()
    host = peerId
    log('host ' + peerId)
    status.hidden = true
    if (!frame) {
      frame = document.createElement('iframe')
      frame.src = here + '/'
      document.body.append(frame)
    } else if (lost) {
      // back after a restart: an event stream that failed does not retry
      lost = false
      frame.contentWindow.location.reload()
    }
  }

  peers.onPeerLeave = (peerId) => {
    if (peerId != host) return
    host = null
    gone()
    say('Connection lost, waiting for the teacher’s server…')
  }

  // a request of a service worker, its answer goes back through port
  function forward(data, port, isWeb) {
    if (!port) return
    // a request of another share tab
    if (data.tab !== tab) return port.postMessage({ notMine: true })
    if (!host) return port.postMessage({ error: 'Not connected.' })
    const id = ++next
    pending.set(id, port)
    port.onmessage = () => {
      pending.delete(id)
      if (host) abort.send({ id }, { target: host })
    }
    const { body, tab: _, ...meta } = data
    // the login of a server with users (liadev --users), its page sets it
    let token = null
    try {
      token = sessionStorage.getItem('lia-share-token')
    } catch (e) {}
    if (debug) trace.set(id, { path: meta.path, t: Date.now(), bytes: 0, status: 0 })
    const m = { ...meta, id, origin: here, web: isWeb, ...(web ? { webOrigin: web.href.replace(/\/$/, '') + '/tab-' + tab } : {}), ...(token ? { token } : {}), gzip: typeof DecompressionStream == 'function' }
    if (body) req.send(new Uint8Array(body), { target: host, metadata: m })
    else req.send(m, { target: host })
  }
  navigator.serviceWorker.onmessage = ({ data, ports: [port] }) => forward(data, port, false)

  if (web) {
    const relay = document.createElement('iframe')
    relay.style.display = 'none'
    relay.src = new URL('lia-share-relay.html?tab=' + tab, web).href
    relay.onload = () => {
      const { port1, port2 } = new MessageChannel()
      port1.onmessage = ({ data, ports: [port] }) => forward(data, port, true)
      relay.contentWindow.postMessage('lia-share', web.origin, [port2])
    }
    document.body.append(relay)
  }

  res.onMessage = (data, { metadata }) => {
    if (metadata) {
      const t = trace.get(metadata.id)
      if (t) t.bytes += data.byteLength || data.length || 0
      pending.get(metadata.id)?.postMessage({ chunk: data })
      return
    }
    const port = pending.get(data?.id)
    if (!port) return
    // the room names the cache of the worker: files of one teacher's server
    // never answer for another
    port.postMessage(data.status ? { ...data, room: link.get('room') } : data)
    const t = trace.get(data.id)
    if (t && data.status) (t.status = data.status), (t.gzip = data.gzip)
    if (t && (data.end || data.error)) {
      log(t.status + ' ' + t.path.slice(0, 70) + ' ' + t.bytes + ' B' + (t.gzip ? ' gz' : '') + ' ' + (Date.now() - t.t) + ' ms' + (data.error ? ' ' + data.error : ''))
      trace.delete(data.id)
    }
    if (data.end || data.error) pending.delete(data.id)
  }
  // requests that never finish, e.g. a script that stopped halfway
  if (debug)
    setInterval(() => {
      for (const t of trace.values()) if (!t.warned && Date.now() - t.t > 15000 && !/gotoLine/.test(t.path)) (t.warned = true), log('… ' + t.path.slice(0, 70) + ' still open, ' + t.bytes + ' B')
    }, 5000)
}
