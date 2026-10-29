// --share: this server for browsers elsewhere, over WebRTC (see
// docs/superpowers/specs/2026-10-26-shared-devserver-webrtc-design.md).
// The page share/index.html dials this host, its service worker hands every
// request of the UI to it, it sends them here over the data channel, and this
// host replays them on the local server and streams the answer back. The
// signalling (share/lia-rtc.mjs, the same module as the page's) goes over
// the y-webrtc servers of WEBRTC_SIGNALING_SERVERS, sealed with the key of
// the link; the data itself is DTLS end to end.
// Web pages come through a second page under another origin (web), so that a
// page never reaches the chat; its requests go to the proxy of lib.ts.
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import { signal, channel, PING_MS, SILENT_MS, SIGNALING, STUN } from '../share/lia-rtc.mjs'

// one room per project, kept until the teacher asks for a new link (fresh);
// turn and signaling: optional servers of its own, instead of those the share
// page publishes
const FILE = path.join(os.homedir(), '.config', 'liascript', 'share.json')

// request headers of the browser worth passing on, the rest is its business
const PASS = ['accept', 'accept-language', 'content-type', 'cache-control', 'if-none-match', 'if-modified-since', 'range', 'last-event-id']
// text worth packing: scripts shrink to about a quarter
const PACK = /^(text\/|application\/(javascript|json|xml|x-ndjson)|image\/svg)/
// what fetch decoded already or the page has to compute itself
const DROP = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']

type Options = {
  local: string // this server
  proxy: string // its proxy of web pages, '' if off
  root: string // the project, its room
  page: string // the address of share/index.html
  web?: string // the same page under another origin, for web pages
  fresh?: boolean // a new room, the old link stops working
}

// Returns the link to hand out: room and key travel in the fragment, which no
// server gets to see. The key seals the signalling and keeps out who does not
// have the link.
export function share(o: Options) {
  // parcel hoists every require( to the top of the bundle, this one it
  // cannot see: WebRTC loads only with --share
  const load = require('module').createRequire(__filename)
  const { RTCPeerConnection } = load('werift')
  // Node 20 has no WebSocket of its own
  const WebSocket = (globalThis as any).WebSocket || load('ws')

  let saved: any = {}
  try {
    saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch (e) {}
  saved.rooms = saved.rooms || {}
  if (o.fresh || !saved.rooms[o.root]) {
    saved.rooms[o.root] = { room: crypto.randomBytes(16).toString('hex'), key: crypto.randomBytes(16).toString('hex') }
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(saved, null, 2), { mode: 0o600 })
  }
  const { room, key } = saved.rooms[o.root]
  // one host per room: VS Code starts a workspace .mcp.json for Copilot next
  // to Claude Code, and two hosts in one room take the browser from each other
  const holder = claim(path.join(path.dirname(FILE), 'share-' + room + '.pid'))
  if (holder) return { holder }

  // the room opens once the servers are known, the link is ready now
  Promise.all([
    Array.isArray(saved.turn) ? saved.turn : published(o.page, 'ice.json'),
    Array.isArray(saved.signaling) && saved.signaling.length ? saved.signaling : published(o.page, 'signaling.json'),
  ])
    .then(([ice, urls]) => {
      if (!urls.length) urls = SIGNALING
      if (!ice.length) ice = STUN
      if (ice.length) console.log('🔗 TURN: ' + ice.map((s: any) => [].concat(s.urls).join(' ')).join(', '))
      console.log('🔗 signalling: ' + urls.join(', '))
      return host({ ice, urls, room, key, RTCPeerConnection, WebSocket }, o)
    })
    .catch((e) => console.error('🔗 not shared:', e.message))

  return { link: o.page + '#room=' + room + '&key=' + key + (o.proxy && o.web ? '&web=' + encodeURIComponent(o.web) : '') }
}

// A list the share page publishes, written from a secret of its repository:
// ice.json (WEBRTC_ICE_SERVERS, TURN for a phone behind the NAT of its
// carrier) and signaling.json (WEBRTC_SIGNALING_SERVERS)
async function published(page: string, file: string): Promise<any[]> {
  try {
    const r = await fetch(new URL(file, page), { signal: AbortSignal.timeout(5000) })
    const list = r.ok ? await r.json() : []
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

// Answers every offer sealed with the key: one connection per browser tab.
// The tab dials again under a new id when its link dies, the old entry goes
// when its connection fails or its channel stays silent.
async function host(c: any, o: Options) {
  const me = crypto.randomBytes(8).toString('hex')
  const peers = new Map<string, { pc: any; ready: Promise<void> }>()
  const drop = (from: string, pc: any) => {
    if (peers.get(from)?.pc != pc) return
    peers.delete(from)
    console.log('🔗 left', from)
    try {
      pc.close()
    } catch (e) {}
  }
  let sig: any = null
  sig = await signal({
    urls: c.urls,
    room: c.room,
    key: c.key,
    WebSocket: c.WebSocket,
    // waiting tabs dial at once, also after a restart of this host
    onOpen: () => sig?.send({ from: me, hello: true }),
    onMessage(m: any) {
      if (!m || typeof m.from != 'string' || m.from == me || (m.to && m.to != me)) return
      const known = peers.get(m.from)
      if (m.sdp?.type == 'offer') {
        // the same offer over a second server
        if (known) return
        const pc = new c.RTCPeerConnection({ iceServers: c.ice })
        const early: any[] = []
        let answered = false
        pc.onicecandidate = ({ candidate }: any) => {
          if (!candidate) return
          const msg = { from: me, to: m.from, candidate }
          answered ? sig.send(msg) : early.push(msg)
        }
        pc.ondatachannel = ({ channel: dc }: any) => serve(dc, () => drop(m.from, pc), o)
        pc.onconnectionstatechange = () => ['failed', 'closed'].includes(pc.connectionState) && drop(m.from, pc)
        const ready = (async () => {
          await pc.setRemoteDescription(m.sdp)
          await pc.setLocalDescription(await pc.createAnswer())
          await sig.send({ from: me, to: m.from, sdp: pc.localDescription })
          answered = true
          for (const msg of early) sig.send(msg)
        })()
        peers.set(m.from, { pc, ready })
        console.log('🔗 shared with', m.from)
        ready.catch((e) => (console.error('🔗', m.from, e.message), drop(m.from, pc)))
        // a tab that never gets through
        setTimeout(() => pc.connectionState != 'connected' && drop(m.from, pc), 30000)
      } else if (m.candidate && known) {
        known.ready.then(() => known.pc.addIceCandidate(m.candidate)).catch(() => {})
      }
    },
  })
}

// One data channel: requests come as their body pieces first, then their
// head ({kind: 'req'}); answers go back as head, pieces and end.
function serve(dc: any, drop: () => void, o: Options) {
  const open = new Map<number, AbortController>()
  const bodies = new Map<number, Uint8Array[]>()
  let heard = Date.now()
  const ch = channel(
    dc,
    (m: any) => {
      heard = Date.now()
      if (m?.kind == 'ping') ch.json({ kind: 'pong' }).catch(() => {})
      else if (m?.kind == 'abort') open.get(m.id)?.abort()
      else if (m?.kind == 'req') request(m, bodies.get(m.id))
    },
    (id: number, bytes: Uint8Array) => {
      heard = Date.now()
      if (!bodies.has(id)) bodies.set(id, [])
      bodies.get(id)!.push(bytes)
    },
  )
  // a channel that stays silent is dead: a phone slept or changed its network
  const ping = setInterval(() => {
    if (Date.now() - heard > SILENT_MS) return close()
    ch.json({ kind: 'ping' }).catch(() => {})
  }, PING_MS)
  function close() {
    clearInterval(ping)
    for (const ctl of open.values()) ctl.abort()
    open.clear()
    drop()
  }
  dc.onclose = close

  const send = (m: any) => ch.json({ kind: 'res', ...m })

  async function request(m: any, parts?: Uint8Array[]) {
    const id = m.id
    bodies.delete(id)
    const body = parts ? Buffer.concat(parts) : undefined
    const ctl = new AbortController()
    open.set(id, ctl)
    try {
      // a web page goes to the proxy, which serves only GET
      const base = m.web ? o.proxy : o.local
      if (!base) throw new Error('web pages are off')
      // appended, not resolved: new URL('//a/b', base) reads a as a host
      const url = new URL(base + String(m.path))
      if (url.origin != base || !String(m.path).startsWith('/')) throw new Error('not this server')
      const headers: Record<string, string> = {}
      for (const [k, v] of Array.isArray(m.headers) ? m.headers : []) {
        if (PASS.includes(String(k).toLowerCase())) headers[k] = String(v)
      }
      // the checks of lib.ts see a tab of this machine, the redirects and
      // links name the addresses of the pages
      headers.origin = o.local
      headers['x-lia-origin'] = String(m.origin || '')
      if (m.webOrigin) headers['x-lia-web-origin'] = String(m.webOrigin)
      // for --users (src/gateway.ts): who logged in, and that it is a web page
      if (m.token) headers['x-lia-token'] = String(m.token)
      if (m.web) headers['x-lia-web'] = '1'
      if (m.dest) headers['sec-fetch-dest'] = String(m.dest)

      const r = await fetch(url, {
        method: String(m.method || 'GET'),
        headers,
        body: body && m.method != 'GET' && m.method != 'HEAD' ? body : undefined,
        redirect: 'manual',
        signal: ctl.signal,
      })
      const type = r.headers.get('content-type') || ''
      const head = { id, status: r.status, headers: [...r.headers].filter(([k]) => !DROP.includes(k)) }
      // The channel keeps the order and waits while its buffer is full. An
      // event stream goes on as it comes. Anything else is read at once: a
      // phone reads slowly, and a Node server closes the connection 5 s
      // (keepAliveTimeout) after it has handed over the last byte, also when
      // the reader has not taken the rest yet; the end of big scripts was
      // missing.
      // shortcut: a whole file in memory, stream big media if it ever comes
      if (/^text\/event-stream/.test(type)) {
        await send(head)
        if (r.body) for await (const chunk of r.body as any) await ch.body(id, chunk)
      } else {
        let bytes: Uint8Array = Buffer.from(await r.arrayBuffer())
        // packed for a page that can unpack it (m.gzip, DecompressionStream)
        const gzip = !!m.gzip && bytes.length > 1024 && PACK.test(type)
        if (gzip) bytes = zlib.gzipSync(bytes)
        await send(gzip ? { ...head, gzip } : head)
        await ch.body(id, bytes)
      }
      await send({ id, end: true })
    } catch (e: any) {
      if (!ctl.signal.aborted) await send({ id, error: e.message }).catch(() => {})
    } finally {
      open.delete(id)
    }
  }
}

// Takes the room for this process, or returns the pid of the one that has it.
// A host that crashed or got a Ctrl-C left its file, its pid is gone then.
function claim(lock: string) {
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' })
  } catch (e) {
    const pid = Number(fs.readFileSync(lock, 'utf8'))
    if (pid != process.pid && alive(pid)) return pid
    fs.writeFileSync(lock, String(process.pid))
  }
  process.on('exit', () => {
    try {
      if (fs.readFileSync(lock, 'utf8') == String(process.pid)) fs.unlinkSync(lock)
    } catch (e) {}
  })
  return 0
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e.code == 'EPERM'
  }
}

// the share page under the other loopback name, another origin on this
// machine; a page on the web needs --share-web
export function otherOrigin(page: string) {
  const url = new URL(page)
  const other = { localhost: '127.0.0.1', '127.0.0.1': 'localhost' }[url.hostname]
  if (!other) return ''
  url.hostname = other
  return url.href
}
