// Loaded into a web page that the proxy of lib.ts hands to the chat shell
// (src/web.ts). The page's <base> is its real address. Tells the shell what
// the user reads, and keeps links and searches inside the proxy. hammerhead
// (--proxy full, src/full.ts) injects it unprocessed: its document.baseURI is
// the real address too, and it rewrites links and forms itself.

;(function () {
  // the page in the shell, not its iframes; through --share the share page
  // holds the shell, one level more (web.js?shared)
  var src = (document.currentScript && document.currentScript.src) || ''
  var depth = 0
  for (var w = window; w != top; w = w.parent) depth++
  if (depth != (/[?&]shared\b/.test(src) ? 2 : 1)) return
  // through --share the page for web pages may sit in a folder
  var proxy = location.origin + location.pathname + '?'
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

  // run_in_page: code of the agent, sent by the shell. No CSP comes through
  // the proxy, so eval works. hammerhead hands listeners only messages in its
  // own format and makes e.data their .message, its native methods do not
  var hammerhead = window['%hammerhead%']
  var native = hammerhead && hammerhead.nativeMethods
  ;(native ? native.windowAddEventListener : addEventListener).call(window, 'message', function (e) {
    var m = native ? native.messageEventDataGetter.call(e) : e.data
    if (e.source != parent || !m || !m.page || typeof m.page.code != 'string') return
    var id = m.page.id
    Promise.resolve()
      .then(function () {
        return (0, eval)(m.page.code)
      })
      // a circular value throws here and becomes the error
      .then(function (value) {
        return String(JSON.stringify(value)).slice(0, 90000)
      })
      .then(
        function (result) {
          parent.postMessage({ page: id, result: result }, '*')
        },
        function (error) {
          parent.postMessage({ page: id, error: String(error) || 'error' }, '*')
        },
      )
  })

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
