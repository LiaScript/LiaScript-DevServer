// The way between the share page (lia-share.js) and the DevServer that
// shares itself (src/share.ts), the same module on both ends.
//
// Signalling: the y-webrtc protocol (subscribe, publish, ping) over one
// WebSocket per server of WEBRTC_SIGNALING_SERVERS. Every message is sealed
// with AES-GCM under the key of the link: the server sees the room and a
// cipher, never the SDP and its DTLS fingerprint, so it cannot step in
// between. Trystero, before this, re-opened a relay socket without its
// subscription and a host that ran for hours heard no browser any more
// (y-generic, webrtc-mobile-resilience-research F3): here every open
// subscribes again, and a socket silent for 30 s is dropped and dialed anew.
//
// The data channel: JSON text for heads and ends, binary pieces with the
// request id in their first 4 bytes.

// without WEBRTC_SIGNALING_SERVERS (signaling.json of the share page): public
export const SIGNALING = ['wss://y-webrtc-eu.fly.dev']
// without WEBRTC_ICE_SERVERS (ice.json): STUN at least, else a phone behind
// the NAT of its carrier never finds the host
export const STUN = [{ urls: 'stun:stun.l.google.com:19302' }]
export const PING_MS = 5000 // the host pings every channel this often
export const SILENT_MS = 15000 // nothing heard for this long: the link is dead
const CHUNK = 16 * 1024 // a message every browser and werift take
const HIGH = 1 << 20 // wait for the channel above this many bytes in its buffer
const SOCKET_SILENT_MS = 30000
const PROBE_MS = 3000

const b64 = (u8) => {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// key: the 32 hex characters of the link
async function cipher(key) {
  if (!/^[0-9a-f]{32}$/i.test(key)) throw new Error('the key of the link is broken')
  const raw = new Uint8Array(key.match(/../g).map((h) => parseInt(h, 16)))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// onMessage(msg) gets every message of this room sealed with this key (its
// own too, the server sends back what we publish), onOpen() every time a
// socket (re)subscribed. Returns { send, now, close }.
export async function signal({ urls, room, key, WebSocket, onMessage, onOpen }) {
  const k = await cipher(key)
  let closed = false
  const sockets = urls.map((url) => ({ url, ws: null, delay: 1000, heard: 0, probe: 0, timer: 0 }))

  function dial(s) {
    clearTimeout(s.timer)
    // dropped at once, the close of a dead socket can take minutes
    if (s.ws) {
      s.ws.onopen = s.ws.onmessage = s.ws.onclose = s.ws.onerror = null
      try {
        s.ws.close()
      } catch (e) {}
      s.ws = null
    }
    if (closed) return
    const ws = (s.ws = new WebSocket(s.url))
    s.heard = Date.now()
    s.probe = 0
    ws.onopen = () => {
      s.delay = 1000
      s.heard = Date.now()
      // every time: a server that lost us does not know the room any more
      ws.send(JSON.stringify({ type: 'subscribe', topics: [room] }))
      onOpen?.()
    }
    // in the order of the socket: a candidate must not overtake its offer
    let order = Promise.resolve()
    ws.onmessage = ({ data }) => {
      s.heard = Date.now()
      let m
      try {
        m = JSON.parse(data)
      } catch (e) {
        return
      }
      if (m.type != 'publish' || m.topic != room || typeof m.data != 'string') return
      order = order.then(async () => {
        let msg
        try {
          const box = unb64(m.data)
          const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.subarray(0, 12) }, k, box.subarray(12))
          msg = JSON.parse(new TextDecoder().decode(plain))
        } catch (e) {
          return // not sealed with our key
        }
        if (!closed && s.ws == ws) onMessage(msg)
      })
    }
    ws.onclose = ws.onerror = () => {
      if (s.ws != ws) return
      s.ws = null
      s.timer = setTimeout(() => dial(s), s.delay)
      s.delay = Math.min(s.delay * 2, 10000)
    }
  }

  // a ping every 15 s, an answer to a probe within 3 s
  const tick = setInterval(() => {
    const now = Date.now()
    for (const s of sockets) {
      if (!s.ws) continue
      if (now - s.heard > SOCKET_SILENT_MS || (s.probe && s.heard < s.probe && now - s.probe > PROBE_MS)) dial(s)
      else if (s.ws.readyState == 1 && now - s.heard > 15000) s.ws.send('{"type":"ping"}')
    }
  }, 1000)

  sockets.forEach(dial)

  // sealed one after the other, so they leave in the order they were sent
  let sending = Promise.resolve()
  return {
    send(msg) {
      return (sending = sending.then(async () => {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const box = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(msg))))
        const sealed = new Uint8Array(12 + box.length)
        sealed.set(iv)
        sealed.set(box, 12)
        const frame = JSON.stringify({ type: 'publish', topic: room, data: b64(sealed) })
        for (const s of sockets) if (s.ws?.readyState == 1) s.ws.send(frame)
      }).catch(() => {}))
    },
    // the network changed or the page is back: dial what is down, ask the rest
    now() {
      for (const s of sockets) {
        if (s.ws?.readyState != 1) (s.delay = 1000), dial(s)
        else (s.probe = Date.now()), s.ws.send('{"type":"ping"}')
      }
    },
    close() {
      closed = true
      clearInterval(tick)
      sockets.forEach(dial)
    },
  }
}

// The framing of one data channel. onJson(msg) for text, onChunk(id, bytes)
// for a piece of a body. Returns { json, body }, both keep the order and wait
// while the channel's buffer is full; they reject once it is closed.
export function channel(dc, onJson, onChunk) {
  dc.binaryType = 'arraybuffer'
  dc.bufferedAmountLowThreshold = HIGH / 2
  dc.onmessage = ({ data }) => {
    if (typeof data == 'string') {
      let m
      try {
        m = JSON.parse(data)
      } catch (e) {
        return
      }
      return onJson(m)
    }
    const u8 = new Uint8Array(data) // an ArrayBuffer in browsers, a Buffer in werift
    if (u8.length >= 4) onChunk(new DataView(u8.buffer, u8.byteOffset).getUint32(0), u8.subarray(4))
  }
  let queue = Promise.resolve()
  const put = (frame) =>
    (queue = queue.then(async () => {
      if (dc.readyState != 'open') throw new Error('the channel is closed')
      if (dc.bufferedAmount > HIGH) await new Promise((resolve) => dc.addEventListener('bufferedamountlow', resolve, { once: true }))
      dc.send(frame)
    }))
  return {
    json: (m) => put(JSON.stringify(m)),
    async body(id, bytes) {
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const piece = bytes.subarray(i, i + CHUNK)
        const frame = new Uint8Array(4 + piece.length)
        new DataView(frame.buffer).setUint32(0, id)
        frame.set(piece, 4)
        await put(frame)
      }
    },
  }
}
