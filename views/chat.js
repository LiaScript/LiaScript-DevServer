// Chat shell of the LiaScript DevServer (--mcp). The course runs in the iframe
// and reports to the server on its own; this page only does the chat, which
// therefore survives every reload of the course.

var course = document.getElementById('course')
var log = document.getElementById('log')
var say = document.getElementById('say')

course.src = 'index.html' + location.search + location.hash

function post(msg) {
  return fetch('/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  }).then(function (res) {
    if (!res.ok) throw new Error(res.status)
  })
}

function add(who, content) {
  var msg = document.createElement('div')
  msg.className = 'msg ' + who
  msg.append(content)
  log.append(msg)
  log.scrollTop = log.scrollHeight
  return msg
}

// ---------------------------------------------------------------- user -> AI

say.addEventListener('submit', function (e) {
  e.preventDefault()
  var text = say.text.value.trim()
  if (!text) return
  say.reset()

  var msg = add('me', text)
  post({ type: 'chat', params: { text: text } }).catch(function () {
    msg.classList.add('failed')
    msg.title = 'not delivered'
  })
})

// Enter sends, Shift+Enter breaks the line
say.text.addEventListener('keydown', function (e) {
  if (e.key == 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    say.requestSubmit()
  }
})

// agent: links work in the chat like in the course
log.addEventListener('click', function (e) {
  var a = e.target.closest('a[href^="agent:"]')
  if (!a) return
  e.preventDefault()

  var uri
  try {
    uri = new URL(a.getAttribute('href'))
  } catch (x) {
    return
  }
  var slash = uri.pathname.indexOf('/')
  var params = {}
  uri.searchParams.forEach(function (value, key) {
    params[key] = value
  })
  post({
    type: 'command',
    agent: slash < 0 ? '' : uri.pathname.slice(0, slash),
    cmd: uri.pathname.slice(slash + 1),
    params: params,
  }).catch(function () {
    a.classList.add('failed')
  })
})

// ---------------------------------------------------------------- AI -> user

// what DOMPurify allows by default, plus agent:
var URIS = /^(?:(?:https?|mailto|tel|agent):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

if (window.DOMPurify) {
  // a link must not replace the shell and the chat in it
  DOMPurify.addHook('afterSanitizeAttributes', function (node) {
    var href = node.tagName == 'A' && node.getAttribute('href')
    if (href && href.indexOf('agent:') != 0) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

function markdown(text) {
  var div = document.createElement('div')

  if (window.marked && window.DOMPurify) {
    div.innerHTML = DOMPurify.sanitize(marked.parse(text), {
      ALLOWED_URI_REGEXP: URIS,
    })
    div.querySelectorAll('pre > code.language-mermaid').forEach(diagram)
  } else {
    // the CDN is out of reach
    div.textContent = text
    div.style.whiteSpace = 'pre-wrap'
  }
  return div
}

var mermaidLoading
var diagrams = 0

// 5 MB, so only when the first diagram shows up
function loadMermaid() {
  if (!mermaidLoading) {
    mermaidLoading = new Promise(function (resolve, reject) {
      var script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.min.js'
      script.integrity = 'sha256-KPynrm68fte7Y73mMTanS/7xTylqV+QDZX7rizKDYHM='
      script.crossOrigin = 'anonymous'
      script.onerror = reject
      script.onload = function () {
        mermaid.initialize({
          startOnLoad: false,
          // the diagram source is as untrusted as the rest of the message
          securityLevel: 'strict',
          theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
        })
        resolve(mermaid)
      }
      document.head.append(script)
    })
  }
  return mermaidLoading
}

function diagram(code) {
  loadMermaid()
    .then(function (mermaid) {
      return mermaid.render('diagram-' + ++diagrams, code.textContent)
    })
    .then(function (result) {
      var figure = document.createElement('div')
      figure.innerHTML = result.svg
      code.parentNode.replaceWith(figure)
      log.scrollTop = log.scrollHeight
    })
    .catch(function () {
      // the source stays visible as a code block
    })
}

// inputs: [{id, type: buttons|radio|checkbox, label?, options: [string]}]
// Built with DOM calls only, no option text ever becomes HTML.
function form(ask, inputs) {
  var el = document.createElement('form')
  var needsSubmit = false

  inputs.forEach(function (input) {
    var set = document.createElement('fieldset')
    set.className = input.type
    if (input.label) {
      var legend = document.createElement('legend')
      legend.textContent = input.label
      set.append(legend)
    }

    input.options.forEach(function (option) {
      if (input.type == 'buttons') {
        var button = document.createElement('button')
        button.name = input.id
        button.value = button.textContent = option
        set.append(button)
      } else {
        needsSubmit = true
        var label = document.createElement('label')
        var box = document.createElement('input')
        box.type = input.type
        box.name = input.id
        box.value = option
        box.required = input.type == 'radio'
        label.append(box, ' ' + option)
        set.append(label)
      }
    })
    el.append(set)
  })

  // a button of the form submits it together with its own value
  if (needsSubmit && !el.querySelector('button')) {
    var send = document.createElement('button')
    send.textContent = 'Send'
    el.append(send)
  }

  el.addEventListener('submit', function (e) {
    e.preventDefault()
    var data = new FormData(el)
    var params = { ask: ask }

    inputs.forEach(function (input) {
      if (input.type == 'checkbox') params[input.id] = data.getAll(input.id)
      if (input.type == 'radio') params[input.id] = data.get(input.id) || ''
    })
    if (e.submitter && e.submitter.name) {
      params[e.submitter.name] = e.submitter.value
      e.submitter.classList.add('chosen')
    }

    post({ type: 'answer', params: params })
      .then(function () {
        el.querySelectorAll('fieldset, button').forEach(function (x) {
          x.disabled = true
        })
      })
      .catch(function () {
        el.classList.add('failed')
      })
  })
  return el
}

// ponytail: no history. Messages that arrive while no shell is open are lost,
// and so is the log on a reload of the shell itself. Replay the last n from
// the server if that hurts.
new EventSource('/gotoLine?chat').onmessage = function (event) {
  var chat
  try {
    chat = JSON.parse(event.data).chat
  } catch (e) {}
  if (!chat) return

  var msg = add('ai', markdown(chat.markdown))
  if (chat.inputs && chat.inputs.length) msg.append(form(chat.id, chat.inputs))
  log.scrollTop = log.scrollHeight
  document.getElementById('chat').open = true
}
