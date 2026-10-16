// Web pages in the chat shell (agent mode): the proxy of lib.ts fetches the
// HTML document of a page and hands it out on a port of its own, with a <base>
// of the original address and views/web.js, which tells the shell what the
// user reads. Styles, images and scripts load from the original site.
//
// ponytail: the page's scripts run on the proxy origin. A relative
// history.pushState resolves against the <base> and throws, so single page
// apps break; articles read fine. All sites share that one origin and its
// localStorage. For more: --proxy full (src/full.ts) or the extension.

import * as dns from 'dns'
import * as http from 'http'
import * as https from 'https'
import * as net from 'net'

const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 15000
const REDIRECTS = 5

// The scripts of a proxied page could ask the proxy for the router or a
// server on this machine and read the answer: only public addresses.
const blocked = new net.BlockList()
for (const [net4, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 3],
] as [string, number][]) {
  blocked.addSubnet(net4, bits, 'ipv4')
}
for (const [net6, bits] of [
  // ::ffff:a.b.c.d falls under the IPv4 subnets by itself
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as [string, number][]) {
  blocked.addSubnet(net6, bits, 'ipv6')
}

export function allowed(address: string, family: number | string): boolean {
  const type = family === 6 || family === 'IPv6' ? 'ipv6' : 'ipv4'
  return net.isIP(address) !== 0 && !blocked.check(address, type)
}

// every answer of the DNS, also the one a rebinding name gives on connect.
// Node asks with all: true since it tries IPv4 and IPv6 side by side.
export function lookup(host: string, options: any, callback: any) {
  dns.lookup(host, options, (err: any, address: any, family?: number) => {
    const all = Array.isArray(address) ? address : [{ address, family }]
    if (!err && !all.every((a: any) => allowed(a.address, a.family))) {
      err = Object.assign(new Error('not a public address: ' + host), { code: 'EBLOCKED' })
    }
    callback(err, address, family)
  })
}

export function webURL(value: any): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch (e) {
    return null
  }
}

export type Page = { url: string; type: string; body: Buffer }

// GET without cookies, redirects followed here so that each hop is checked
export function fetchPage(address: string, headers: { [key: string]: any }, hops = REDIRECTS): Promise<Page> {
  const url = webURL(address)
  if (!url) return Promise.reject(new Error('not an http(s) address'))
  // an address in the URL asks no DNS, so lookup never sees it
  const ip = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(ip) && !allowed(ip, net.isIP(ip))) {
    return Promise.reject(new Error('not a public address: ' + ip))
  }

  return new Promise((resolve, reject) => {
    const get = url.protocol === 'https:' ? https.get : http.get
    const req = get(
      url,
      {
        lookup,
        timeout: TIMEOUT_MS,
        headers: {
          'user-agent': headers['user-agent'] || 'LiaScript-DevServer',
          'accept-language': headers['accept-language'] || '',
          accept: 'text/html,*/*;q=0.8',
          'accept-encoding': 'identity',
        },
      },
      (res) => {
        const status = res.statusCode || 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          if (!hops) return reject(new Error('too many redirects'))
          return resolve(fetchPage(new URL(res.headers.location, url).href, headers, hops - 1))
        }
        const type = String(res.headers['content-type'] || '')
        // not a page: the frame takes it from the site itself
        if (!/html/i.test(type)) {
          res.resume()
          return resolve({ url: url.href, type, body: Buffer.alloc(0) })
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BYTES) req.destroy(new Error('page too large'))
          else chunks.push(chunk)
        })
        res.on('end', () => resolve({ url: url.href, type, body: Buffer.concat(chunks) }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

function attr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// latin1 keeps every byte, whatever the charset of the page
export function inject(body: Buffer, url: string, script: string): Buffer {
  const html = body.toString('latin1')
  const tags = `<base href="${attr(url)}"><script src="${attr(script)}"></script>`
  const head = /<head(\s[^>]*)?>/i.exec(html)
  const at = head ? head.index + head[0].length : 0
  return Buffer.from(html.slice(0, at) + tags + html.slice(at), 'latin1')
}
