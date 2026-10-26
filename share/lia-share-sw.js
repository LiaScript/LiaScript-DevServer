// The service worker of the share page: every request of the shared UI (the
// frame and everything it loads from this origin) goes to the share page,
// which holds the WebRTC connection (a worker cannot), and its answer comes
// back as a stream, so the event stream of the chat stays open.
// The UI of each tab lives below /tab-<id>/: two logins in one browser must
// not cross, and a worker cannot tell which tab a frame belongs to. So it
// asks every share tab, and the one with that id answers.

// the folder of the share page ('' at the root): the server knows no folder
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '')

// Files with a content hash in their name never change: kept in the browser,
// per room (a teacher's server), because the hash comes from that server and
// a file of one server must never answer for another. The room of a tab is
// learned from its first answer.
// ponytail: the cache only grows, prune by room if it ever matters
const ASSET = /\.[0-9a-f]{8}\.(js|css|woff2?|png|jpe?g|svg|wasm)$/
const CACHE = 'lia-share-assets'
const rooms = new Map()
const cacheKey = (tab, path) => {
  const room = rooms.get(tab)
  return room && ASSET.test(path.split('?')[0]) ? location.origin + BASE + '/__lia-cache/' + room + path : null
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (url.origin != location.origin || !url.pathname.startsWith(BASE + '/')) return
  const tab = /^\/tab-([a-z0-9]+)(\/.*)?$/.exec(url.pathname.slice(BASE.length))
  // The share page itself and its files, asked again every time: a page
  // from the cache of the browser (GitHub Pages allows 10 minutes) did not
  // fit a newer worker and got 404 for every path.
  if (!tab) {
    if (e.request.method == 'GET') e.respondWith(fetch(url.href, { cache: 'no-cache' }))
    return
  }
  e.respondWith(tunnel(e.request, tab[1], (tab[2] || '/') + url.search))
})

async function tunnel(request, tab, path) {
  const cached = request.method == 'GET' && cacheKey(tab, path)
  if (cached) {
    const hit = await caches.match(cached)
    if (hit) return hit
  }
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  // the origin of web pages has relays, the other share pages; not another
  // page of the same origin (liascript.github.io/course/ …)
  const at = (c) => new URL(c.url).pathname
  const pages = windows.filter(
    (c) =>
      at(c) == BASE + '/lia-share-relay.html' ||
      (c.frameType == 'top-level' && (at(c) == BASE + '/' || at(c) == BASE + '/index.html')),
  )
  if (!pages.length) return new Response('Not connected', { status: 503 })

  const body = request.method == 'GET' || request.method == 'HEAD' ? null : await request.arrayBuffer()
  const message = {
    tab,
    method: request.method,
    path,
    headers: [...request.headers],
    dest: request.destination,
    body,
  }

  return new Promise((resolve) => {
    let out
    let owner = null
    let others = pages.length
    const stream = new ReadableStream({
      start(controller) { out = controller },
      cancel() { if (owner) owner.postMessage('abort') },
    })
    for (const page of pages) {
      const { port1, port2 } = new MessageChannel()
      port1.onmessage = ({ data }) => {
        if (data.notMine) {
          if (--others == 0 && !owner) resolve(new Response('Not connected', { status: 503 }))
          return
        }
        owner = port1
        if (data.status) {
          if (data.room) rooms.set(tab, data.room)
          const empty = [101, 204, 205, 304].includes(data.status) || request.method == 'HEAD'
          // packed by the host for the way through the tunnel
          const body = empty ? null : data.gzip ? stream.pipeThrough(new DecompressionStream('gzip')) : stream
          const response = new Response(body, { status: data.status, headers: data.headers })
          const key = request.method == 'GET' && data.status == 200 && cacheKey(tab, path)
          // the copy before the browser starts to read the answer
          if (key) {
            const copy = response.clone()
            caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {})
          }
          resolve(response)
        } else if (data.chunk) {
          out.enqueue(new Uint8Array(data.chunk))
        } else if (data.end) {
          out.close()
        } else if (data.error) {
          resolve(new Response(data.error, { status: 502 }))
          try { out.error(new Error(data.error)) } catch (_) {}
        }
      }
      page.postMessage(message, [port2])
    }
  })
}
