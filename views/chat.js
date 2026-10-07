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

// ---------------------------------------------------------------- language

// The chat speaks the language of the course, which the player puts on its
// document; a text without a translation stays English. The English text is
// the key, so the progress lines of the server translate as well.
var TEXTS = {
  de: {
    'LiaScript course': 'LiaScript-Kurs',
    Resize: 'Größe ändern',
    Agent: 'Assistent',
    'Message to the AI': 'Nachricht an die KI',
    'Ask the AI about this course …': 'Frag die KI zu diesem Kurs …',
    Send: 'Senden',
    'Send answer': 'Antwort senden',
    '+ New chat': '+ Neuer Chat',
    'Send again': 'Erneut senden',
    'not delivered': 'nicht zugestellt',
    'No longer open': 'Nicht mehr offen',
    'Read aloud': 'Vorlesen',
    'Read this message aloud': 'Diese Nachricht vorlesen',
    Stop: 'Stopp',
    'Stop reading': 'Vorlesen beenden',
    'Cannot read aloud': 'Kann nicht vorlesen',
    'Dock at the side': 'Am Rand andocken',
    'Float over the course': 'Über dem Kurs schweben lassen',
    'This browser cannot read aloud, it has no speech voices. Chrome and Edge bring their own, Firefox on Linux needs speech-dispatcher with a voice. The assistant can help to set it up.':
      'Dieser Browser kann nicht vorlesen, ihm fehlen die Stimmen. Chrome und Edge bringen eigene mit, Firefox unter Linux braucht speech-dispatcher mit einer Stimme. Der Assistent hilft beim Einrichten.',
    'Waiting for the assistant…': 'Wartet auf den Assistenten …',
    'Thinking…': 'Denkt nach …',
    'The assistant has not reacted yet. Your message is saved and waits for it.':
      'Der Assistent hat noch nicht reagiert. Deine Nachricht ist gespeichert und wartet auf ihn.',
    'No sign of the assistant for a minute. It may still be working, or wait for a permission on the computer.':
      'Seit einer Minute kein Lebenszeichen vom Assistenten. Vielleicht arbeitet er noch, oder er wartet am Rechner auf eine Freigabe.',
  },
}
var lang = ''

function t(text) {
  var table = TEXTS[lang.slice(0, 2).toLowerCase()]
  return (table && table[text]) || text
}

// sets the text, or with attr an attribute, and keeps the English one for a
// change of the language
function tr(el, text, attr) {
  el.setAttribute(attr ? 'data-t-' + attr : 'data-t', text)
  if (attr) el.setAttribute(attr, t(text))
  else el.textContent = t(text)
  return el
}

function clock(time) {
  var options = { hour: '2-digit', minute: '2-digit' }
  try {
    return new Date(time).toLocaleTimeString(lang || [], options)
  } catch (e) {
    // not a language tag the browser knows
    return new Date(time).toLocaleTimeString([], options)
  }
}

function localize() {
  var now = language()
  if (now == lang) return
  lang = now
  document.documentElement.lang = lang
  document.querySelectorAll('[data-t]').forEach(function (el) {
    el.textContent = t(el.getAttribute('data-t'))
  })
  ;['title', 'placeholder', 'aria-label'].forEach(function (attr) {
    document.querySelectorAll('[data-t-' + attr + ']').forEach(function (el) {
      el.setAttribute(attr, t(el.getAttribute('data-t-' + attr)))
    })
  })
  document.querySelectorAll('time').forEach(function (el) {
    el.textContent = clock(el.dateTime)
  })
  showSessions(sessionList)
}

// the player sets its language once the course is parsed, again after a reload
course.addEventListener('load', function () {
  localize()
  try {
    new MutationObserver(localize).observe(course.contentDocument.documentElement, {
      attributes: true,
      attributeFilter: ['lang'],
    })
  } catch (e) {}
})

// agent: {name, emoji, label} of the agent that wrote it, if the AI declared
// one, t: the time it was saved, for a message of the history
function add(who, content, extra, agent, t) {
  var msg = document.createElement('div')
  msg.className = 'msg ' + who
  msg.append(content)
  if (extra) msg.append(extra)

  var stamp = document.createElement('span')
  stamp.className = 'stamp'
  var time = document.createElement('time')
  time.dateTime = (t ? new Date(t) : new Date()).toISOString()
  time.textContent = clock(time.dateTime)
  stamp.append(time)
  if (agent) {
    stamp.prepend(agent.emoji + ' ')
    stamp.title = agent.label || agent.name
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
  who.textContent = now ? now.emoji + ' ' + (now.label || now.name) : 'Chat'

  pick.textContent = ''
  ;(agents.list || []).forEach(function (agent) {
    var option = document.createElement('option')
    option.value = agent.name
    option.textContent = agent.emoji + ' ' + (agent.label || agent.name)
    pick.append(option)
  })
  pick.value = current
  pick.classList.remove('failed')
  pick.hidden = pick.options.length < 2
}

// the same as a click on agent:<name>/switch, the server switches and the
// broadcast that follows updates button and menu
pick.addEventListener('change', function () {
  post({ type: 'command', agent: pick.value, cmd: 'switch', params: {} }).catch(function () {
    pick.value = current
    pick.classList.add('failed')
  })
})

// ---------------------------------------------------------------- sessions

// The server saves every chat in .chats/ of the project and sends the one to
// show on every (re)connect, so F5 and a restart of the server keep it. The
// menu starts a new chat or reopens an old one, for every open shell.
var sessions = document.getElementById('sessions')
var chatId = '' // the session in the log
var saved = [] // the ids of all sessions with a file
var sessionList = [] // for a change of the language

function showSessions(list) {
  sessionList = list
  saved = list.map(function (session) {
    return session.id
  })
  sessions.textContent = ''
  var fresh = document.createElement('option')
  fresh.value = ''
  tr(fresh, '+ New chat')
  sessions.append(fresh)
  list.forEach(function (session) {
    var option = document.createElement('option')
    option.value = session.id
    var date = new Date(session.updated)
    var options = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    try {
      date = date.toLocaleString(lang || [], options)
    } catch (e) {
      date = date.toLocaleString([], options)
    }
    option.textContent = session.title + ' \u00B7 ' + date
    sessions.append(option)
  })
  selectSession()
}

// a chat without messages has no file yet and counts as the new one
function selectSession() {
  sessions.value = chatId
  if (sessions.selectedIndex < 0) sessions.value = ''
  sessions.classList.remove('failed')
}

sessions.addEventListener('change', function () {
  var id = sessions.value
  post({ type: 'session', params: id ? { id: id } : {} }).catch(function () {
    selectSession()
    sessions.classList.add('failed')
  })
})

function showSession(session) {
  chatId = session.id
  selectSession()
  stop()
  log.textContent = ''

  session.entries.forEach(showEntry)
  log.querySelectorAll('form[data-ask]').forEach(function (el) {
    if (el.dataset.ask != session.open) closed(el)
  })

  // What the server never got, until it is sent again. A new chat has no
  // file before its first message, after a restart its messages go here.
  var list = outbox()
  list.forEach(function (unsent) {
    if (unsent.session != chatId && saved.indexOf(unsent.session) >= 0) return
    unsent.session = chatId
    failed(add('me', unsent.text, null, null, unsent.t), unsent)
  })
  outbox(list)
}

// one entry of the saved chat, from the history or as it happens
function showEntry(entry) {
  if (entry.type == 'ai') {
    showAI(
      {
        id: entry.ask,
        markdown: entry.markdown,
        inputs: entry.inputs,
        agent: entry.agent,
        lang: entry.lang,
      },
      entry.t,
    )
  } else if (entry.type == 'user') {
    add('me', entry.text, null, null, entry.t)
  } else if (entry.type == 'answer') {
    log.querySelectorAll('form[data-ask]').forEach(function (el) {
      if (el.dataset.ask == entry.ask) answered(el, entry.values)
    })
    // what the user chose, so that it is clear that it arrived
    add('me act', '✓ ' + choice(entry.values), null, null, entry.t)
  } else if (entry.type == 'command') {
    // a click on an agent: link, in the course or in the chat
    add('me act', '▶ ' + entry.label, null, null, entry.t)
  }
}

function choice(values) {
  return (
    Object.keys(values)
      .map(function (key) {
        return [].concat(values[key]).join(', ')
      })
      .filter(Boolean)
      .join(' · ') || '–'
  )
}

// --------------------------------------------------------------- outbox

// messages that did not reach the server, e.g. while it restarted. Per
// browser and port, like the layout.
var OUTBOX = 'liascript-chat-outbox'

function outbox(list) {
  try {
    if (list) localStorage.setItem(OUTBOX, JSON.stringify(list))
    else return JSON.parse(localStorage.getItem(OUTBOX) || '[]')
  } catch (e) {}
  return []
}

function deliver(msg, unsent) {
  post({ type: 'chat', params: { text: unsent.text } })
    .then(function () {
      outbox(
        outbox().filter(function (other) {
          return other.t != unsent.t
        }),
      )
      msg.classList.remove('failed')
      msg.removeAttribute('title')
      msg.removeAttribute('data-t-title')
    })
    .catch(function () {
      failed(msg, unsent)
    })
}

function failed(msg, unsent) {
  var list = outbox()
  if (
    !list.some(function (other) {
      return other.t == unsent.t
    })
  ) {
    outbox(list.concat(unsent))
  }

  msg.classList.add('failed')
  tr(msg, 'not delivered', 'title')
  if (msg.querySelector('.resend')) return
  var again = document.createElement('button')
  again.type = 'button'
  again.className = 'resend'
  tr(again, 'Send again')
  again.addEventListener('click', function () {
    again.remove()
    deliver(msg, unsent)
  })
  msg.querySelector('.foot').prepend(again)
}

// ------------------------------------------------------- move and resize

// The chat stays anchored at the bottom right, so it opens upwards. The button
// moves it, the grip in the top left corner resizes the panel.
var box = document.getElementById('chat')
var panel = document.getElementById('panel')
var LAYOUT = 'liascript-chat-layout'

function px(value) {
  return Math.round(value) + 'px'
}

// Docked, the chat is a column at the right edge and the course gets the
// rest, the grip on its left edge moves the border between them. Floating,
// it is a window over the course. A narrow screen has no room for a column.
var WIDE = 768
var REM = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
// the first visit docks where there is room, then the choice of the user
var dock = { on: innerWidth >= WIDE, width: 26 * REM }
var dockButton = document.getElementById('dock')

function docked() {
  return document.body.classList.contains('docked')
}

// a column of at least 16rem next to a course of at least 20rem
function dockWidth(width) {
  return Math.max(16 * REM, Math.min(width, innerWidth - 20 * REM))
}

function applyDock() {
  var room = innerWidth >= WIDE
  dockButton.hidden = !room
  dockButton.setAttribute('aria-pressed', String(dock.on))
  tr(dockButton, dock.on ? 'Float over the course' : 'Dock at the side', 'title')
  tr(dockButton, dock.on ? 'Float over the course' : 'Dock at the side', 'aria-label')
  // closed, the button floats and the course has the whole width
  document.body.classList.toggle('docked', dock.on && room && box.open)
  if (!docked()) return clamp()
  document.body.style.setProperty('--dock', px(dockWidth(dock.width)))
  box.style.setProperty('--head', px(who.offsetHeight))
}

dockButton.addEventListener('click', function () {
  dock.on = !dock.on
  applyDock()
  save()
})

// keeps the whole chat, open or not, on the screen
function clamp() {
  // the CSS holds a docked one in place, its floating place stays as it was
  if (docked()) return
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
        dock: dock.on,
        dockWidth: dock.width,
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
  if (typeof layout.dock == 'boolean') dock.on = layout.dock
  if (layout.dockWidth > 0) dock.width = layout.dockWidth
} catch (e) {}
applyDock()
addEventListener('resize', applyDock)
box.addEventListener('toggle', applyDock)

function swallow(e) {
  e.preventDefault()
}

// pointer capture keeps the moves coming while the pointer is over the iframe
function drag(handle, move) {
  handle.addEventListener('pointerdown', function (e) {
    if (e.button != 0 || (move.off && move.off())) return
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
  // a docked chat stays where it is, the button only opens and closes it
  off: docked,
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
    return { width: panel.offsetWidth, height: panel.offsetHeight, dock: box.offsetWidth }
  },
  to: function (start, dx, dy) {
    // docked: the border between course and chat
    if (docked()) {
      dock.width = dockWidth(start.dock - dx)
      return applyDock()
    }
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

// Without voices the bar shows a muted speaker, which explains it on a click:
// the user learns it once and in place, not from the AI in every greeting.
var mute = document.getElementById('mute')
var muteInfo = document.getElementById('mute-info')
var settled = false // voices and responsiveVoice had time to arrive

function canSpeak() {
  var can = voices().length > 0 || !!responsive()
  log.classList.toggle('can-speak', can)
  mute.hidden = can || !settled
  if (can) muteInfo.hidden = true
}

mute.addEventListener('click', function () {
  muteInfo.hidden = !muteInfo.hidden
})

// Chrome loads its voices on the first call and tells when they are there,
// responsiveVoice arrives with the course
canSpeak()
try {
  speechSynthesis.addEventListener('voiceschanged', canSpeak)
} catch (e) {}
course.addEventListener('load', function () {
  canSpeak()
  setTimeout(function () {
    settled = true
    canSpeak()
  }, 3000)
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
  tr(button, 'Read aloud', 'title')
  tr(button, 'Read this message aloud', 'aria-label')
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
  tr(button, 'Stop', 'title')
  tr(button, 'Stop reading', 'aria-label')

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

  var unsent = { session: chatId, text: text, t: new Date().toISOString() }
  deliver(add('me', text, null, null, unsent.t), unsent)
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
    label: a.textContent.trim(),
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
  el.dataset.ask = ask
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
    tr(send, 'Send answer')
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
    }

    post({ type: 'answer', params: params })
      .then(function () {
        delete params.ask
        answered(el, params)
      })
      .catch(function (e) {
        // the server closed it meanwhile
        if (e.message == '409') closed(el)
        else el.classList.add('failed')
      })
  })
  return el
}

// shows what the user sent, also for a form of the history, and locks it
function answered(el, values) {
  el.classList.remove('failed')
  el.classList.add('answered')
  el.querySelectorAll('input, button[name]').forEach(function (x) {
    var value = values[x.name]
    var chosen = Array.isArray(value) ? value.indexOf(x.value) >= 0 : value == x.value
    if (x.tagName == 'BUTTON') x.classList.toggle('chosen', chosen)
    else x.checked = chosen
  })
  el.querySelectorAll('fieldset, button').forEach(function (x) {
    x.disabled = true
  })
}

// replaced by a newer form, withdrawn by the AI or asked before a restart
function closed(el) {
  if (el.classList.contains('answered') || el.classList.contains('closed')) return
  el.classList.remove('failed')
  el.classList.add('closed')
  el.querySelectorAll('fieldset, button').forEach(function (x) {
    x.disabled = true
  })
  var note = document.createElement('p')
  note.className = 'note'
  el.append(tr(note, 'No longer open'))
}

// what the AI is doing right now, until its next message without one
function status(text) {
  var line = document.getElementById('status')
  tr(line, text || '')
  line.hidden = !text
  if (text) document.getElementById('chat').open = true
}

// below the progress line when the server has no sign of the AI for a while
function hint(text) {
  var line = document.getElementById('hint')
  tr(line, text)
  line.hidden = !text
}

new EventSource('/gotoLine?chat').onmessage = function (event) {
  var data
  try {
    data = JSON.parse(event.data)
  } catch (e) {
    return
  }
  if (typeof data.status == 'string') return status(data.status)
  if (typeof data.hint == 'string') return hint(data.hint)
  if (data.closed) {
    return log.querySelectorAll('form[data-ask]').forEach(function (el) {
      if (el.dataset.ask == data.closed) closed(el)
    })
  }
  if (data.agents) return showAgents(data.agents)
  if (data.sessions) return showSessions(data.sessions)
  if (data.session) return showSession(data.session)
  if (data.entry) return showEntry(data.entry)

  var chat = data.chat
  if (!chat) return

  showAI(chat)
  document.getElementById('chat').open = true
  status(chat.status)
}

function showAI(chat, t) {
  var msg = add(
    'ai',
    markdown(chat.markdown),
    chat.inputs && chat.inputs.length ? form(chat.id, chat.inputs) : null,
    chat.agent,
    t,
  )
  if (typeof chat.lang == 'string') msg.lang = chat.lang
}

// the fixed texts of the page, in the language of the browser until the
// course says its own
localize()
