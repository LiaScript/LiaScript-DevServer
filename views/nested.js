// No chat shell in the course frame of a chat shell. The server tells the
// frame from the tab by Sec-Fetch-Dest, which a browser sends only to https
// and localhost: on plain HTTP of the LAN (--lan) a course of the listing
// came as a second shell with a second switch bar. Runs in the <head>, so
// stop() keeps the rest of the shell from starting.
;(function (window) {
  var frame = window.frameElement
  if (!frame || frame.id != 'course') return
  window.stop()
  var where = window.location
  var base = where.pathname.slice(0, where.pathname.lastIndexOf('/liascript/'))
  var web = /[?&]web=([^&]*)/.exec(where.search)
  where.replace(
    (web
      ? base + '/web?url=' + web[1]
      : /^\?\/home/.test(where.search)
        ? base + where.search.slice(1)
        : 'index.html' + where.search) + where.hash,
  )
})(window)
