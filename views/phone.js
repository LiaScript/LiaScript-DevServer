// The chat on a phone: below WIDE the course and the chat take turns on the whole
// screen, a bar at the bottom switches. In the course a card shows the newest
// message of the agent, in the chat a strip says where the course is.
// chat.js tells what happens with the DOM event 'lia:shell'. The helpers of
// window.Phone need no DOM, src/check.js runs them in a vm.
;(function (root) {
  var Phone = {
    // the first line of a message as plain text, for the card
    firstLine: function (markdown) {
      var lines = String(markdown || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
      var line = ''
      for (var i = 0; i < lines.length && !line; i++) line = lines[i].trim()
      line = line
        .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/(\*\*|__|\*|`|~~)/g, '')
        .trim()
      return line.length > 120 ? line.slice(0, 120) + '…' : line
    },
    // the slide from #n, the title without the course after the last ' · '
    where: function (title, hash) {
      var n = /^#(\d+)/.exec(hash || '')
      var parts = String(title || '').split(' · ')
      return { slide: n ? Number(n[1]) : null, title: (parts.length > 1 ? parts.slice(0, -1) : parts).join(' · ') }
    },
    // what the badge counts: messages of the agent or the class that came while the course showed
    unread: function (n, detail, view) {
      if (view == 'chat') return 0
      return detail && (detail.kind == 'ai' || detail.kind == 'class') && !detail.replay ? n + 1 : n
    },
    // after a reconnect or F5: the messages of the agent after the last one seen in the chat
    missed: function (numbers, seen) {
      return numbers.filter(function (n) {
        return n > seen
      }).length
    },
  }
  root.Phone = Phone
  if (typeof document == 'undefined') return

  Object.assign(TEXTS.de, {
    Course: 'Kurs',
    View: 'Ansicht',
    'You are on slide': 'Du bist auf Folie',
    'To the course': 'Zum Kurs',
    'New message, open the chat': 'Neue Nachricht, Chat öffnen',
  })

  var body = document.body
  var VIEW = 'liascript-chat-view'
  var SEEN = 'liascript-chat-seen' // {id, n}: the session and the last agent message seen in the chat
  var session = ''
  var last = -1 // the newest agent message of this session
  var small = matchMedia('(max-width: ' + (WIDE - 1) + 'px)')
  var view = 'course'
  var count = 0
  var peekStatus = false
  var bar = document.getElementById('switch')
  var toCourse = document.getElementById('to-course')
  var toChat = document.getElementById('to-chat')
  var badge = document.getElementById('unread')
  var slide = document.getElementById('to-slide')
  var peek = document.getElementById('peek')
  var strip = document.getElementById('where')

  function phone() {
    return body.classList.contains('phone')
  }

  function setView(v) {
    view = v
    body.dataset.view = v
    toCourse.setAttribute('aria-pressed', String(v == 'course'))
    toChat.setAttribute('aria-pressed', String(v == 'chat'))
    if (v == 'chat') {
      count = 0
      peek.hidden = true
      box.open = true
      saw()
    }
    showCount()
    place()
    try {
      localStorage.setItem(VIEW, v)
    } catch (e) {}
  }

  function seen() {
    try {
      return JSON.parse(localStorage.getItem(SEEN)) || {}
    } catch (e) {
      return {}
    }
  }
  function saw() {
    try {
      localStorage.setItem(SEEN, JSON.stringify({ id: session, n: last }))
    } catch (e) {}
  }

  function showCount() {
    badge.hidden = !count
    badge.textContent = count > 9 ? '9+' : String(count)
  }

  // the head of the chat is a header here, its height for the panel below it
  function place() {
    box.style.setProperty('--head', who.offsetHeight + 'px')
    where()
  }

  function where() {
    var w = Phone.where(document.title, location.hash)
    slide.textContent = w.slide ? '#' + w.slide : ''
    var text = strip.querySelector('.text')
    text.textContent = ''
    if (w.slide) {
      text.append(t('You are on slide') + ' ')
      var b = document.createElement('b')
      b.textContent = w.slide + ' · ' + w.title
      text.append(b)
    } else text.textContent = w.title
    strip.hidden = !w.title && !w.slide
  }

  function showPeek(agent, line, isStatus) {
    if (!line) return
    var face = peek.querySelector('.face')
    // without a roster the agent of the head
    if (!agent && !face.firstChild) agent = { name: who.textContent.trim() }
    if (agent) {
      face.textContent = ''
      face.append(Avatar.bot(agent, 32))
      peek.querySelector('.name').textContent = agent.label || agent.name || ''
    }
    peek.querySelector('.line').textContent = line
    peekStatus = !!isStatus
    peek.hidden = false
  }

  function enter(on) {
    body.classList.toggle('phone', on)
    if (on) {
      body.classList.remove('docked')
      box.open = true
      var stored = null
      try {
        stored = localStorage.getItem(VIEW)
      } catch (e) {}
      setView(stored == 'chat' ? 'chat' : 'course')
    } else {
      delete body.dataset.view
      peek.hidden = true
      applyDock()
    }
  }

  toCourse.addEventListener('click', function () {
    setView('course')
  })
  toChat.addEventListener('click', function () {
    setView('chat')
  })
  peek.addEventListener('click', function () {
    setView('chat')
  })
  strip.addEventListener('click', function () {
    setView('course')
  })
  // the head opens and closes the chat elsewhere, here the bar switches
  who.addEventListener(
    'click',
    function (e) {
      if (phone()) e.preventDefault()
    },
    true,
  )

  document.addEventListener('lia:shell', function (e) {
    var d = e.detail || {}
    if (!phone()) return
    if (d.kind == 'history') {
      // a session (re)loaded: what came while the stream was down is new
      var before = seen()
      session = d.id
      last = d.ai.length ? d.ai[d.ai.length - 1] : -1
      if (view == 'chat' || before.id != d.id) return saw()
      count = Phone.missed(d.ai, before.n)
      showCount()
      return
    }
    if (d.kind == 'ai' && typeof d.n == 'number') last = Math.max(last, d.n)
    if (d.kind == 'ai') {
      if (d.ask && !d.replay) return setView('chat')
      count = Phone.unread(count, d, view)
      showCount()
      if (view == 'course' && !d.replay) showPeek(d.agent, Phone.firstLine(d.markdown))
      else if (view == 'chat') saw()
    } else if (d.kind == 'class') {
      count = Phone.unread(count, d, view)
      showCount()
      if (view == 'course') showPeek({ name: d.from }, d.text)
    } else if (d.kind == 'goto' && !d.replay) setView('course')
    else if (d.kind == 'status') {
      if (d.text && view == 'course') showPeek(null, t(d.text), true)
      else if (!d.text && peekStatus) peek.hidden = true
    }
    where()
  })

  // agent.js writes the title of the course into the shell's title
  new MutationObserver(where).observe(document.querySelector('title'), { childList: true, characterData: true, subtree: true })
  addEventListener('hashchange', where)
  addEventListener('resize', function () {
    if (phone()) place()
  })
  small.addEventListener('change', function (e) {
    enter(e.matches)
  })

  translate(bar)
  translate(peek)
  translate(strip)
  enter(small.matches)
})(typeof window != 'undefined' ? window : this)
