// The share page: dials the DevServer of the teacher (src/share.ts) in the
// room of the link (#room=…&key=…), holds the WebRTC connection and shows
// its UI in a frame. The service worker hands every request of that frame
// here, this page sends it over the data channel and passes the answer back.
// Web pages in the shell run under another origin (web=… of the link), so
// they never reach the chat: there lia-share-relay.html hands their requests
// here, and they go to the proxy of the DevServer.
import { signal, channel, SIGNALING, STUN, SILENT_MS } from './lia-rtc.mjs'

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

  // TURN servers for networks without a direct way (mobile, school firewalls)
  // and the signalling servers: written from the secrets WEBRTC_ICE_SERVERS
  // and WEBRTC_SIGNALING_SERVERS when this page is published
  const list = (file) =>
    fetch(file, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : []))
      .then((v) => (Array.isArray(v) ? v : []))
      .catch(() => [])
  const [iceServers, own] = await Promise.all([list('ice.json'), list('signaling.json')])
  // &relay in the link: through TURN only, to test it
  const config = { iceServers: iceServers.length ? iceServers : STUN, ...(link.has('relay') ? { iceTransportPolicy: 'relay' } : {}) }

  let me = null // this tab's id in the room, new for every dial
  let pc = null
  let ch = null // the open channel
  let host = null
  let heard = 0 // the last message of the host
  let probe = 0 // a ping sent after a network change
  let dialed = 0
  let next = 0
  const pending = new Map()
  let frame = null
  let lost = false

  // the requests of a link that died fail, their pages ask again
  function gone() {
    for (const port of pending.values()) port.postMessage({ error: 'The teacher’s server is gone.' })
    pending.clear()
    lost = true
  }

  function hangUp() {
    const old = pc
    pc = ch = host = null
    try {
      old?.close()
    } catch (e) {}
  }

  function lose(why) {
    if (!pc) return
    log('lost: ' + why)
    hangUp()
    gone()
    say('Connection lost, waiting for the teacher’s server…')
    dial()
  }

  // A new id each time: the host may still hold the dead link of the old one.
  function dial() {
    hangUp()
    dialed = Date.now()
    const id = (me = Math.random().toString(36).slice(2, 12))
    const p = (pc = new RTCPeerConnection(config))
    const dc = p.createDataChannel('lia')
    const c = channel(dc, onJson, onChunk)
    p.onicecandidate = ({ candidate }) => candidate && pc == p && sig.send({ from: id, candidate })
    p.onconnectionstatechange = () => pc == p && p.connectionState == 'failed' && lose('ICE failed')
    dc.onopen = () => {
      if (pc != p) return
      ch = c
      heard = Date.now()
      log('host ' + host)
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
    dc.onclose = () => pc == p && lose('channel closed')
    p.createOffer()
      .then((offer) => p.setLocalDescription(offer))
      .then(() => pc == p && sig.send({ from: id, sdp: p.localDescription }))
      .catch((e) => log('offer: ' + e.message))
  }

  let answer = null // the remote description, candidates wait for it
  function onSignal(m) {
    if (m.hello) {
      // a host that (re)started: a link to an older one is dead
      if (ch ? m.from != host : Date.now() - dialed > 1000) {
        if (ch) lose('the host restarted')
        else dial()
      }
      return
    }
    if (m.to != me || !pc) return
    if (m.sdp?.type == 'answer' && !host) {
      host = m.from
      answer = pc.setRemoteDescription(m.sdp)
      answer.catch((e) => log('answer: ' + e.message))
    } else if (m.candidate && m.from == host) {
      const p = pc
      answer.then(() => p.addIceCandidate(m.candidate)).catch(() => {})
    }
  }

  const sig = await signal({
    urls: own.length ? own : SIGNALING,
    room: link.get('room'),
    key: link.get('key'),
    WebSocket,
    onMessage: onSignal,
    onOpen: () => !ch && Date.now() - dialed > 2000 && dial(),
  })

  // No answer, or a link that went silent (the host pings every 5 s): Chrome
  // leaves a dead link in ICE `disconnected` for good, a phone that slept or
  // changed its network hears nothing on it.
  setInterval(() => {
    const now = Date.now()
    if (ch && now - heard > SILENT_MS) lose('silent for ' + Math.round((now - heard) / 1000) + ' s')
    else if (ch && probe && heard < probe && now - probe > 3000) lose('no answer after the network changed')
    else if (!ch && now - dialed > 8000) dial()
  }, 1000)
  // the network changed or the page is back: signalling and link are asked
  const back = () => {
    sig.now()
    if (!ch) return
    probe = Date.now()
    ch.json({ kind: 'ping' }).catch(() => {})
  }
  addEventListener('online', back)
  document.addEventListener('visibilitychange', () => document.visibilityState == 'visible' && back())
  navigator.connection?.addEventListener?.('change', back)

  function onJson(data) {
    heard = Date.now()
    if (data.kind == 'ping') return ch?.json({ kind: 'pong' }).catch(() => {})
    if (data.kind != 'res') return
    const port = pending.get(data.id)
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

  function onChunk(id, bytes) {
    heard = Date.now()
    const t = trace.get(id)
    if (t) t.bytes += bytes.length
    pending.get(id)?.postMessage({ chunk: bytes })
  }

  // a request of a service worker, its answer goes back through port
  function forward(data, port, isWeb) {
    if (!port) return
    // a request of another share tab
    if (data.tab !== tab) return port.postMessage({ notMine: true })
    if (!ch) return port.postMessage({ error: 'Not connected.' })
    const via = ch
    const id = ++next
    pending.set(id, port)
    port.onmessage = () => {
      pending.delete(id)
      via.json({ kind: 'abort', id }).catch(() => {})
    }
    const { body, tab: _, ...meta } = data
    // the login of a server with users (liadev --users), its page sets it
    let token = null
    try {
      token = sessionStorage.getItem('lia-share-token')
    } catch (e) {}
    if (debug) trace.set(id, { path: meta.path, t: Date.now(), bytes: 0, status: 0 })
    const m = { kind: 'req', ...meta, id, origin: here, web: isWeb, ...(web ? { webOrigin: web.href.replace(/\/$/, '') + '/tab-' + tab } : {}), ...(token ? { token } : {}), gzip: typeof DecompressionStream == 'function' }
    // the pieces of a body first, the head starts the request
    via
      .body(id, body ? new Uint8Array(body) : new Uint8Array(0))
      .then(() => via.json(m))
      .catch(() => {})
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

  // requests that never finish, e.g. a script that stopped halfway
  if (debug)
    setInterval(() => {
      for (const t of trace.values()) if (!t.warned && Date.now() - t.t > 15000 && !/gotoLine/.test(t.path)) (t.warned = true), log('… ' + t.path.slice(0, 70) + ' still open, ' + t.bytes + ' B')
    }, 5000)
}
