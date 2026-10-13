// Pixel robots for the agents of the chat: a matrix of 12 x 12 LEDs. Eyes and
// mouth are those of the DiceBear style "Pixelbot" (CC0 1.0, dicebear.com),
// taken over as cell numbers (row * 12 + column), so no library is needed. A
// role adds its LED colour, a symbol in the three rows above the eyes in its
// accent colour, its own eyes and a tinted case; the bottom row shows what the
// agent does (thinking, waiting). Inline SVG, so that mouth and state switch
// with an attribute while the robot reads aloud.

var Avatar = (function () {
  var P = 100 / 12

  var EYES = {
    round: [39, 44, 50, 51, 52, 55, 56, 57, 63, 68],
    happy: [51, 56, 62, 64, 67, 69],
    blocks: [50, 51, 56, 57, 62, 63, 68, 69],
    soft: [62, 63, 64, 67, 68, 69],
    tall: [38, 39, 44, 45, 50, 51, 56, 57, 62, 63, 68, 69],
    slim: [51, 56, 63, 68],
    wide: [50, 51, 52, 55, 56, 57, 62, 63, 64, 67, 68, 69],
  }
  // closed (a smile), half open, open
  var MOUTH = [
    [100, 103, 113, 114],
    [101, 102, 113, 114],
    [100, 101, 102, 103, 112, 113, 114, 115],
  ]

  // glyph: three rows of twelve, a = accent, b = second accent (sparks).
  // voice: [female|male|'' for any, pitch (1 = normal), rate (1 = normal)],
  // so that every robot sounds different from the others, also when the
  // browser has a single voice: then a male one is that voice made lower and
  // slower (chat.js), and the young learner is high and fast
  var ROLES = {
    assistant: { face: '#7dd3fc', bg: '#0f172a', eyes: 'round', voice: ['', 1, 1] },
    teaching: {
      face: '#7dd3fc', accent: '#ffffff', extra: '#fde68a', bg: '#172554', eyes: 'happy', voice: ['female', 1, 0.95],
      glyph: ['.....aa.....', '..aaaaaaaa..', '....aaaa.b..'],
    },
    artist: {
      face: '#f9a8d4', accent: '#c4b5fd', extra: '#fde68a', bg: '#3b0764', eyes: 'soft', spark: 'twinkle',
      voice: ['female', 1.25, 1.05],
      glyph: ['.b.....a..b.', '...aaaaaaa..', '..aaaaaaa...'],
    },
    learner: {
      face: '#fde68a', accent: '#86efac', bg: '#422006', eyes: 'wide', voice: ['', 1.5, 1.15],
      glyph: ['...aa..aa...', '....aaaa....', '.....aa.....'],
    },
    development: {
      face: '#86efac', accent: '#ffffff', bg: '#022c22', eyes: 'blocks', voice: ['male', 0.8, 1.06],
      glyph: ['..a....a.a..', '.a....a...a.', '..a..a...a..'],
    },
    reviewer: {
      face: '#c4b5fd', accent: '#86efac', bg: '#1e1b4b', eyes: 'slim', voice: ['female', 0.85, 0.82],
      glyph: ['..........a.', '.......a.a..', '........a...'],
    },
    translator: {
      face: '#5eead4', accent: '#ffffff', extra: '#fdba74', bg: '#042f2e', eyes: 'round', voice: ['female', 1.1, 1.12],
      glyph: ['.aaaa.bbbb..', '.aaaa.bbbb..', '.a.......b..'],
    },
    research: {
      face: '#fdba74', accent: '#ffffff', extra: '#f9a8d4', bg: '#431407', eyes: 'tall', spark: 'beacon',
      voice: ['male', 0.96, 0.94],
      glyph: ['.........b..', '.........a..', '........aaa.'],
    },
  }

  // a word of the name that says the role, e.g. course-designer
  var ALIASES = [
    [/(^|[-_])(teach|tutor|lehr|didakt)/, 'teaching'],
    [/(^|[-_])(art|design|grafik|graphic|visual|bild)/, 'artist'],
    [/(^|[-_])(learn|student|schüler|schueler|persona)/, 'learner'],
    [/(^|[-_])(dev|code|coder|git|publish|program|entwick)/, 'development'],
    [/(^|[-_])(review|check|prüf|pruef|feedback|critic)/, 'reviewer'],
    [/(^|[-_])(transl|übersetz|uebersetz)/, 'translator'],
    [/(^|[-_])(research|recherch|search|source|quell)/, 'research'],
  ]
  var EMOJI = {
    '🎓': 'teaching', '🧑‍🏫': 'teaching', '👩‍🏫': 'teaching', '👨‍🏫': 'teaching', '📚': 'teaching',
    '🎨': 'artist', '🖌': 'artist', '🖼': 'artist', '✏': 'artist',
    '🧑‍🎓': 'learner', '👩‍🎓': 'learner', '👨‍🎓': 'learner', '🌱': 'learner',
    '🛠': 'development', '💻': 'development', '🔧': 'development', '⚙': 'development', '🧑‍💻': 'development',
    '✅': 'reviewer', '🔍': 'reviewer', '🧐': 'reviewer', '☑': 'reviewer',
    '🌐': 'translator', '🗣': 'translator', '💬': 'translator',
    '🔬': 'research', '📡': 'research', '🔎': 'research', '🧭': 'research',
  }
  // for a name nothing tells about: colour, case and eyes from its letters
  var FACES = ['#7dd3fc', '#5eead4', '#86efac', '#bef264', '#fde68a', '#fdba74', '#f9a8d4', '#c4b5fd']
  var CASES = ['#0f172a', '#172554', '#1e1b4b', '#2e1065', '#3b0764', '#500724', '#022c22', '#083344']
  var EYE_NAMES = Object.keys(EYES)

  function hash(text) {
    var h = 0
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
    return Math.abs(h)
  }

  // agent: {name, emoji, label} or nothing, for a message without an agent
  function role(agent) {
    if (!agent || !agent.name) return ROLES.assistant
    var name = agent.name.toLowerCase()
    if (ROLES[name]) return ROLES[name]
    for (var i = 0; i < ALIASES.length; i++) {
      if (ALIASES[i][0].test(name)) return ROLES[ALIASES[i][1]]
    }
    var emoji = (agent.emoji || '').replace(/️/g, '').trim()
    if (EMOJI[emoji]) return ROLES[EMOJI[emoji]]
    var h = hash(agent.name)
    return {
      face: FACES[h % FACES.length],
      bg: CASES[(h >> 3) % CASES.length],
      eyes: EYE_NAMES[(h >> 6) % EYE_NAMES.length],
      voice: [h & 1 ? 'male' : 'female', 0.85 + ((h >> 9) % 9) * 0.05, 0.92 + ((h >> 13) % 5) * 0.04],
    }
  }

  // how the robot of an agent speaks: {gender, pitch, rate, pick}, pick
  // chooses among several fitting voices, the same one every time; a
  // persona speaks with the gender of the person, pitch and rate from its id
  function voice(agent) {
    var v = role(agent).voice
    var person = agent && agent.persona && window.Teachers ? window.Teachers.get(agent.persona) : null
    if (person) {
      var h = hash(agent.persona)
      v = [person.gender, 0.9 + (h % 5) * 0.05, 0.92 + ((h >> 4) % 4) * 0.04]
    }
    // name: the voice the agent chose itself (set_agent voice)
    return { gender: v[0], pitch: v[1], rate: v[2], pick: hash(agent && agent.name ? agent.name : ''), name: agent && agent.voice }
  }

  function cell(n) {
    var x = ((n % 12) * P + 0.42 + 1.9).toFixed(2)
    var y = (Math.floor(n / 12) * P + 0.42).toFixed(2)
    return 'M' + x + ' ' + y + 'h3.7a1.9 1.9 0 0 1 1.9 1.9v3.7a1.9 1.9 0 0 1-1.9 1.9h-3.7a1.9 1.9 0 0 1-1.9-1.9v-3.7a1.9 1.9 0 0 1 1.9-1.9'
  }

  function path(cells, fill, extra) {
    return '<path d="' + cells.map(cell).join('') + '" fill="' + fill + '"' + (extra || '') + '/>'
  }

  // the dimmed LEDs, once per page, referenced by every robot
  function defs() {
    if (document.getElementById('lia-bot-grid')) return
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.style.position = 'absolute'
    svg.innerHTML =
      '<defs><pattern id="lia-bot-grid" width="' + P + '" height="' + P + '" patternUnits="userSpaceOnUse">' +
      '<rect x=".42" y=".42" width="7.5" height="7.5" rx="1.9" fill="#000" fill-opacity=".4"/></pattern></defs>'
    document.body.append(svg)
  }

  // A teacher persona (teachers.js): the portrait of a historical person
  // instead of the robot. The same classes as the robot, so that data-mouth
  // and data-state work alike: m0 resting, m1 and m2 open, a bar below for
  // the running light and the pulse. null if the person is unknown here,
  // e.g. teachers.js failed to load: then the robot.
  function portrait(agent, size) {
    var frames = agent && agent.persona && window.Teachers ? window.Teachers.frames(agent.persona) : null
    if (!frames) return null
    var box = document.createElement('span')
    box.className = 'bot persona'
    box.style.width = box.style.height = size + 'px'
    if (frames.background) box.style.background = frames.background
    ;[frames.rest, frames.mouths[0], frames.mouths[frames.mouths.length - 1]].forEach(function (src, i) {
      var img = document.createElement('img')
      img.className = 'm m' + i
      img.src = src
      img.alt = ''
      box.append(img)
    })
    for (var i = 0; i < 8; i++) {
      var tick = document.createElement('i')
      tick.className = 'tick'
      tick.style.animationDelay = (i * 0.12).toFixed(2) + 's'
      box.append(tick)
    }
    var wait = document.createElement('i')
    wait.className = 'wait'
    box.append(wait)
    box.title = frames.title
    box.setAttribute('role', 'img')
    box.setAttribute('aria-label', agent.label || agent.name)
    return box
  }

  var blinks = 0

  function bot(agent, size) {
    var face = portrait(agent, size)
    if (face) return face
    defs()
    var r = role(agent)
    var html = '<rect width="100" height="100" fill="' + r.bg + '"/><rect width="100" height="100" fill="url(#lia-bot-grid)"/>'
    if (r.glyph) {
      var a = [], b = []
      r.glyph.forEach(function (row, y) {
        for (var x = 0; x < 12; x++) {
          if (row[x] == 'a') a.push(y * 12 + x)
          if (row[x] == 'b') b.push(y * 12 + x)
        }
      })
      if (a.length) html += path(a, r.accent)
      if (b.length) html += path(b, r.extra || r.accent, r.spark ? ' class="spark ' + r.spark + '"' : '')
    }
    // a different moment for every robot, so that they do not blink together
    html += path(EYES[r.eyes], r.face, ' class="eyes" style="animation-delay:-' + ((blinks++ * 1.7) % 5).toFixed(1) + 's"')
    MOUTH.forEach(function (cells, i) {
      html += path(cells, r.face, ' class="m m' + i + '"')
    })
    for (var i = 0; i < 8; i++) {
      html += path([134 + i], r.face, ' class="tick" style="animation-delay:' + (i * 0.12).toFixed(2) + 's"')
    }
    html += path([137, 138], r.face, ' class="wait"')

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'bot')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('width', size)
    svg.setAttribute('height', size)
    svg.innerHTML = html
    var title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = agent ? agent.label || agent.name : ''
    if (title.textContent) svg.prepend(title)
    else svg.setAttribute('aria-hidden', 'true')
    return svg
  }

  // ------------------------------------------------------------ the mouth

  var timers = []

  function mouth(bots, frame) {
    bots.forEach(function (svg) {
      svg.setAttribute('data-mouth', frame)
    })
  }

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms))
  }

  // one word: open, half and closed again for every syllable (vowel group)
  function word(bots, text, ms) {
    var syllables = Math.max(1, (text.toLowerCase().match(/[aeiouyäöüàáâéèêíìîóòôúùû]+/g) || []).length)
    var step = ms / syllables
    for (var i = 0; i < syllables; i++) {
      later(mouth.bind(null, bots, 2), i * step)
      later(mouth.bind(null, bots, 1), i * step + step * 0.45)
      later(mouth.bind(null, bots, 0), i * step + step * 0.8)
    }
  }

  function wordTime(text) {
    return Math.max(150, text.length * 62)
  }

  // a voice that tells where it is: the mouth follows its words
  function talk(bots, text) {
    timers.forEach(clearTimeout)
    timers = []
    word(bots, text, wordTime(text))
  }

  // a voice that does not: a beat estimated from the text, until quiet()
  function babble(bots, text) {
    timers.forEach(clearTimeout)
    timers = []
    var t = 0
    text.split(/\s+/).forEach(function (w) {
      if (!w) return
      later(word.bind(null, bots, w, wordTime(w)), t)
      t += wordTime(w) + (/[.,;:!?]$/.test(w) ? 260 : 70)
    })
  }

  function quiet(bots) {
    timers.forEach(clearTimeout)
    timers = []
    mouth(bots, 0)
  }

  return { role: role, voice: voice, bot: bot, talk: talk, babble: babble, quiet: quiet }
})()
