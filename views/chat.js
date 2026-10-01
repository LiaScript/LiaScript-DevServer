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

// agent: {name, emoji} of the agent that wrote it, if the AI declared one
function add(who, content, extra, agent) {
  var msg = document.createElement('div')
  msg.className = 'msg ' + who
  msg.append(content)
  if (extra) msg.append(extra)

  var stamp = document.createElement('span')
  stamp.className = 'stamp'
  stamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (agent) {
    stamp.prepend(agent.emoji + ' ')
    stamp.title = agent.name
  }
  var foot = document.createElement('div')
  foot.className = 'foot'
  foot.append(speaker(content), stamp)
  msg.append(foot)

  log.append(msg)
  log.scrollTop = log.scrollHeight
  return msg
}

// ------------------------------------------------------------------ agents

// who the user talks to, on the button and in the menu of a workflow
var who = document.getElementById('who')
var pick = document.getElementById('pick')
var current = ''

function showAgents(agents) {
  var now = agents.current
  current = now ? now.name : ''
  who.textContent = now ? now.emoji + ' ' + now.name : 'Chat'

  pick.textContent = ''
  ;(agents.list || []).forEach(function (agent) {
    var option = document.createElement('option')
    option.value = agent.name
    option.textContent = agent.emoji + ' ' + agent.name
    pick.append(option)
  })
  pick.value = current
  pick.classList.remove('failed')
  document.getElementById('agents').hidden = pick.options.length < 2
}

// the same as a click on agent:<name>/switch, the server switches and the
// broadcast that follows updates button and menu
pick.addEventListener('change', function () {
  post({ type: 'command', agent: pick.value, cmd: 'switch', params: {} }).catch(function () {
    pick.value = current
    pick.classList.add('failed')
  })
})

// ------------------------------------------------------- move and resize

// The chat stays anchored at the bottom right, so it opens upwards. The button
// moves it, the grip in the top left corner resizes the panel.
var box = document.getElementById('chat')
var panel = document.getElementById('panel')
var LAYOUT = 'liascript-chat-layout'

function px(value) {
  return Math.round(value) + 'px'
}

// keeps the whole chat, open or not, on the screen
function clamp() {
  var rect = box.getBoundingClientRect()
  var right = parseFloat(getComputedStyle(box).right)
  var bottom = parseFloat(getComputedStyle(box).bottom)
  box.style.right = px(Math.max(0, Math.min(right, innerWidth - rect.width)))
  box.style.bottom = px(Math.max(0, Math.min(bottom, innerHeight - rect.height)))
}

function save() {
  try {
    localStorage.setItem(
      LAYOUT,
      JSON.stringify({
        right: box.style.right,
        bottom: box.style.bottom,
        width: panel.style.width,
        height: panel.style.height,
      }),
    )
  } catch (e) {}
}

try {
  var layout = JSON.parse(localStorage.getItem(LAYOUT) || '{}')
  if (layout.right) box.style.right = layout.right
  if (layout.bottom) box.style.bottom = layout.bottom
  if (layout.width) panel.style.width = layout.width
  if (layout.height) panel.style.height = layout.height
} catch (e) {}
clamp()
addEventListener('resize', clamp)
box.addEventListener('toggle', clamp)

function swallow(e) {
  e.preventDefault()
}

// pointer capture keeps the moves coming while the pointer is over the iframe
function drag(handle, move) {
  handle.addEventListener('pointerdown', function (e) {
    if (e.button != 0) return
    var x = e.clientX
    var y = e.clientY
    var started = false
    var start = move.start()
    handle.setPointerCapture(e.pointerId)

    function onMove(e) {
      var dx = e.clientX - x
      var dy = e.clientY - y
      // a click on the button still opens and closes the chat
      if (!started && Math.abs(dx) + Math.abs(dy) < 5) return
      started = true
      document.body.classList.add('dragging')
      move.to(start, dx, dy)
    }
    function onUp() {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('dragging')
      if (!started) return
      clamp()
      save()
      // the click that follows the drag must not toggle the chat
      handle.addEventListener('click', swallow, { once: true, capture: true })
      // in case no click follows, the next real one must work
      setTimeout(function () {
        handle.removeEventListener('click', swallow, true)
      }, 0)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  })
}

drag(who, {
  start: function () {
    var style = getComputedStyle(box)
    return { right: parseFloat(style.right), bottom: parseFloat(style.bottom) }
  },
  to: function (start, dx, dy) {
    box.style.right = px(start.right - dx)
    box.style.bottom = px(start.bottom - dy)
    clamp()
  },
})

drag(document.getElementById('grip'), {
  start: function () {
    return { width: panel.offsetWidth, height: panel.offsetHeight }
  },
  to: function (start, dx, dy) {
    // not past the edges of the screen, the min size comes from the CSS
    var rect = box.getBoundingClientRect()
    var chrome = rect.height - panel.offsetHeight
    var right = innerWidth - rect.right
    var bottom = innerHeight - rect.bottom
    panel.style.width = px(Math.min(start.width - dx, innerWidth - right - 2))
    panel.style.height = px(Math.min(start.height - dy, innerHeight - bottom - chrome))
  },
})

// ------------------------------------------------------------- read aloud

// Every message has a button that reads it aloud, with a voice of the browser
// in the language of the course. A browser without voices shows no buttons;
// with --responsiveVoice the service loaded by the player steps in.
var reading // the button of the message that is read right now

function voices() {
  try {
    return speechSynthesis.getVoices()
  } catch (e) {
    return []
  }
}

function responsive() {
  try {
    return course.contentWindow.responsiveVoice
  } catch (e) {}
}

// the player puts the language of the course on its document
function language() {
  try {
    return course.contentDocument.documentElement.lang || navigator.language
  } catch (e) {
    return navigator.language
  }
}

function canSpeak() {
  log.classList.toggle('can-speak', voices().length > 0 || !!responsive())
}

// Chrome loads its voices on the first call and tells when they are there,
// responsiveVoice arrives with the course
canSpeak()
try {
  speechSynthesis.addEventListener('voiceschanged', canSpeak)
} catch (e) {}
course.addEventListener('load', function () {
  canSpeak()
  setTimeout(canSpeak, 3000)
})

function speaker(content) {
  var button = document.createElement('button')
  button.type = 'button'
  button.className = 'speak'
  idle(button)
  button.addEventListener('click', function () {
    var mine = reading == button
    stop()
    if (!mine) read(button, runs(content))
  })
  return button
}

function idle(button) {
  button.textContent = '\u25B6'
  button.title = 'Read aloud'
  button.setAttribute('aria-label', 'Read this message aloud')
}

// What is read: the text without code, tables, diagrams and forms, in runs of
// one language. A message says its language with lang, and so does a passage
// in it (<span lang="fr">); everything else is in the language of the course.
function runs(content) {
  var course = language()
  if (typeof content == 'string') return [{ lang: course, text: content }]

  var out = []
  var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  var node
  while ((node = walker.nextNode())) {
    var el = node.parentElement
    if (el.closest('pre, svg, form, table')) continue
    // only what the message itself says, not the lang of this page
    var marked = el.closest('[lang]')
    var lang = (marked && log.contains(marked) && marked.lang) || course
    var last = out[out.length - 1]
    if (last && last.lang == lang) last.text += node.data
    else out.push({ lang: lang, text: node.data })
  }
  return out
    .map(function (run) {
      return { lang: run.lang, text: run.text.replace(/\s+/g, ' ').trim() }
    })
    .filter(function (run) {
      return run.text
    })
}

// Sentence by sentence: Chrome drops an utterance of its online voices after
// about 15 seconds, so a long message would stop in the middle.
function sentences(text) {
  // at sentence ends, and at a space where a sentence is too long itself
  var parts = text.match(/[^.!?:;]{1,180}(?:[.!?:;]+\s*|\s+|$)|[^.!?:;]{1,180}/g) || [text]
  var chunks = []
  parts.forEach(function (part) {
    var last = chunks.length - 1
    if (last >= 0 && (chunks[last] + part).length <= 180) chunks[last] += part
    else chunks.push(part)
  })
  return chunks
}

function stop() {
  var button = reading
  reading = undefined
  if (button) idle(button)
  try {
    speechSynthesis.cancel()
  } catch (e) {}
  var service = responsive()
  if (service) service.cancel()
}

// a voice for the language: the same region, else the same language
function voiceFor(lang, all) {
  lang = lang.toLowerCase()
  return (
    all.filter(function (v) {
      return v.lang.toLowerCase() == lang
    })[0] ||
    all.filter(function (v) {
      return v.lang.slice(0, 2).toLowerCase() == lang.slice(0, 2)
    })[0]
  )
}

function read(button, parts) {
  if (!parts.length) return
  var done = function () {
    if (reading == button) stop()
  }

  reading = button
  button.textContent = '\u25A0'
  button.title = 'Stop'
  button.setAttribute('aria-label', 'Stop reading')

  var all = voices()
  if (!all.length) {
    var service = responsive()
    if (!service) return done()
    // one voice of the service for the whole message, else its default
    var short = parts[0].lang.slice(0, 2).toLowerCase()
    var named = (service.getVoices() || []).filter(function (v) {
      return (v.lang || v.flag || '').slice(0, 2).toLowerCase() == short
    })[0]
    var text = parts
      .map(function (run) {
        return run.text
      })
      .join(' ')
    return service.speak(text, named ? named.name : undefined, { onend: done, onerror: done })
  }

  var queue = []
  parts.forEach(function (run) {
    var voice = voiceFor(run.lang, all)
    sentences(run.text).forEach(function (chunk) {
      var utterance = new SpeechSynthesisUtterance(chunk)
      utterance.lang = voice ? voice.lang : run.lang
      if (voice) utterance.voice = voice
      // cancel() ends an utterance with an error, which is no reason to reset
      // the button of the message that was started instead
      utterance.onerror = function (e) {
        if (e.error != 'interrupted' && e.error != 'canceled') done()
      }
      queue.push(utterance)
    })
  })
  queue[queue.length - 1].onend = done
  queue.forEach(function (utterance) {
    speechSynthesis.speak(utterance)
  })
}

// a reload of the shell must not leave the browser talking
addEventListener('pagehide', stop)

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
    // agent://tutor/explain is agent:tutor/explain, as in the course
    uri = new URL('agent:' + a.getAttribute('href').slice(6).replace(/^[/]+/, ''))
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
// what the AI is doing right now, until its next message without one
function status(text) {
  var line = document.getElementById('status')
  line.textContent = text || ''
  line.hidden = !text
  if (text) document.getElementById('chat').open = true
}

new EventSource('/gotoLine?chat').onmessage = function (event) {
  var data
  try {
    data = JSON.parse(event.data)
  } catch (e) {
    return
  }
  if (typeof data.status == 'string') return status(data.status)
  if (data.agents) return showAgents(data.agents)

  var chat = data.chat
  if (!chat) return

  var msg = add(
    'ai',
    markdown(chat.markdown),
    chat.inputs && chat.inputs.length ? form(chat.id, chat.inputs) : null,
    chat.agent,
  )
  if (typeof chat.lang == 'string') msg.lang = chat.lang
  document.getElementById('chat').open = true
  status(chat.status)
}
