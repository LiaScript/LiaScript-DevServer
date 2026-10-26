// --share: this server for browsers elsewhere, over WebRTC (spike, see
// docs/superpowers/specs/2026-10-26-shared-devserver-webrtc-design.md).
// The page share/index.html joins the room, its service worker hands every
// request of the UI to it, it sends them here over the data channel, and this
// host replays them on the local server and streams the answer back. Trystero
// (like the LiaScript classroom) finds the peers over public Nostr relays,
// which see only the encrypted handshake; the data itself is DTLS end to end.
// Web pages come through a second page under another origin (web), so that a
// page never reaches the chat; its requests go to the proxy of lib.ts.
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'

export const APP = 'liascript-devserver-share'

// one room per project, kept until the teacher asks for a new link (fresh);
// turn: optional TURN servers for networks that block direct connections
const FILE = path.join(os.homedir(), '.config', 'liascript', 'share.json')

// request headers of the browser worth passing on, the rest is its business
const PASS = ['accept', 'accept-language', 'content-type', 'cache-control', 'if-none-match', 'if-modified-since', 'range', 'last-event-id']
// a body goes in pieces of this size, Trystero splits them further
const CHUNK = 64 * 1024
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
// server gets to see. The key encrypts the handshake and keeps out who does
// not have the link.
export function share(o: Options) {
  // parcel hoists every require( to the top of the bundle, this one it
  // cannot see: WebRTC loads only with --share
  const load = require('module').createRequire(__filename)
  const { joinRoom } = load('@trystero-p2p/nostr')
  const { RTCPeerConnection } = load('werift')

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

  // the room opens once the TURN servers are known, the link is ready now
  turn(o.page, saved.turn).then((ice) => {
    if (ice.length) console.log('🔗 TURN: ' + ice.map((s: any) => [].concat(s.urls).join(' ')).join(', '))
    serve(joinRoom({ appId: APP, password: key, rtcPolyfill: RTCPeerConnection, ...(ice.length ? { turnConfig: ice } : {}) }, room), o)
  })

  return { link: o.page + '#room=' + room + '&key=' + key + (o.proxy && o.web ? '&web=' + encodeURIComponent(o.web) : '') }
}

// TURN servers: those of share.json, else the ones the share page publishes
// (ice.json, from the secret ICE_SERVERS of its repository). Then both ends
// can relay, a phone behind the NAT of its carrier needs that.
async function turn(page: string, own: any): Promise<any[]> {
  if (Array.isArray(own)) return own
  try {
    const r = await fetch(new URL('ice.json', page), { signal: AbortSignal.timeout(5000) })
    const ice = r.ok ? await r.json() : []
    return Array.isArray(ice) ? ice : []
  } catch (e) {
    return []
  }
}

function serve(peers: any, o: Options) {
  const hello = peers.makeAction('hello')
  const req = peers.makeAction('req')
  const res = peers.makeAction('res')
  const abort = peers.makeAction('abort')
  const open = new Map<string, AbortController>()

  // other browsers in the room are peers too, this tells them who serves
  peers.onPeerJoin = (peerId: string) => {
    console.log('🔗 shared with', peerId)
    hello.send({ host: true }, { target: peerId })
  }
  peers.onPeerLeave = (peerId: string) => {
    console.log('🔗 left', peerId)
    for (const [k, ctl] of open) if (k.startsWith(peerId + ':')) ctl.abort()
  }

  abort.onMessage = (data: any, { peerId }: any) => open.get(peerId + ':' + data?.id)?.abort()

  // a request comes as its metadata, or as its body with the metadata attached
  req.onMessage = async (data: any, { peerId, metadata }: any) => {
    const body = metadata ? data : undefined
    const m = metadata || data
    const id = m?.id
    const to = { target: peerId }
    const ctl = new AbortController()
    open.set(peerId + ':' + id, ctl)
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
        body: body && m.method != 'GET' && m.method != 'HEAD' ? Buffer.from(body) : undefined,
        redirect: 'manual',
        signal: ctl.signal,
      })
      const type = r.headers.get('content-type') || ''
      const head = { id, status: r.status, headers: [...r.headers].filter(([k]) => !DROP.includes(k)) }
      // One send at a time keeps the order, Trystero chunks and waits for the
      // channel to drain. An event stream goes on as it comes. Anything else
      // is read at once: a phone reads slowly, and a Node server closes the
      // connection 5 s (keepAliveTimeout) after it has handed over the last
      // byte, also when the reader has not taken the rest yet; the end of
      // big scripts was missing.
      // ponytail: a whole file in memory, stream big media if it ever comes
      if (/^text\/event-stream/.test(type)) {
        await res.send(head, to)
        if (r.body) for await (const chunk of r.body as any) await res.send(chunk, { ...to, metadata: { id } })
      } else {
        let body = Buffer.from(await r.arrayBuffer())
        // packed for a page that can unpack it (m.gzip, DecompressionStream)
        const gzip = !!m.gzip && body.length > 1024 && PACK.test(type)
        if (gzip) body = zlib.gzipSync(body)
        await res.send(gzip ? { ...head, gzip } : head, to)
        for (let i = 0; i < body.length; i += CHUNK) await res.send(body.subarray(i, i + CHUNK), { ...to, metadata: { id } })
      }
      await res.send({ id, end: true }, to)
    } catch (e: any) {
      if (!ctl.signal.aborted) await res.send({ id, error: e.message }, to).catch(() => {})
    } finally {
      open.delete(peerId + ':' + id)
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
