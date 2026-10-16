// Loaded into a web page that the proxy of lib.ts hands to the chat shell
// (src/web.ts). The page's <base> is its real address. Tells the shell what
// the user reads, and keeps links and searches inside the proxy. hammerhead
// (--proxy full, src/full.ts) injects it unprocessed: its document.baseURI is
// the real address too, and it rewrites links and forms itself.

;(function () {
  // the page in the shell, not its iframes
  if (parent == window || parent != top) return
  var proxy = location.origin + '/?'
  var timer
  var reported = ''

  // the real address: the <base>, with the #part of this document
  function address() {
    return document.baseURI.split('#')[0] + location.hash
  }

  // the proxy's response may only be framed by the shell, so * reaches it
  function report() {
    clearTimeout(timer)
    timer = setTimeout(function () {
      reported = address() + '\n' + document.title
      parent.postMessage(
        { web: address(), title: document.title, selection: String(getSelection()).slice(0, 2000) },
        '*',
      )
    }, 150)
  }
  addEventListener('load', report)
  addEventListener('hashchange', report)
  document.addEventListener('selectionchange', report)
  document.addEventListener('DOMContentLoaded', function () {
    var title = document.querySelector('title')
    if (title) new MutationObserver(report).observe(title, { childList: true })
    report()
  })
  // pushState and a new <title> fire no event
  setInterval(function () {
    if (address() + '\n' + document.title != reported) report()
  }, 1000)

  if (window['%hammerhead%']) return

  function go(url) {
    var here = document.baseURI.split('#')[0]
    var to = url.split('#')
    // the same page: the base makes #part a link to the site itself
    if (to[0] == here) location.hash = to[1] || ''
    else location.href = proxy + url
  }

  // after the page's own handlers: a link it handles itself is prevented
  addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]')
    if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    if ((a.target && a.target != '_self') || !/^https?:$/.test(a.protocol)) return
    e.preventDefault()
    go(a.href)
  })

  // a search box and the like
  addEventListener('submit', function (e) {
    var form = e.target
    if (e.defaultPrevented || (form.method || 'get').toLowerCase() != 'get') return
    var url = new URL(form.action || document.baseURI)
    if (!/^https?:$/.test(url.protocol)) return
    e.preventDefault()
    url.search = new URLSearchParams(new FormData(form, e.submitter)).toString()
    go(url.href)
  })
})()
