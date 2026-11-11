// The share page loads this under the origin of web pages, hidden. The
// service worker of this origin hands the requests of a web page in the shell
// here, and this passes them on to the share page, which holds the connection
// and sends them to the proxy of the DevServer, never to the chat.
var up = null
// the share tab this relay belongs to, its requests only
var tab = new URLSearchParams(location.search).get('tab')

addEventListener('message', function (e) {
  if (e.source == parent && e.data == 'lia-share' && e.ports[0]) up = e.ports[0]
})

// the newest worker, see lia-share.js
navigator.serviceWorker.register('lia-share-sw.js', { updateViaCache: 'none' }).then(function (reg) {
  return reg.update()
})
navigator.serviceWorker.onmessage = function (e) {
  var port = e.ports[0]
  if (!port) return
  if (e.data.tab !== tab) return port.postMessage({ notMine: true })
  if (!up) return port.postMessage({ error: 'Not connected.' })
  up.postMessage(e.data, [port])
}
