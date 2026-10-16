// --proxy full: web pages through testcafe-hammerhead, a rewriting proxy. Not
// only the document as in --proxy read (lib.ts): every request of the page,
// cookies (one jar per server, in memory), POST and WebSockets go through it,
// and the page's scripts see their real address, so single page apps and
// logins work. Sites that spot the proxy (Google login, Cloudflare) do not.
//
// Experimental. x.com in a frame of the same site as the proxy (the shell on
// localhost) made Firefox spin at 100 % CPU and eat memory until the desktop
// froze, with hammerhead alone, so lib.ts runs it under the other loopback
// name. Playwright's Firefox build spins under any http parent. Other sites
// may find other ways; the extension (extension/) is the safe one.
//
// hammerhead runs two servers of its own (the second for cross-domain
// iframes), with no bind address and no Host check: createServer is wrapped
// for both. The random session id in every URL keeps out what passes them.

import * as crypto from 'crypto'
import * as http from 'http'
import * as net from 'net'
import { allowed, lookup } from './web'

export type Full = { url: (address: string) => string; close: () => void }

export function startFull(options: {
  hostname: string
  bind?: string
  hosts: string[]
  port1: number
  port2: number
  script: string
}): Full {
  // loaded only for --proxy full
  const hammerhead = require('testcafe-hammerhead')

  const hosts = [options.port1, options.port2].flatMap((port) =>
    options.hosts.map((h) => h.replace(/:\d+$/, '') + ':' + port),
  )
  const proxy = new hammerhead.Proxy()
  proxy._getCreateServerMethod = () => (opts: any, handler: any) => {
    const server = http.createServer(opts, (req, res) => {
      if (hosts.includes(req.headers.host || '')) return handler(req, res)
      res.writeHead(403)
      res.end()
    })
    const listen = server.listen.bind(server)
    ;(server as any).listen = (port: number) => listen(port, options.bind)
    server.on('error', (e) => console.error('web proxy:', e.message))
    return server
  }
  // http2 would ignore the lookup below
  proxy.start({ hostname: options.hostname, port1: options.port1, port2: options.port2, disableHttp2: true })
  proxy.GET('/web.js', { content: options.script, contentType: 'application/javascript' })

  // its abstract methods as own properties: tsc compiles a subclass for
  // dist/lib.js to ES5, which cannot extend hammerhead's class
  const session = Object.assign(new hammerhead.Session([], {}), {
    id: crypto.randomBytes(16).toString('hex'),
    getPayloadScript: async () => '',
    getIframePayloadScript: async () => '',
    handleFileDownload: () => {},
    handleAttachment: () => {},
    handlePageError: (ctx: any, err: string) => ctx.closeWithError(502, err),
    getAuthCredentials: () => null,
  })
  session.injectable.scripts.push('/web.js')
  session.requestHookEventProvider.addRequestEventListeners(hammerhead.RequestFilterRule.ANY, {
    // only public addresses, as in --proxy read: lookup checks every DNS
    // answer, an address in the URL asks none
    onRequest: async (e: any) => {
      const ip = String(e.requestOptions.hostname || '').replace(/^\[|\]$/g, '')
      if (net.isIP(ip) && !allowed(ip, net.isIP(ip))) {
        return e.setMock(new hammerhead.ResponseMock('not a public address: ' + ip, 403))
      }
      e.requestOptions.lookup = lookup
    },
    // only the shell frames the pages, the session id keeps out the others
    onConfigureResponse: async (e: any) => {
      await e.removeHeader('x-frame-options')
    },
    onResponse: async () => {},
  })

  return {
    url: (address: string) => proxy.openSession(address, session),
    close: () => proxy.close(),
  }
}
