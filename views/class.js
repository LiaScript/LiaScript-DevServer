// The class channel of a DevServer with users (lialms --users, src/gateway.ts):
// messages between people beside the chat with the AI, which never sees them.
// The teacher writes to all or to one, a user to the teacher, and users to
// each other once the teacher allows it. Without a gateway /class/state is
// 404 and nothing of this appears.
;(function () {
  // '' here, the folder and tab of the share page through --share
  var BASE = location.pathname.slice(0, location.pathname.lastIndexOf('/liascript/'))
  var TEACHER = '@teacher'
  var ALL = '@all'

  Object.assign(TEXTS.de, {
    Class: 'Klasse',
    'Messages of the class': 'Nachrichten der Klasse',
    'Back to the AI': 'Zurück zur KI',
    'Message to …': 'Nachricht an …',
    Teacher: 'Lehrkraft',
    all: 'alle',
    you: 'du',
    'to the teacher': 'an die Lehrkraft',
    'You are muted.': 'Du bist stummgeschaltet.',
    'No messages yet.': 'Noch keine Nachrichten.',
    Close: 'Schließen',
  })

  fetch(BASE + '/class/state')
    .then(function (r) {
      return r.ok ? r.json() : null
    })
    .then(function (state) {
      if (state) start(state)
    })
    .catch(function () {})

  function start(state) {
    var panel = document.getElementById('panel')
    var log = document.getElementById('log')
    var open = false
    var unread = 0
    // the newest message this user saw: what came while the tab was closed counts too
    var SEEN = 'lia-class-seen-' + state.me
    var seen = ''
    try {
      seen = localStorage.getItem(SEEN) || ''
    } catch (e) {}

    // the button in the bar, with the number of new messages
    var button = document.createElement('button')
    button.type = 'button'
    button.id = 'class-open'
    button.className = 'tool'
    tr(button, 'Class', 'title')
    tr(button, 'Class', 'aria-label')
    // Lucide "users" (ISC license, lucide.dev)
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span class="badge" hidden></span>'
    var badge = button.querySelector('.badge')
    document.getElementById('bar').insertBefore(button, document.getElementById('new'))

    // a message of the teacher to all, above the chat
    var banner = document.createElement('div')
    banner.id = 'class-banner'
    banner.hidden = true
    banner.innerHTML = '<span class="text"></span><button type="button" class="tool" aria-label="Close">×</button>'
    tr(banner.querySelector('button'), 'Close', 'aria-label')
    panel.insertBefore(banner, log)

    // the view of the class: the messages and a form
    var view = document.createElement('section')
    view.id = 'class'
    view.hidden = true
    view.innerHTML =
      '<div class="head"><b></b><button type="button" class="back"></button></div><div class="list" role="log" aria-live="polite"></div><form><select name="to"></select><textarea name="text" rows="2" required maxlength="2000"></textarea><button class="send"></button></form><p class="muted" hidden></p>'
    tr(view.querySelector('.head b'), 'Messages of the class')
    tr(view.querySelector('.back'), 'Back to the AI')
    tr(view.querySelector('textarea'), 'Message to …', 'placeholder')
    tr(view.querySelector('.send'), 'Send')
    tr(view.querySelector('.muted'), 'You are muted.')
    panel.insertBefore(view, log)
    var list = view.querySelector('.list')
    var form = view.querySelector('form')

    // tr(): the list is drawn before the language of the course is known
    function name(n) {
      var key = n === TEACHER ? 'Teacher' : n === ALL ? 'all' : n === state.me ? 'you' : ''
      var span = document.createElement('span')
      if (key) tr(span, key)
      else span.textContent = n
      return span
    }

    function show(m) {
      var row = document.createElement('div')
      row.className = 'm' + (m.from === state.me ? ' mine' : '') + (m.from === TEACHER ? ' teacher' : '')
      var who = document.createElement('small')
      var time = document.createElement('time')
      time.dateTime = m.t
      time.textContent = clock(m.t)
      who.append(name(m.from), ' → ', name(m.to), ' · ', time)
      var text = document.createElement('div')
      text.textContent = m.text
      row.append(who, text)
      list.append(row)
      list.scrollTop = list.scrollHeight
    }

    function render() {
      list.textContent = ''
      if (!state.messages.length) {
        var none = document.createElement('p')
        none.className = 'none'
        tr(none, 'No messages yet.')
        list.append(none)
      }
      state.messages.forEach(show)
      // the teacher always, the others when the teacher allows it
      var to = form.to
      var chosen = to.value
      to.textContent = ''
      var teacher = document.createElement('option')
      teacher.value = TEACHER
      tr(teacher, 'to the teacher')
      to.append(teacher)
      state.users.forEach(function (n) {
        var o = document.createElement('option')
        o.value = n
        o.textContent = n
        to.append(o)
      })
      if ([].some.call(to.options, (o) => o.value == chosen)) to.value = chosen
      form.hidden = state.muted
      view.querySelector('.muted').hidden = !state.muted
    }

    function toggle(on) {
      open = on
      panel.classList.toggle('class-view', on)
      view.hidden = !on
      button.setAttribute('aria-pressed', on)
      if (on) {
        markSeen()
        unread = 0
        badge.hidden = true
        banner.hidden = true
        list.scrollTop = list.scrollHeight
      }
    }

    button.addEventListener('click', function () {
      toggle(!open)
    })
    view.querySelector('.back').addEventListener('click', function () {
      toggle(false)
    })
    banner.addEventListener('click', function (e) {
      if (e.target.closest('button')) banner.hidden = true
      else toggle(true)
    })

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var text = form.text.value.trim()
      if (!text) return
      fetch(BASE + '/class/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: form.to.value, text: text }),
      }).then(function (r) {
        if (r.ok) form.text.value = ''
      })
    })
    form.text.addEventListener('keydown', function (e) {
      if (e.key == 'Enter' && !e.shiftKey) {
        e.preventDefault()
        form.requestSubmit()
      }
    })

    function arrived(m) {
      if (m.from == state.me || m.t <= seen) return
      unread++
      badge.textContent = unread
      badge.hidden = false
      if (m.from == TEACHER) {
        // tr(): on load the language of the course is not known yet
        var text = banner.querySelector('.text')
        var who = document.createElement('b')
        tr(who, 'Teacher')
        text.textContent = ''
        text.append(who, ': ' + m.text)
        banner.hidden = false
      }
      // a phone that shows the course: the bar counts it, a card shows it
      document.dispatchEvent(new CustomEvent('lia:shell', { detail: { kind: 'class', from: m.from == TEACHER ? t('Teacher') : m.from, text: m.text } }))
    }

    function markSeen() {
      var last = state.messages[state.messages.length - 1]
      if (!last) return
      seen = last.t
      try {
        localStorage.setItem(SEEN, seen)
      } catch (e) {}
    }

    render()
    state.messages.forEach(arrived)

    // live: new messages and changes of the teacher (muted, users may write)
    var stream
    function listen() {
      if (stream) stream.close()
      stream = new EventSource(BASE + '/class/events')
      stream.onmessage = function (e) {
        var msg
        try {
          msg = JSON.parse(e.data)
        } catch (err) {
          return
        }
        if (msg.state) {
          state = msg.state
          render()
        } else if (msg.message) {
          state.messages.push(msg.message)
          var none = list.querySelector('.none')
          if (none) none.remove()
          show(msg.message)
          if (open) markSeen()
          else arrived(msg.message)
        }
      }
      // a stream that failed does not try again by itself
      stream.onerror = function () {
        stream.close()
        setTimeout(listen, 5000)
      }
    }
    listen()
  }
})()
