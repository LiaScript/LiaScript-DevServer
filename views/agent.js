// Loaded into the player in agent mode (--mcp), after activity.js and the
// inline gotoScript of lib.ts, whose filename__ and events it reuses. Reports
// what the user looks at and does, handles goto messages and agent: links.

;(function () {
  var file = filename__
  var timer
  while (file[0] == '/') file = file.slice(1)
  try {
    file = decodeURIComponent(file)
  } catch (e) {}

  function ctx() {
    return {
      file: file,
      slide: slide(),
      title: document.title,
      selection: String(getSelection()).slice(0, 2000),
      voices: voices(),
      voiceNames: voiceNames(),
      automated: navigator.webdriver === true,
      fallback: typeof responsiveVoice != 'undefined',
      browserLang: navigator.language,
    }
  }

  // #3, or after a jump to an anchor (#folie-zwei, which stays in the address)
  // the entry LiaScript marks in its table of contents (verified in 2.2.2)
  function slide() {
    var n = parseInt(location.hash.slice(1))
    if (n) return n
    var active = document.getElementById('focusedToc')
    return (active && parseInt((active.getAttribute('href') || '').slice(1))) || 1
  }

  // Chrome loads its voices on the first call and tells when they are there
  function voices() {
    try {
      return speechSynthesis.getVoices().length
    } catch (e) {
      return 0
    }
  }

  // the voices in the language of the course, an agent picks its own of them
  function voiceNames() {
    try {
      var lang = (document.documentElement.lang || '').slice(0, 2).toLowerCase()
      return speechSynthesis
        .getVoices()
        .filter(function (v) {
          return lang && v.lang.slice(0, 2).toLowerCase() == lang
        })
        .map(function (v) {
          return v.name
        })
        .slice(0, 50)
    } catch (e) {
      return []
    }
  }

  function post(msg) {
    return fetch('/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
  }

  // ponytail: one tab, the last reporter wins. Key the state by client if
  // several tabs on different courses ever matter.
  function report() {
    // inside the chat shell: keep its address and title in step, so that
    // reloading the shell comes back to this course and slide
    if (parent != window) {
      try {
        parent.history.replaceState(null, '', parent.location.pathname + location.search + location.hash)
        parent.document.title = document.title
      } catch (e) {}
    }
    clearTimeout(timer)
    timer = setTimeout(function () {
      post({ type: 'state', context: ctx() })
    }, 150)
  }

  // The player's message handler has an eval command and checks no origin, so
  // any website could drive this page. Registered first, this one wins.
  addEventListener(
    'message',
    function (e) {
      if (e.origin != location.origin) e.stopImmediatePropagation()
    },
    true,
  )

  // slide changes are history.pushState, which fires no event at all
  var push = history.pushState
  history.pushState = function () {
    push.apply(this, arguments)
    report()
  }
  addEventListener('hashchange', report)
  addEventListener('popstate', report)
  addEventListener('load', report)
  document.addEventListener('selectionchange', report)
  try {
    speechSynthesis.addEventListener('voiceschanged', report)
  } catch (e) {}
  // the title is set after the slide change
  var title = document.querySelector('title')
  if (title) new MutationObserver(report).observe(title, { childList: true })

  // webPage() of the chat shell (same origin), none in a bare player or with
  // --proxy off: the extension or the proxy
  function webPage() {
    try {
      return parent != window && parent.document.documentElement.dataset.proxy != 'off' && parent.webPage
    } catch (e) {}
  }

  // Command links: [text](agent:tutor/explain?level=easy), or the same URI in
  // a data-agent attribute. One capturing listener, so it does not matter how
  // the player wires its links.
  document.addEventListener(
    'click',
    function (e) {
      var el = e.target.closest && e.target.closest('[data-agent],a[href]')
      if (!el) return

      // A link to another site opens in the chat shell, the chat stays.
      // With a modifier key it still opens a tab of its own.
      var page = webPage()
      if (
        page &&
        el.tagName == 'A' &&
        /^https?:$/.test(el.protocol) &&
        el.origin != location.origin &&
        !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
      ) {
        e.preventDefault()
        e.stopPropagation()
        location.href = page(el.href)
        return
      }

      var raw = el.getAttribute('data-agent') || el.getAttribute('href') || ''
      if (raw.indexOf('agent:') != 0) return

      // the player would hand the link to the browser
      e.preventDefault()
      e.stopPropagation()

      var command = Activity.link(raw)
      if (!command) return
      // the chat shows it as what the user said
      command.label = el.textContent.trim()
      command.context = ctx()
      post(command)
    },
    true,
  )

  // What the learner does with quizzes, surveys, tasks and code: LiaScript
  // fires every event it sends to JS as lia:event, only the db stores are
  // read.
  // ponytail: after a reload the old states are unknown here, so the first
  // store of a slide can report an answer from before. Fine for an agent.
  var files = {}
  var failed = {}

  function activity(sec) {
    return function (kind, block, params) {
      params.kind = kind
      params.slide = String(sec + 1)
      params.block = String(block)
      post({ type: 'activity', params: params, context: ctx() }).catch(function () {})
    }
  }

  addEventListener('lia:event', function (e) {
    var ev = e.detail
    if (!ev || ev.service != 'db') return
    var p = ev.message.param || {}
    var sec = p.id
    var data = p.data
    if (typeof sec != 'number' || !data) return

    if (p.table != 'code') {
      if (ev.message.cmd == 'store') Activity.store(p.table, sec, data, activity(sec))
      return
    }
    if (ev.message.cmd == 'store') {
      data.forEach(function (project, i) {
        files[sec + ':' + i] = project.file
      })
      return
    }
    // append comes when a run starts, with the code; version with its result
    var key = sec + ':' + data.id
    var run = data.data || {}
    if (run.file) files[key] = run.file
    if (data.cmd != 'version' || !run.log) return
    var runs = failed[key] || 0
    if (run.log.ok) {
      // the first success after a failure, then quiet again
      if (!runs) return
      failed[key] = 0
    } else {
      failed[key] = ++runs
    }
    var params = { ok: String(run.log.ok), runs: String(runs), error: Activity.errors(run.log.messages) }
    // only stored once edited, the code of the course otherwise
    if (files[key]) params.code = Activity.code(files[key])
    activity(sec)('code', data.id, params)
  })

  events.addEventListener('message', function (event) {
    var go
    try {
      go = JSON.parse(event.data).goto
    } catch (e) {}
    if (!go) return

    // ponytail: file and line in one step is not supported, the line is lost
    // on the page load. Two goto calls do it; hand it over in sessionStorage
    // if that gets annoying.
    if (go.file && go.file != file) {
      location.href = location.pathname + '?' + location.origin + '/' + encodeURI(go.file) + (go.slide ? '#' + go.slide : '')
      return
    }
    // not LIA.goto: its dedup guard remembers the last requested slide, not
    // the current one, so asking for the same slide twice does nothing
    if (go.slide) location.hash = '#' + go.slide
    if (go.line) window.LIA.gotoLine(go.line)
  })
})()
