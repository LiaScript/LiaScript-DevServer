// In every frame: a web page directly in the chat shell of the DevServer
// tells the shell what the user reads, as views/web.js does behind its proxy.

;(function () {
  // the page in the shell, not its iframes
  if (window == top || parent != top) return
  // Chrome knows the parent, Firefox asks the background
  var above = location.ancestorOrigins && location.ancestorOrigins[0]
  if (above && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(above)) return

  chrome.runtime.sendMessage({ where: true }, function (shell) {
    if (chrome.runtime.lastError || !shell) return
    var timer
    var reported = ''

    function report() {
      clearTimeout(timer)
      timer = setTimeout(function () {
        reported = location.href + '\n' + document.title
        top.postMessage(
          { web: location.href, title: document.title, selection: String(getSelection()).slice(0, 2000) },
          shell,
        )
      }, 150)
    }
    addEventListener('hashchange', report)
    document.addEventListener('selectionchange', report)
    var title = document.querySelector('title')
    if (title) new MutationObserver(report).observe(title, { childList: true })
    // pushState and a new <title> fire no event
    setInterval(function () {
      if (location.href + '\n' + document.title != reported) report()
    }, 1000)
    report()
  })
})()
