// The admin page of the gateway (src/gateway.ts): switches that send their
// form, questions before what cannot be undone, copy, QR codes large, inline
// form errors, the folder list, a poll every 5 s and the menu. A file of its
// own because the page's CSP runs no inline script.
;(function () {
  'use strict'
  document.documentElement.classList.add('js')
  var T = {}
  try {
    T = JSON.parse(document.getElementById('texts').textContent)
  } catch (e) {}

  // ------------------------------------------------------------ ask first
  // a <dialog> instead of confirm(): yes calls back, no or Esc does not
  var ask = document.getElementById('ask')
  function confirmFirst(text, yes, no) {
    if (!ask || !ask.showModal) return window.confirm(text) ? yes() : no && no()
    ask.querySelector('.ask-text').textContent = text
    ask.onclick = function (e) {
      var b = e.target.closest('[data-answer]')
      if (!b && e.target !== ask) return
      ask.close()
      if (b && b.dataset.answer === 'yes') yes()
      else if (no) no()
    }
    ask.oncancel = function () {
      if (no) no()
    }
    ask.showModal()
    ask.querySelector('[data-answer="no"]').focus()
  }
  document.addEventListener('submit', function (e) {
    var f = e.target
    if (!f.dataset || !f.dataset.confirm || f.dataset.ok) return
    e.preventDefault()
    confirmFirst(f.dataset.confirm, function () {
      f.dataset.ok = '1'
      f.requestSubmit ? f.requestSubmit() : f.submit()
    })
  })
  // a switch sends its form at once; switching off may ask first
  document.addEventListener('change', function (e) {
    var box = e.target
    if (box.getAttribute('role') !== 'switch') return
    var f = box.form
    var send = function () {
      f.submit()
    }
    if (!box.checked && f.dataset.confirmOff)
      confirmFirst(f.dataset.confirmOff, send, function () {
        box.checked = true
      })
    else send()
  })

  // ------------------------------------------------------------ copy, QR codes
  var qrDialog = document.getElementById('qr-dialog')
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-copy]')
    if (c) {
      var label = c.querySelector('span') || c
      navigator.clipboard.writeText(c.dataset.copy).then(function () {
        if (!label.dataset.was) label.dataset.was = label.textContent
        label.textContent = T.copied || '✓'
        setTimeout(function () {
          label.textContent = label.dataset.was
        }, 1600)
      })
    }
    var q = e.target.closest('[data-qr]')
    if (q && qrDialog && qrDialog.showModal) {
      qrDialog.querySelector('#qr-title').textContent = q.dataset.qrTitle || ''
      qrDialog.querySelector('.qr-link').textContent = q.dataset.qrLink || ''
      var big = qrDialog.querySelector('.qr-big')
      big.textContent = ''
      var svg = q.querySelector('svg')
      if (svg) big.append(svg.cloneNode(true))
      qrDialog.showModal()
    }
    if (e.target === qrDialog) qrDialog.close()
    var d = e.target.closest('[data-dismiss]')
    if (d) dismiss(d.closest('.toast'))
    var p = e.target.closest('[data-pick]')
    if (p) folders(p.form, p.form.path.value)
    // light or dark: the other one than now, kept as a cookie for the server
    if (e.target.closest('[data-theme-toggle]')) {
      var root = document.documentElement
      var dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
      root.dataset.theme = dark ? 'light' : 'dark'
      document.cookie = 'lia-theme=' + root.dataset.theme + '; path=/; max-age=31536000; samesite=strict'
    }
    // the settings open when the menu leads there
    if (e.target.closest('a[href="#settings"]')) document.getElementById('settings').open = true
  })

  // ------------------------------------------------------------ one Manage menu at a time
  function closeMenus(except) {
    document.querySelectorAll('details.menu[open]').forEach(function (d) {
      if (d !== except) d.open = false
    })
  }
  document.addEventListener(
    'toggle',
    function (e) {
      if (e.target.matches && e.target.matches('details.menu') && e.target.open) closeMenus(e.target)
    },
    true,
  )
  document.addEventListener('click', function (e) {
    if (!e.target.closest('details.menu') && !e.target.closest('dialog')) closeMenus()
  })
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return
    var open = document.querySelector('details.menu[open]')
    if (open) open.open = false, open.querySelector('summary').focus()
  })

  // ------------------------------------------------------------ the message of the last form
  function dismiss(t) {
    if (!t) return
    t.classList.add('gone')
    setTimeout(function () {
      t.remove()
    }, 500)
  }
  var toast = document.querySelector('.toast')
  if (toast) setTimeout(dismiss, 8000, toast)
  // F5 must not show it again
  if (location.search) history.replaceState(null, '', location.pathname + location.hash)

  // ------------------------------------------------------------ errors next to the field
  document.addEventListener(
    'invalid',
    function (e) {
      var input = e.target
      var box = input.closest('.field') && input.closest('.field').querySelector('.error')
      if (!box || !input.dataset.error) return
      e.preventDefault()
      box.textContent = input.dataset.error
      box.hidden = false
      input.setAttribute('aria-invalid', 'true')
      if (!box.id) box.id = 'err-' + Math.random().toString(36).slice(2)
      input.setAttribute('aria-describedby', box.id)
      if (!document.querySelector('[aria-invalid="true"]:focus')) input.focus()
    },
    true,
  )
  document.addEventListener('input', function (e) {
    var input = e.target
    if (input.getAttribute('aria-invalid') !== 'true' || !input.checkValidity()) return
    input.removeAttribute('aria-invalid')
    var box = input.closest('.field').querySelector('.error')
    if (box) box.hidden = true
  })

  // ------------------------------------------------------------ the folders below home
  function folders(form, at) {
    var box = form.nextElementSibling
    box.hidden = false
    box.textContent = ''
    box.setAttribute('aria-busy', 'true')
    for (var i = 0; i < 4; i++) {
      var sk = document.createElement('span')
      sk.className = 'sk'
      box.append(sk)
    }
    fetch('/folders?path=' + encodeURIComponent(at || ''))
      .then(function (r) {
        return r.ok
          ? r.json()
          : fetch('/folders').then(function (r) {
              return r.json()
            })
      })
      .then(function (f) {
        form.path.value = f.path
        box.textContent = ''
        box.removeAttribute('aria-busy')
        var head = document.createElement('p')
        head.className = 'head'
        head.textContent = f.path + ' · ' + String(T.nCourses || '{n}').replace('{n}', f.courses)
        box.append(head)
        ;(f.parent ? ['..'] : []).concat(f.folders).forEach(function (name) {
          var b = document.createElement('button')
          b.type = 'button'
          b.className = 'btn quiet xs'
          b.textContent = name == '..' ? '↑ ' + (T.up || '..') : name
          b.onclick = function () {
            folders(form, name == '..' ? f.parent : f.path + '/' + name)
          }
          box.append(b)
        })
      })
  }

  // ------------------------------------------------------------ poll
  // the parts that change by themselves; never while the teacher is in them
  function busy(el) {
    // typing only: a copy button or menu keeps the focus after the click, and the table stood still
    return (
      (el.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) ||
      el.querySelector('details[open]') ||
      document.querySelector('dialog[open]') ||
      el.querySelector('[aria-busy]')
    )
  }
  // whole: the url answers the whole page, its element of that id is taken
  function refresh(id, url, then, whole) {
    var el = document.getElementById(id)
    if (!el || busy(el)) return
    fetch(url)
      .then(function (r) {
        return r.ok ? r.text() : Promise.reject(r.status)
      })
      .then(function (html) {
        if (busy(el)) return
        if (whole) html = new DOMParser().parseFromString(html, 'text/html').getElementById(id).innerHTML
        if (html === el.innerHTML) return
        el.innerHTML = html
        if (then) then(el)
      })
      .catch(function () {})
  }
  setInterval(function () {
    if (document.hidden) return
    refresh('top', '/top', function (el) {
      var s = el.querySelector('[data-online-label]')
      var label = document.getElementById('online-label')
      if (s && label) label.textContent = s.dataset.onlineLabel
    })
    refresh('rows', '/rows')
    refresh('signals-list', '/signals')
    refresh('log', '/class/log')
    // the chat of a user: follows the newest entry while the teacher reads at the end
    var end = innerHeight + scrollY >= document.documentElement.scrollHeight - 40
    refresh('entries', location.pathname, function () {
      if (end) scrollTo(0, document.documentElement.scrollHeight)
    }, true)
  }, 5000)

  // ------------------------------------------------------------ menu and the section in view
  var menu = document.querySelector('.menu-btn')
  var panel = document.getElementById('panel')
  function openMenu(open) {
    menu.setAttribute('aria-expanded', open ? 'true' : 'false')
    panel.hidden = !open
    document.body.style.overflow = open ? 'hidden' : ''
  }
  if (menu && panel) {
    menu.addEventListener('click', function () {
      openMenu(panel.hidden)
    })
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) openMenu(false)
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) openMenu(false)
    })
  }
  if ('IntersectionObserver' in window) {
    var navs = document.querySelectorAll('[data-nav]')
    var current = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return
          navs.forEach(function (a) {
            if (a.dataset.nav === en.target.id) a.setAttribute('aria-current', 'true')
            else a.removeAttribute('aria-current')
          })
        })
      },
      { rootMargin: '-40% 0px -55% 0px' },
    )
    ;['access', 'users', 'class', 'settings', 'help'].forEach(function (id) {
      var s = document.getElementById(id)
      if (s) current.observe(s)
    })
    // sections rise into place once
    var reveal = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) en.target.classList.add('in'), reveal.unobserve(en.target)
        })
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    document.querySelectorAll('.reveal').forEach(function (s) {
      reveal.observe(s)
    })
  } else document.querySelectorAll('.reveal').forEach(function (s) {
    s.classList.add('in')
  })
})()
