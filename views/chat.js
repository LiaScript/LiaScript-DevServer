// Chat shell of the LiaScript DevServer (--mcp). The course runs in the iframe
// and reports to the server on its own; this page only does the chat, which
// therefore survives every reload of the course.

var course = document.getElementById('course')
var log = document.getElementById('log')
var say = document.getElementById('say')

// ?/home/… is the file listing of the project, ?web=<url> a web page, else
// ?<url> the course
var web = new URLSearchParams(location.search).get('web') || ''
if (web) {
  whenExtension(function () {
    course.src = webPage(web)
  })
} else {
  course.src =
    (/^\?\/home/.test(location.search) ? location.search.slice(1) : 'index.html' + location.search) + location.hash
}

// the extension sets up its tab within moments, else the proxy
function whenExtension(go) {
  if (document.documentElement.dataset.liaExtension != 'pending') return go()
  var done = false
  function once() {
    if (!done) go()
    done = true
  }
  setTimeout(once, 1000)
  document.addEventListener('lia-extension', once)
}

// The browser extension (extension/) lets the real page into the frame, with
// the user's logins. Else the proxy of the server (--proxy), which off refuses.
function webPage(url) {
  var html = document.documentElement.dataset
  return html.liaExtension == 'ready' && html.proxy != 'off' ? url : '/web?url=' + encodeURIComponent(url)
}

// the player, not the listing or a web page
function isPlayer() {
  try {
    return course.contentWindow.location.pathname == '/liascript/index.html'
  } catch (e) {
    return false
  }
}

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
    'Ask the AI about this course …': 'Frage zum Kurs …',
    Send: 'Senden',
    'Send answer': 'Antwort senden',
    '+ New chat': '+ Neuer Chat',
    'Send again': 'Erneut senden',
    'not delivered': 'nicht zugestellt',
    'No longer open': 'Nicht mehr offen',
    BC: 'v. Chr.',
    'Read aloud': 'Vorlesen',
    'Read this message aloud': 'Diese Nachricht vorlesen',
    Stop: 'Stopp',
    'Stop reading': 'Vorlesen beenden',
    'Cannot read aloud': 'Kann nicht vorlesen',
    'Dock at the side': 'Am Rand andocken',
    'Read everything aloud': 'Alles vorlesen',
    'One moment, I am thinking.': 'Moment, ich denke nach.',
    'Float over the course': 'Über dem Kurs schweben lassen',
    'Open a web page': 'Webseite öffnen',
    'Web address': 'Webadresse',
    'Back to the start of the course': 'Zurück zum Anfang des Kurses',
    'Files in this folder': 'Dateien in diesem Ordner',
    'This browser cannot read aloud, it has no speech voices. Chrome and Edge bring their own, Firefox on Linux needs speech-dispatcher with a voice. The assistant can help to set it up.':
      'Dieser Browser kann nicht vorlesen, ihm fehlen die Stimmen. Chrome und Edge bringen eigene mit, Firefox unter Linux braucht speech-dispatcher mit einer Stimme. Der Assistent hilft beim Einrichten.',
    'Waiting for the assistant…': 'Wartet auf den Assistenten …',
    'Thinking…': 'Denkt nach …',
    'Looking at your answer…': 'Schaut sich die Antwort an …',
    'One moment, I am looking at your answer.': 'Moment, ich schaue mir die Antwort an.',
    'The assistant has not reacted yet.': 'Der Assistent hat noch nicht reagiert.',
    'The connection to the server is lost, connecting again…': 'Die Verbindung zum Server ist unterbrochen, verbinde neu …',
    'The assistant has not reacted yet, maybe it is not connected. The message is saved, it answers once it starts.':
      'Der Assistent hat noch nicht reagiert, vielleicht ist er nicht verbunden. Die Nachricht ist gespeichert, er antwortet, sobald er startet.',
    'The assistant is still working, this can take a while.': 'Der Assistent arbeitet noch, das kann eine Weile dauern.',
  },
}
var lang = ''

// in the language of the chat, or in another one if there is a table for it
function t(text, other) {
  var table = TEXTS[(other || lang).slice(0, 2).toLowerCase()]
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

// in the language of the chat
function when(time, options) {
  try {
    return new Date(time).toLocaleString(lang || [], options)
  } catch (e) {
    // not a language tag the browser knows
    return new Date(time).toLocaleString([], options)
  }
}

function clock(time) {
  return when(time, { hour: '2-digit', minute: '2-digit' })
}

function localize() {
  var now = language()
  if (now == lang) return
  lang = now
  document.documentElement.lang = lang
  // the shell, its parts in the messages, and the parts of a replay that
  // wait for their message: built before the course told its language
  ;[document, frame()]
    .concat(
      parts.filter(function (msg) {
        return !msg.isConnected
      }),
    )
    .forEach(translate)
  showSessions(sessionList)
  chatLang()
}

function translate(root) {
  if (!root) return
  root.querySelectorAll('[data-t]').forEach(function (el) {
    el.textContent = t(el.getAttribute('data-t'))
  })
  ;['title', 'placeholder', 'aria-label'].forEach(function (attr) {
    root.querySelectorAll('[data-t-' + attr + ']').forEach(function (el) {
      el.setAttribute(attr, t(el.getAttribute('data-t-' + attr)))
    })
  })
  root.querySelectorAll('.msg time').forEach(function (el) {
    el.textContent = clock(el.dateTime)
  })
}

// LiaScript describes a formula (aria-label, and what is read aloud) in the
// language of its document, and the chat app sets that once from its header:
// en. The messages are in the language of the course, so is their document.
function chatLang() {
  var doc = frame()
  if (!doc || !lang || doc.documentElement.lang == lang) return
  doc.documentElement.lang = lang
  doc.querySelectorAll('lia-formula').forEach(function (formula) {
    if (formula.render) formula.render()
  })
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

// The course of --input: after a goto to another file there was no way back
// to it but asking the agent.
var homeCourse = ''
var homeButton = document.getElementById('home')
tr(homeButton, 'Back to the start of the course', 'title')

function showHome() {
  var away = !!homeCourse
  try {
    away = away && !(isPlayer() && new URL(course.contentWindow.location.search.slice(1)).pathname == '/' + encodeURI(homeCourse))
  } catch (e) {}
  homeButton.hidden = !away
}
course.addEventListener('load', showHome)
homeButton.addEventListener('click', function () {
  course.src = 'index.html?' + location.origin + '/' + encodeURI(homeCourse)
})

// The listing of the folder of the course or file (a PDF, a text) in the
// frame, its own breadcrumbs lead further up. Only for this server, not the web.
var filesButton = document.getElementById('files')
tr(filesButton, 'Files in this folder', 'title')
tr(filesButton, 'Files in this folder', 'aria-label')

function courseFolder() {
  try {
    var where = course.contentWindow.location.pathname
    if (isPlayer()) {
      var file = new URL(course.contentWindow.location.search.slice(1))
      if (file.origin != location.origin) return null
      where = '/home' + file.pathname.replace(/^\/+/, '/')
    } else if (!where.startsWith('/home/') || isListing()) return null
    return where.replace(/\/[^/]*$/, '')
  } catch (e) {
    return null
  }
}

// the listing of views/layouts/index.hbs, a file shows in the frame as it is
function isListing() {
  try {
    return course.contentDocument.body.hasAttribute('data-listing')
  } catch (e) {
    return false
  }
}
course.addEventListener('load', function () {
  filesButton.hidden = courseFolder() == null
})
filesButton.addEventListener('click', function () {
  var folder = courseFolder()
  if (folder != null) course.src = folder
})

// The file listing does not report like the player: no course is open, and
// F5 comes back to the folder. Its links stay in the frame.
course.addEventListener('load', function () {
  try {
    var where = course.contentWindow.location.pathname
    // this origin again, no web page
    web = ''
    if (!where.startsWith('/home')) return
    history.replaceState(null, '', location.pathname + '?' + where)
    document.title = course.contentDocument.title
    post({ type: 'state', context: { file: '', title: decodeURIComponent(where) } }).catch(function () {})
  } catch (e) {}
})

// A web page reports through views/web.js from the origin of the proxy, or
// through the extension from its own. Its strings are page content, the
// server caps them.
addEventListener('message', function (e) {
  var m = e.data
  if (e.source != course.contentWindow || !m) return
  // what the code of run_in_page returned
  if (typeof m.page == 'string') {
    return post({ type: 'page', params: { id: m.page, result: m.result, error: m.error } }).catch(function () {})
  }
  if (typeof m.web != 'string') return
  web = m.web
  history.replaceState(null, '', location.pathname + '?web=' + encodeURIComponent(web))
  document.title = String(m.title)
  post({ type: 'state', context: { file: '', web: web, title: m.title, selection: m.selection } }).catch(function () {})
})

// the address field: any web page, read together with the chat
var address = document.getElementById('address')
document.getElementById('browse').addEventListener('click', function () {
  address.hidden = !address.hidden
  if (address.hidden) return
  address.url.value = web
  address.url.select()
})
address.addEventListener('submit', function (e) {
  e.preventDefault()
  var url = address.url.value.trim()
  if (!url) return
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  course.src = webPage(url)
  address.hidden = true
})

// LiaScript's light or dark mode, not the system's: the player keeps it in
// the settings of localStorage, which this page and the messages share
function theme() {
  var dark = false
  try {
    dark = JSON.parse(localStorage.getItem('settings')).light === false
  } catch (e) {}
  ;[document, frame()].forEach(function (doc) {
    if (!doc) return
    doc.documentElement.classList.toggle('lia-variant-dark', dark)
    doc.documentElement.classList.toggle('lia-variant-light', !dark)
  })
}
window.addEventListener('storage', function (e) {
  if (e.key == 'settings') theme()
})

// ---------------------------------------------------------------- messages

// Every message is LiaScript: quizzes, surveys, code, templates. The package
// @liascript/chat renders them in an iframe of this origin, one add() is one
// .lia-chat__msg there, in order. Into each the shell hangs its part (.msg):
// a form, the read-aloud button, robot and time. Relative links and images
// are those of the course.
var lia = document.createElement('lia-chat')
try {
  lia.setAttribute('base', new URL(decodeURIComponent(location.search.slice(1))).href)
} catch (e) {}
// the forms of the shell in the messages submit, their handler stops it
lia.iframe.sandbox.add('allow-forms')
log.append(lia)
lia.iframe.addEventListener('load', function () {
  theme()
  chatLang()
  try {
    new MutationObserver(chatLang).observe(frame().documentElement, { attributes: true, attributeFilter: ['lang'] })
  } catch (e) {}
})

var parts = [] // the part of every message since the last clear(), in order
var forms = [] // the forms among them
var synced = true // false from clear() until the iframe shows its result
var rounds = 0

function frame() {
  try {
    return lia.iframe.contentDocument
  } catch (e) {}
}

// The n-th message is the n-th .lia-chat__msg, once the iframe shows it
function place() {
  var doc = frame()
  if (!synced || !doc) return
  var bubbles = doc.querySelectorAll('.lia-chat__msg')
  var moved = false
  parts.forEach(function (msg, i) {
    var bubble = bubbles[i]
    if (!bubble || msg.parentNode == bubble) return
    bubble.append(msg)
    if (msg.lang) bubble.lang = msg.lang
    moved = true
    msg.resolve()
  })
  if (moved) doc.scrollingElement.scrollTop = doc.scrollingElement.scrollHeight
}

// Elm keeps the nodes of the old messages for the new ones and shows clear()
// and the add()s after it in one go: the old parts go at once, the new ones
// only after a round trip through the iframe and its next frame.
function clear() {
  parts.forEach(function (msg) {
    msg.remove()
  })
  parts = []
  forms = []
  seen = {}
  Activity.reset()
  synced = false
  var round = ++rounds
  lia.clear()
  lia.export().then(function () {
    lia.iframe.contentWindow.requestAnimationFrame(function () {
      if (round != rounds) return
      synced = true
      place()
    })
  })
}

lia.iframe.addEventListener('load', function () {
  var doc = frame()
  var css = doc.createElement('link')
  css.rel = 'stylesheet'
  css.href = new URL('chat.css', location.href).href
  doc.head.append(css)
  doc.body.classList.toggle('can-speak', log.classList.contains('can-speak'))
  // the link a click on agent: was about, for its text
  doc.addEventListener(
    'click',
    function (e) {
      lastLink = e.target.closest && e.target.closest('a')
      // [Station 1](#station-1) or (#3) shows that slide of the course: the
      // chat has no slides of its own
      var href = lastLink && lastLink.getAttribute('href')
      if (!href || href[0] != '#' || href.length < 2 || !isPlayer()) return
      e.preventDefault()
      e.stopPropagation()
      course.contentWindow.location.hash = href
    },
    true,
  )
  doc.addEventListener('click', readClicked)
  new MutationObserver(place).observe(doc.body, { childList: true, subtree: true })
  place()
})

// agent: {name, emoji, label} of the agent that wrote it, if the AI declared
// one, t: the time it was saved, for a message of the history. A message of
// the AI shows the robot of its agent, the robot on the stage reads it.
// Returns the part of the shell, msg.placed resolves when it is in the chat.
function add(who, text, extra, agent, t) {
  var time = document.createElement('time')
  time.dateTime = (t ? new Date(t) : new Date()).toISOString()
  time.textContent = clock(time.dateTime)
  lia.add({
    user: who == 'ai' ? (agent ? agent.label || agent.name : 'AI') : '',
    self: who != 'ai',
    time: Date.parse(time.dateTime),
    message: text,
  })

  var msg = document.createElement('div')
  msg.className = 'msg ' + who
  if (extra) msg.append(extra)

  var stamp = document.createElement('span')
  stamp.className = 'stamp'
  // the name is visible: a tooltip is out of reach on a tablet
  if (agent) {
    var name = document.createElement('span')
    name.className = 'name'
    name.textContent = agent.label || agent.name
    stamp.append(name)
  }
  stamp.append(time)
  if (who == 'ai') stamp.prepend(Avatar.bot(agent, 16))
  msg.agent = agent
  var foot = document.createElement('div')
  foot.className = 'foot'
  foot.append(speaker(), stamp)
  msg.append(foot)

  msg.placed = new Promise(function (resolve) {
    msg.resolve = resolve
  })
  parts.push(msg)
  place()
  return msg
}

// what LiaScript rendered of the message, next to the part of the shell
function content(msg) {
  return msg.parentNode && msg.parentNode.firstElementChild
}

// ------------------------------------------------------------------ agents

// who the user talks to, on the button and in the robots of a workflow
var who = document.getElementById('who')
var team = document.getElementById('agents')
var current = ''
var currentAgent // {name, emoji, label} of the current agent, if there is one

function showAgents(agents) {
  var now = agents.current
  // the old agent stops talking, what it still had to say too
  if ((now ? now.name : '') != current) {
    queue = []
    stop()
  }
  current = now ? now.name : ''
  currentAgent = now
  // the learner view: only the agent who teaches, larger on the stage
  document.body.classList.toggle('learner', agents.view == 'learner')
  who.textContent = ''
  who.append(Avatar.bot(now, 22), now ? now.label || now.name : 'LiaAgent')

  team.textContent = ''
  ;(agents.list || []).forEach(function (agent) {
    var button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(agent.name == current))
    button.title = agent.label || agent.name
    button.setAttribute('aria-label', button.title)
    button.append(Avatar.bot(agent, 24))
    button.addEventListener('click', function () {
      if (agent.name != current) choose(agent.name)
    })
    team.append(button)
  })
  team.classList.remove('failed')
  team.hidden = team.children.length < 2 || agents.view == 'learner'
  if (!reading) showStage(currentAgent)
}

// the same as a click on agent:<name>/switch, the server switches and the
// broadcast that follows updates button and robots
function choose(name) {
  post({ type: 'command', agent: name, cmd: 'switch', params: {} }).catch(function () {
    team.classList.add('failed')
  })
}

// ------------------------------------------------------------------- stage

// The robot of the agent below the log, next to the progress line. It shows
// the agent that talks to the user, and while a message is read aloud the
// agent that wrote it. Its bottom row shows a running light while the agent
// works, a pulse while a form waits for the user.
var stageBox = document.getElementById('bot')
var stageBot

function showStage(agent) {
  stageBot = Avatar.bot(agent, document.body.classList.contains('learner') ? 96 : 56)
  stageBox.textContent = ''
  stageBox.append(stageBot)
  stageState()
}

function stageState() {
  if (!stageBot) return
  var state = !document.getElementById('status').hidden ? 'thinking' : waitingForm() ? 'waiting' : ''
  if (state) stageBot.setAttribute('data-state', state)
  else stageBot.removeAttribute('data-state')
}

// the newest form, if it can still be answered
function waitingForm() {
  var last = forms[forms.length - 1]
  return !!last && !last.classList.contains('answered') && !last.classList.contains('closed')
}

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
    var date = when(session.updated, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
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
  queue = []
  stop()
  clear()

  // what the learner did with the quizzes, surveys and tasks: the n-th entry
  // is the n-th message, as long as nothing else is shown in between
  var db = { quiz: [], survey: [], task: [], code: [] }
  Object.keys(session.db || {}).forEach(function (table) {
    if (!db[table]) return
    Object.keys(session.db[table]).forEach(function (n) {
      db[table][n] = session.db[table][n]
      report(table, +n, session.db[table][n], true)
    })
  })
  lia.load({ version: 1, messages: [], db: db })

  session.entries.forEach(showEntry)
  forms.forEach(function (el) {
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
  stageState()
}

// one entry of the saved chat, from the history or as it happens. n: its
// number in the chat, which the states of its quizzes refer to
function showEntry(entry, n) {
  if (entry.type == 'ai') {
    showAI(
      {
        id: entry.ask,
        markdown: entry.markdown,
        inputs: entry.inputs,
        agent: entry.agent,
        lang: entry.lang,
        n: n,
      },
      entry.t,
    )
  } else if (entry.type == 'user') {
    add('me', entry.text, null, null, entry.t)
  } else if (entry.type == 'answer') {
    var asked
    forms.forEach(function (el) {
      if (el.dataset.ask != entry.ask) return
      asked = el
      answered(el, entry.values)
    })
    // what the user chose, so that it is clear that it arrived
    add('me act', '✓ ' + choice(entry.values, asked), null, null, entry.t)
  } else if (entry.type == 'command') {
    // a click on an agent: link, in the course or in the chat, as a statement:
    // the ▶ and arrows of the link text made it look like a button
    var label = entry.label.replace(/^[\p{So}\p{Sm}\s]+|[\p{So}\p{Sm}\s]+$/gu, '') || entry.label
    add('me act', '✓ ' + label, null, null, entry.t)
  }
}

// The id of a teacher form reads as the name of the person. With more than
// one question each answer follows its question: two similar ones were
// impossible to tell apart.
function choice(values, el) {
  var name = function (value) {
    var person = window.Teachers && window.Teachers.get(value)
    return person ? person.name : value
  }
  var keys = Object.keys(values)
  var question = function (key) {
    var field = keys.length > 1 && el && el.querySelector('[name="' + CSS.escape(key) + '"]')
    var legend = field && field.closest('fieldset').querySelector('legend')
    return legend ? legend.textContent + ': ' : ''
  }
  return (
    keys
      .map(function (key) {
        var said = [].concat(values[key]).map(name).join(', ')
        return said && question(key) + said
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
// in the language of the course, and so has a click on the message itself. A
// browser without voices shows no buttons; with --responsiveVoice the service
// loaded by the player steps in. The robot on the stage moves its mouth.
var reading // what is read right now: {parts, msg, button, status}
var queue = [] // what waits for its turn, with the box "Read everything aloud"

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
  var doc = frame()
  if (doc && doc.body) doc.body.classList.toggle('can-speak', can)
  document.getElementById('autoread-box').hidden = !can
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

function speaker() {
  var button = document.createElement('button')
  button.type = 'button'
  button.className = 'speak'
  idle(button)
  button.addEventListener('click', function () {
    var mine = reading && reading.button == button
    var msg = button.closest('.msg')
    queue = []
    stop()
    if (!mine) read({ parts: readable(msg), msg: msg, button: button })
  })
  return button
}

function idle(button) {
  button.textContent = '\u25B6'
  tr(button, 'Read aloud', 'title')
  tr(button, 'Read this message aloud', 'aria-label')
}

// What is read: the visible text without code blocks, diagrams, buttons, forms
// and effect numbers, in runs of one language. A message says its language
// with lang, and so does a passage in it (<span lang="fr">); everything else is
// in the language of the course. An image is read by its alt text, a formula
// by the description LiaScript gives it (formula() below). Quizzes,
// surveys and tasks are read with their options, never with their solution.
var SILENT =
  'pre, svg, form, button, input, select, textarea, script, style, lia-chart, [hidden], [aria-hidden="true"], ' +
  '.lia-code, .lia-effect__circle, .lia-effect__circle--inline, ' +
  'details:not([open]) > :not(summary)'

// LiaScript puts no space between two blocks, so ListOne and ListTwo became
// one word: a new block gets a pause, a comma between two cells of a row
var BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, summary, dt, dd, th, td, label, div'

// a message and the questions of its form with their options: a form that
// is not read leaves a listener without the question
function readable(msg) {
  var out = runs(content(msg))
  var form = msg.querySelector('form')
  if (!form || form.classList.contains('closed')) return out
  var asked = [].map
    .call(form.querySelectorAll('fieldset'), function (set) {
      var legend = set.querySelector('legend')
      var options = [].map.call(set.querySelectorAll('label, button strong, button:not(:has(strong))'), function (el) {
        return el.textContent.trim()
      })
      return (legend ? legend.textContent.trim() + ': ' : '') + options.filter(Boolean).join(', ')
    })
    .join('. ')
  var lang = msg.lang || language()
  var last = out[out.length - 1]
  if (last && last.lang == lang) last.text = pause(last.text) + unemoji(asked)
  else if (asked) out.push({ lang: lang, text: unemoji(asked) })
  return out
}

function runs(content) {
  var course = language()
  if (!content) return []

  // only what the message itself says, not the lang of the chat page
  function passage(el) {
    var marked = el.closest('[lang]')
    return (marked && marked.closest('.lia-chat__msg') && marked.lang) || course
  }

  var out = []
  var block
  function add(text, el, lang) {
    var last = out[out.length - 1]
    if (!text.trim()) {
      if (last) last.text += text
      return
    }
    var here = el.closest(BLOCK)
    if (last && here != block) last.text = pause(last.text, here, block)
    block = here
    lang = lang || passage(el)
    if (last && last.lang == lang) last.text += text
    else out.push({ lang: lang, text: text })
  }

  var walker = content.ownerDocument.createTreeWalker(content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      return node.nodeType == 1 && node.matches(SILENT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  var node
  while ((node = walker.nextNode())) {
    if (node.nodeType == 3) add(node.data, node.parentElement)
    else if (node.localName == 'img') add(node.alt || '', node)
    else if (node.localName == 'lia-formula') {
      var said = formula(node, passage(node))
      add(said.text, node, said.lang)
    }
  }
  return out
    .map(function (run) {
      return { lang: run.lang, text: unemoji(run.text) }
    })
    .filter(function (run) {
      return run.text
    })
}

// LiaScript describes a formula in a language it knows (en, de) and falls back
// to English, or uses the aria-label the author gave
function formula(node, lang) {
  if (!node.speech) return { text: node.textContent, lang: node.ownerDocument.documentElement.lang || 'en' }
  var text = node.speech(lang)
  var known = node.hasAttribute('aria-label') || /^en/i.test(lang) || text != node.speech('en')
  return { text: text, lang: known ? lang : 'en' }
}

function pause(text, here, before) {
  if (/[.!?:;,]\s*$/.test(text)) return text + ' '
  var row = here && before && here.matches('th, td') && before.matches('th, td') && here.parentNode == before.parentNode
  return text.replace(/\s*$/, row ? ', ' : '. ')
}

// Voices read an emoji by its name ("grinning face"), so it is left out, with
// its joiners, variation selectors, skin tones and flag letters; the digit of a
// keycap stays. So does the pause of a block that was only an emoji.
function unemoji(text) {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍️⃣✓✔✗✘→←⇒]/gu, '')
    // a cross that marks something, not 3 × 4
    .replace(/(^|[^\d\s])\s*×(?!\s*\d)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/(^|[.!?:;,]) ?[.,](?= |$)/g, '$1')
    // "prüfen → ." without its arrow
    .replace(/ ([.,;:!?])(?= |$)/g, '$1')
    .trim()
}

// Sentence by sentence: Chrome drops an utterance of its online voices after
// about 15 seconds, so a long message would stop in the middle.
function sentences(text) {
  // at sentence ends with their closing quotes, and at a space where a
  // sentence is too long itself
  var parts = text.match(/[^.!?:;]{1,180}(?:[.!?:;]+["“”»«’)]*\s*|\s+|$)|[^.!?:;]{1,180}/g) || [text]
  var chunks = []
  parts.forEach(function (part) {
    var last = chunks.length - 1
    // "ca. | 30 Min." is no end of a sentence, nor "1. | Station"
    if (last >= 0 && ((chunks[last] + part).length <= 180 || ABBREVIATION.test(chunks[last]))) chunks[last] += part
    else chunks.push(part)
  })
  return chunks
}
// single letters for z. B., d. h., e. g.; numbers for 1. and dates
var ABBREVIATION = /(^|[\s(])(ca|bzw|usw|vgl|Nr|Min|Std|Mio|Mrd|Dr|Prof|etc|evtl|ggf|inkl|Abb|Kap|vs|Fig|No|Mr|Mrs|Ms|\p{L}|\d+)\.\s*$/u

function stop() {
  var item = reading
  reading = undefined
  if (item && item.button) idle(item.button)
  if (item && item.msg) item.msg.classList.remove('reading')
  try {
    speechSynthesis.cancel()
  } catch (e) {}
  var service = responsive()
  if (service) service.cancel()
  if (stageBot) Avatar.quiet([stageBot])
  if (item) showStage(currentAgent)
}

// Every robot speaks in a voice of its own (Avatar.voice): a female or male
// voice of the language where the browser has one, with its own pitch and
// rate. Without a male voice a female one gets lower and slower, and the
// other way round. Voices tell their gender only by their name.
var MALE = /\bmale\b|männlich|thorsten|karlsson|pavoque|alan|joe|norman|kusal|stefan|conrad|killian|florian|markus|yannick|hans|klaus|bernd|jonas|felix|daniel|thomas|david|guy|mark|james|george|ryan|eric|christopher|andrew|brian|jorge|diego|paul|luca|jacques|reed|rocko|eddy|fred|ralph|albert|bruce|aaron|arthur|oliver|grandpa/i
var FEMALE = /female|weiblich|kerstin|ramona|eva_k|lessac|amy|cori|kathleen|kristin|ljspeech|katja|hedda|anna|petra|helena|marlene|vicki|zira|aria|jenny|samantha|karen|moira|tessa|victoria|amelie|sandy|shelley|kathy|nora|ellen|alice|ingrid|grandma|google deutsch|google us english|google français|google italiano|google español/i

function genderOf(name) {
  if (FEMALE.test(name)) return 'female'
  if (MALE.test(name)) return 'male'
  return ''
}

// {voice, pitch, rate}: a voice of the same region, else of the same
// language. The gender of the robot counts more than the region: a British
// man for American English rather than an American woman made lower.
function voiceFor(lang, all, profile) {
  lang = lang.toLowerCase()
  // the voice the agent chose itself, if the browser has it for this language
  var own = profile.name && all.filter(function (v) {
    return v.name == profile.name && v.lang.slice(0, 2).toLowerCase() == lang.slice(0, 2)
  })[0]
  if (own) return { voice: own, pitch: profile.pitch, rate: profile.rate }
  var same = all.filter(function (v) {
    return v.lang.toLowerCase() == lang
  })
  var near = all.filter(function (v) {
    return v.lang.toLowerCase() != lang && v.lang.slice(0, 2).toLowerCase() == lang.slice(0, 2)
  })
  return pickVoice(same.length ? same : near, profile, near)
}

// others: voices to try for the gender before list is changed towards it
function pickVoice(list, profile, others) {
  var fitting = gendered(list, profile)
  if (!fitting.length && others) fitting = gendered(others, profile)
  if (fitting.length) {
    return { voice: fitting[profile.pick % fitting.length], pitch: profile.pitch, rate: profile.rate }
  }
  // none of that gender: one that says none, and changed towards it
  var voice =
    list.filter(function (v) {
      return !genderOf(v.name)
    })[0] || list[0]
  var shift = { pitch: profile.pitch, rate: profile.rate }
  if (profile.gender == 'male' && (!voice || genderOf(voice.name) != 'male')) {
    shift = { pitch: profile.pitch * 0.75, rate: profile.rate * 0.94 }
  } else if (profile.gender == 'female' && voice && genderOf(voice.name) == 'male') {
    shift = { pitch: profile.pitch * 1.25, rate: profile.rate }
  }
  return { voice: voice, pitch: Math.min(2, shift.pitch), rate: shift.rate }
}

function gendered(list, profile) {
  return list.filter(function (v) {
    return profile.gender && genderOf(v.name) == profile.gender
  })
}

// item: {parts, msg, button, status}, msg and button for a message
function read(item) {
  if (!item.parts.length) return next()
  var done = function () {
    if (reading != item) return
    stop()
    next()
  }

  reading = item
  var button = item.button
  if (button) {
    button.textContent = '\u25A0'
    tr(button, 'Stop', 'title')
    tr(button, 'Stop reading', 'aria-label')
  }
  if (item.msg) item.msg.classList.add('reading')
  var agent = item.msg ? item.msg.agent : currentAgent
  showStage(agent)
  var bots = [stageBot]
  var parts = item.parts
  var profile = Avatar.voice(agent)

  var all = voices()
  if (!all.length) {
    var service = responsive()
    if (!service) return done()
    // one voice of the service for the whole message, else its default; its
    // names say the gender ("Deutsch Male")
    var short = parts[0].lang.slice(0, 2).toLowerCase()
    var chosen = pickVoice(
      (service.getVoices() || []).filter(function (v) {
        return (v.lang || v.flag || '').slice(0, 2).toLowerCase() == short
      }),
      profile,
    )
    var named = chosen.voice
    var text = parts
      .map(function (run) {
        return run.text
      })
      .join(' ')
    // the service tells no words, the mouth moves in an estimated beat
    return service.speak(text, named ? named.name : undefined, {
      pitch: chosen.pitch,
      rate: chosen.rate,
      onstart: function () {
        Avatar.babble(bots, text)
      },
      onend: done,
      onerror: done,
    })
  }

  var utterances = []
  parts.forEach(function (run) {
    var chosen = voiceFor(run.lang, all, profile)
    var voice = chosen.voice
    sentences(run.text).forEach(function (chunk) {
      var utterance = new SpeechSynthesisUtterance(chunk)
      utterance.lang = voice ? voice.lang : run.lang
      if (voice) utterance.voice = voice
      utterance.pitch = chosen.pitch
      utterance.rate = chosen.rate
      // Also a cancel() that is not ours (Chrome drops the queue): else the
      // button kept ■ and reading blocked the queue for good. After our
      // stop() reading is another item or none, done() then does nothing.
      utterance.onerror = done
      // The mouth follows the words where the voice tells them, Chrome's
      // online voices do not: then it moves in a beat estimated from the text.
      var heard = false
      utterance.onboundary = function (e) {
        if ((e.name && e.name != 'word') || reading != item) return
        heard = true
        Avatar.talk(bots, chunk.slice(e.charIndex).split(/\s/)[0] || chunk)
      }
      utterance.onstart = function () {
        setTimeout(function () {
          if (!heard && reading == item) Avatar.babble(bots, chunk)
        }, 450)
      }
      utterances.push(utterance)
    })
  })
  utterances[utterances.length - 1].onend = done
  utterances.forEach(function (utterance) {
    speechSynthesis.speak(utterance)
  })
}

// the next one in the queue. Chrome speaks only after the user clicked or
// typed something on the page, e.g. after F5 with the box checked.
function next() {
  if (reading || !queue.length) return
  var ua = navigator.userActivation
  if (ua && !ua.hasBeenActive) return setTimeout(next, 1000)
  read(queue.shift())
}

// a status that still waits is outdated by everything that comes after it
function enqueue(item) {
  queue = queue.filter(function (waiting) {
    return !waiting.status
  })
  queue.push(item)
  next()
}

// Read everything aloud: new messages, and what the agent says it does. Of
// the progress lines of the server only Thinking, once for every request.
var autoread = document.getElementById('autoread')
var AUTOREAD = 'liascript-chat-autoread'
var thought = false // "One moment" was said for this request
var said = '' // the last progress line that was read
var replay = 0 // until then the stream replays what was, nothing is read

try {
  autoread.checked = localStorage.getItem(AUTOREAD) == 'on'
} catch (e) {}
autoread.addEventListener('change', function () {
  try {
    localStorage.setItem(AUTOREAD, autoread.checked ? 'on' : 'off')
  } catch (e) {}
  if (!autoread.checked) queue = []
})

// the box is checked, the stream replays nothing old and the browser can speak
function autoreading() {
  return autoread.checked && Date.now() >= replay && log.classList.contains('can-speak')
}

function readNew(msg) {
  if (!autoreading()) return
  msg.placed.then(function () {
    enqueue({ parts: readable(msg), msg: msg, button: msg.querySelector('.speak') })
  })
}

// what the server says when a request comes, as it is read aloud
var SPOKEN = {
  'Thinking…': 'One moment, I am thinking.',
  'Looking at your answer…': 'One moment, I am looking at your answer.',
}
var SPOKEN_TEXTS = new Set(Object.values(SPOKEN))
var lastLang = '' // of the newest message of the agent, '' for the course's

function readStatus(text) {
  // a new request, or the agent is done: the same line may come again
  var request = text == 'Waiting for the assistant…' || text == 'Looking at your answer…'
  if (!text || request) said = ''
  if (request) thought = false
  if (!autoreading()) return
  if (!text || text == 'Waiting for the assistant…' || text == said) return
  // once per request: "Looking" and then "Thinking" would say the same twice
  if (SPOKEN.hasOwnProperty(text)) {
    if (thought) return
    thought = true
    text = SPOKEN[text]
  }
  said = text
  // in the language the agent writes in: German messages in a course
  // without a language were followed by an English "One moment"
  var speak = lastLang || language()
  var known = t(text, speak) != text || /^en/i.test(speak) || !SPOKEN_TEXTS.has(text)
  text = unemoji(t(text, speak))
  if (text) enqueue({ parts: [{ lang: known ? speak : 'en', text: text }], status: true })
}

// a reload of the shell must not leave the browser talking
addEventListener('pagehide', stop)

// The browser went silent without end or error, seen twice in a row: the
// item is done. Not for responsiveVoice, which tells nothing like it.
var silent = 0
setInterval(function () {
  var quiet = reading && voices().length && !speechSynthesis.speaking && !speechSynthesis.pending
  silent = quiet ? silent + 1 : 0
  if (silent < 2) return
  silent = 0
  stop()
  next()
}, 1000)

// ---------------------------------------------------------------- user -> AI

say.addEventListener('submit', function (e) {
  e.preventDefault()
  var text = say.text.value.trim()
  if (!text) return

  // the field empties only once the bubble shows: a message that could not
  // be shown was gone, and nothing was sent either
  var unsent = { session: chatId, text: text, t: new Date().toISOString() }
  var msg = add('me', text, null, null, unsent.t)
  say.reset()
  deliver(msg, unsent)
})

// Enter sends, Shift+Enter breaks the line
say.text.addEventListener('keydown', function (e) {
  if (e.key == 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    say.requestSubmit()
  }
})

// agent: links work in the chat like in the course: LiaScript reports the
// href, its text comes from the click. A click elsewhere on a message of the
// AI reads it aloud, unless it selects text or works a quiz, code or a form.
var lastLink // the link of the last click in the chat

lia.addEventListener('agent', function (e) {
  var href = String(e.detail || '')
  var a = lastLink && lastLink.getAttribute('href') == href ? lastLink : null
  var command = Activity.link(href)
  if (!command) return
  command.label = a ? a.textContent.trim() : ''
  post(command).catch(function () {
    if (a) a.classList.add('failed')
  })
})

function readClicked(e) {
  var bubble = e.target.closest && e.target.closest('.lia-chat__msg')
  var msg = bubble && bubble.querySelector(':scope > .msg.ai')
  if (!msg || !log.classList.contains('can-speak')) return
  var ignored = 'a, button, input, label, select, textarea, form, summary, table, lia-formula, .lia-quiz, '
  if (e.target.closest(ignored + SILENT)) return
  var selection = e.target.ownerDocument.getSelection()
  if (selection && !selection.isCollapsed) return
  var button = msg.querySelector('.foot .speak')
  if (button) button.click()
}

// What the learner does with a quiz, survey, task or code in a message, reported
// like those of the course (views/agent.js), chat is the number of the
// message. The server keeps the states in the chat file, for F5, code with
// its versions and output too.
var seen = {} // of code, Activity knows the rest
var STORED = ['quiz', 'survey', 'task', 'code']

function activity(id) {
  return function (kind, block, params) {
    params.kind = kind
    params.chat = String(id)
    params.block = String(block)
    post({ type: 'activity', params: params }).catch(function () {})
  }
}

lia.addEventListener('store', function (e) {
  var record = e.detail || {}
  var id = record.id
  var data = record.data
  if (typeof id != 'number' || !Array.isArray(data)) return

  var msg = parts[id]
  if (msg && typeof msg.entry == 'number' && STORED.indexOf(record.table) >= 0) {
    post({ type: 'store', params: { table: record.table, n: msg.entry, data: data } }).catch(
      function () {},
    )
  }
  report(record.table, id, data)
})

// quiet: only remember, for the states of the history
function report(table, id, data, quiet) {
  if (table != 'code') return Activity.store(table, id, data, activity(id), quiet)
  // Every run stores its result, reported like the course. A new version
  // stores an empty log first, browsing the versions stores the one shown,
  // and a failed run came twice once.
  data.forEach(function (block, i) {
    var key = id + ':' + i
    var log = block.log || {}
    var versions = (block.version || []).length
    var was = seen[key] || { runs: 0, versions: 0 }
    var text = JSON.stringify(log)
    var now = Date.now()
    var again = (log.messages || []).length && text == was.log && now - was.t < 1000
    var browsed = versions == was.versions && block.version_active != was.active
    var runs = was.runs
    seen[key] = { log: text, t: now, versions: versions, active: block.version_active, runs: runs }
    if (quiet || versions > was.versions || again || browsed) return
    if (log.ok) {
      // the first success after a failure, then quiet again
      if (!runs) return
      seen[key].runs = 0
    } else {
      seen[key].runs = ++runs
    }
    activity(id)('code', i, {
      ok: String(log.ok),
      runs: String(runs),
      error: Activity.errors(log.messages),
      code: Activity.code(block.file),
    })
  })
}

// ---------------------------------------------------------------- AI -> user

// 1867–1934, 470–399 v. Chr., 4 v. Chr.–65: BC in the language of the chat
function lived(years) {
  var el = document.createElement('small')
  var year = function (y, last) {
    el.append(String(Math.abs(y)))
    if (y < 0 && (last || years[1] >= 0)) el.append(' ', tr(document.createElement('span'), 'BC'))
  }
  year(years[0], false)
  el.append('–')
  year(years[1], true)
  return el
}

// inputs: [{id, type: buttons|radio|checkbox|teacher, label?, options: [string]}]
// (teacher: ids of teachers.js, shown as portraits)
// Built with DOM calls only, no option text ever becomes HTML.
function form(ask, inputs) {
  var el = document.createElement('form')
  el.dataset.ask = ask
  forms.push(el)
  var needsSubmit = false

  inputs.forEach(function (input) {
    var set = document.createElement('fieldset')
    set.className = input.type
    if (input.label) {
      var legend = document.createElement('legend')
      legend.textContent = input.label
      set.append(legend)
    }
    // With other questions a button only picks its answer and Send sends them
    // all: a click sent the whole form, the other questions unanswered.
    var pick = input.type == 'buttons' && inputs.length > 1
    if (pick) {
      var picked = document.createElement('input')
      picked.type = 'hidden'
      picked.name = input.id
      set.append(picked)
      needsSubmit = true
    }

    input.options.forEach(function (option) {
      if (input.type == 'teacher') {
        var person = window.Teachers && window.Teachers.get(option)
        var card = document.createElement('button')
        card.name = input.id
        card.value = option
        // the name follows as text, a screen reader reads it once
        var face = Avatar.bot({ name: option, persona: option, label: person ? person.name : option }, 64)
        face.setAttribute('aria-hidden', 'true')
        face.removeAttribute('role')
        face.removeAttribute('aria-label')
        card.append(face)
        var name = document.createElement('strong')
        name.textContent = person ? person.name : option
        card.append(name)
        if (person) card.append(lived(person.lived))
        set.append(card)
      } else if (input.type == 'buttons') {
        var button = document.createElement('button')
        button.name = input.id
        button.value = button.textContent = option
        if (pick) {
          button.type = 'button'
          button.addEventListener('click', function () {
            set.querySelectorAll('button').forEach(function (other) {
              other.classList.toggle('chosen', other == button)
            })
            picked.value = option
          })
        }
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
  if (needsSubmit && (inputs.length > 1 || !el.querySelector('button'))) {
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
      if (input.type == 'radio' || input.type == 'buttons') params[input.id] = data.get(input.id) || ''
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

function lock(el) {
  el.querySelectorAll('fieldset, button').forEach(function (x) {
    x.disabled = true
  })
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
  lock(el)
  stageState()
}

// replaced by a newer form, withdrawn by the AI or asked before a restart
// reason: what the agent says about it, in the language of the chat
function closed(el, reason) {
  if (el.classList.contains('answered') || el.classList.contains('closed')) return
  el.classList.remove('failed')
  el.classList.add('closed')
  lock(el)
  var note = document.createElement('p')
  note.className = 'note'
  el.append(tr(note, 'No longer open'))
  if (reason) {
    var why = document.createElement('p')
    why.className = 'note'
    why.textContent = reason
    el.append(why)
  }
  stageState()
}

// what the AI is doing right now, until its next message without one
function status(text) {
  var line = document.getElementById('status')
  tr(line, text || '')
  line.hidden = !text
  if (text) document.getElementById('chat').open = true
  stageState()
  readStatus(text || '')
}

// below the progress line when the server has no sign of the AI for a while
function hint(text) {
  var line = document.getElementById('hint')
  tr(line, text)
  line.hidden = !text
}

// The server pings every PING_MS. A stream that stays silent much longer is
// dead without an error (seen in Firefox: messages of the agent never came),
// so it is opened anew; the browser retries a broken one itself.
var PING_MS = 20000
var stream
var lastHeard = 0

function connect() {
  if (stream) stream.close()
  stream = new EventSource('/gotoLine?chat')
  lastHeard = Date.now()
  // every (re)connect first replays the chat, the agents and the progress
  // line, also the hint of the server if there is one
  stream.onopen = function () {
    replay = Date.now() + 1500
    hint('')
  }
  stream.onerror = function () {
    hint('The connection to the server is lost, connecting again…')
  }
  stream.onmessage = message
}
connect()
setInterval(function () {
  if (Date.now() - lastHeard > 2.5 * PING_MS) connect()
}, PING_MS / 2)

function message(event) {
  lastHeard = Date.now()
  var data
  try {
    data = JSON.parse(event.data)
  } catch (e) {
    return
  }
  if (typeof data.proxy == 'string') {
    // agent.js in the course frame reads it too
    document.documentElement.dataset.proxy = data.proxy
    document.getElementById('browse').hidden = data.proxy == 'off'
    return
  }
  if (typeof data.home == 'string') {
    homeCourse = data.home
    return showHome()
  }
  if (typeof data.status == 'string') return status(data.status)
  if (typeof data.hint == 'string') return hint(data.hint)
  if (data.closed) {
    return forms.forEach(function (el) {
      if (el.dataset.ask == data.closed) closed(el, data.reason)
    })
  }
  if (data.agents) return showAgents(data.agents)
  if (data.sessions) return showSessions(data.sessions)
  if (data.session) return showSession(data.session)
  if (data.entry) return showEntry(data.entry)
  // run_in_page: views/web.js runs it, the frame may have moved on to
  // another page by now, which only learns the code
  if (data.page) return course.contentWindow.postMessage({ page: data.page }, '*')
  // the player follows a goto to a course itself, the file listing and a
  // web page cannot
  if (data.goto) {
    var go = data.goto
    if (typeof go.url == 'string') course.src = webPage(go.url)
    else if (go.file && !isPlayer()) {
      course.src = 'index.html?' + location.origin + '/' + encodeURI(go.file) + (go.slide ? '#' + go.slide : '')
    }
    return
  }

  var chat = data.chat
  if (!chat) return

  readNew(showAI(chat))
  document.getElementById('chat').open = true
  status(chat.status)
}

function showAI(chat, t) {
  var msg = add(
    'ai',
    chat.markdown,
    chat.inputs && chat.inputs.length ? form(chat.id, chat.inputs) : null,
    chat.agent,
    t,
  )
  msg.entry = chat.n
  lastLang = typeof chat.lang == 'string' ? chat.lang : ''
  if (typeof chat.lang == 'string') {
    msg.lang = chat.lang
    // placed already, place() sets it otherwise
    if (msg.parentNode) msg.parentNode.lang = chat.lang
  }
  stageState()
  return msg
}

// the fixed texts of the page, in the language of the browser until the
// course says its own
localize()
theme()
showStage()
