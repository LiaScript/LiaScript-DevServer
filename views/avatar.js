// The faces of the agents in the chat, inline SVG, so that mouth and state
// switch with an attribute (data-mouth, data-state) while one reads aloud.
//
// The four roles of the Teaching-Agent are figures with a round head, told
// apart by what they wear and by their lightness (also in grey): teaching a
// mortarboard (teal), artist a beret and a brush (lilac), development horn-
// rimmed glasses and headphones (slate, green terminal eyes), learner a
// sprout (lime). Shaded like a sphere, and they turn: pose() moves eyes, mouth
// and what they wear around the head, at most 35 degrees to either side. Only
// a figure of 40 px or more (the stage) moves, see animate().
//
// Every other agent is a pixel robot: a matrix of 12 x 12 LEDs. Eyes and mouth
// are those of the DiceBear style "Pixelbot" (CC0 1.0, dicebear.com), taken
// over as cell numbers (row * 12 + column), so no library is needed. A role
// adds its LED colour, a symbol in the three rows above the eyes in its accent
// colour, its own eyes and a tinted case; the bottom row shows what the agent
// does (thinking, waiting).

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
    teaching: { figure: 'teaching', voice: ['female', 1, 0.95] },
    artist: { figure: 'artist', voice: ['female', 1.25, 1.05] },
    learner: { figure: 'learner', voice: ['', 1.5, 1.15] },
    development: { figure: 'development', voice: ['male', 0.8, 1.06] },
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
  // the running light and the pulse; below 40 px (button, row, footer) the
  // resting face alone, only the stage speaks and works. null if the person
  // is unknown here or teachers.js is broken or missing: then the robot.
  function portrait(agent, size) {
    var frames = null
    try {
      frames = agent && agent.persona && window.Teachers ? window.Teachers.frames(agent.persona) : null
    } catch (e) {}
    if (!frames) return null
    var box = document.createElement('span')
    box.className = 'bot persona'
    box.style.width = box.style.height = size + 'px'
    if (frames.background) box.style.background = frames.background
    var small = size < 40
    var shots = small ? [frames.rest] : [frames.rest, frames.mouths[0], frames.mouths[frames.mouths.length - 1]]
    shots.forEach(function (src, i) {
      var img = document.createElement('img')
      img.className = 'm m' + i
      img.src = src
      img.alt = ''
      box.append(img)
    })
    for (var i = 0; i < (small ? 0 : 8); i++) {
      var tick = document.createElement('i')
      tick.className = 'tick'
      tick.style.animationDelay = (i * 0.12).toFixed(2) + 's'
      box.append(tick)
    }
    if (!small) {
      var wait = document.createElement('i')
      wait.className = 'wait'
      box.append(wait)
    }
    box.title = frames.title
    box.setAttribute('role', 'img')
    box.setAttribute('aria-label', agent.label || agent.name)
    return box
  }

  var blinks = 0

  // ------------------------------------------------------------ figures

  function f(n) {
    return Math.round(n * 100) / 100
  }

  // a feature at (fx, fy) on a sphere around (cx, cy) with radius r, the head
  // turned by phi: it moves along the surface and gets narrower at the edge
  function sph(cx, cy, r, fx, fy, phi) {
    var re = Math.sqrt(Math.max(r * r - (fy - cy) * (fy - cy), 1))
    var a = Math.asin(Math.max(-1, Math.min(1, (fx - cx) / re)))
    var k = Math.max(0.05, Math.cos(a + phi) / Math.cos(a))
    return 'translate(' + f(cx + re * Math.sin(a + phi)) + ' ' + fy + ') scale(' + f(k) + ' 1) translate(' + -fx + ' ' + -fy + ')'
  }

  function shadow(rx) {
    return '<ellipse cx="32" cy="62" rx="' + rx + '" ry="1.8" fill="#000" opacity=".14"/>'
  }

  function ball(id, light, mid, dark) {
    return '<radialGradient id="' + id + '" cx=".4" cy=".34" r=".8" fx=".33" fy=".26"><stop offset="0" stop-color="' + light +
      '"/><stop offset=".5" stop-color="' + mid + '"/><stop offset="1" stop-color="' + dark + '"/></radialGradient>'
  }

  // closed (a smile), half and open, shown by data-mouth like the robots'
  function mouths(smile, cx, cy, color, stroke) {
    return '<path class="m m0" d="' + smile + '" fill="none" stroke="' + color + '" stroke-width="' + (stroke || 2.6) + '" stroke-linecap="round"/>' +
      '<ellipse class="m m1" cx="' + cx + '" cy="' + cy + '" rx="3.4" ry="2.2" fill="' + color + '"/>' +
      '<ellipse class="m m2" cx="' + cx + '" cy="' + cy + '" rx="4" ry="3.8" fill="' + color + '"/>'
  }

  // thinking: three dots run in a pill, waiting: a question mark pulses
  var BADGES =
    '<g class="think"><rect x="37" y="51" width="26" height="12" rx="6" fill="#121a1b" stroke="#fff" stroke-width="1.5"/>' +
    '<circle class="tick" cx="44" cy="57" r="2.1" fill="#fff"/>' +
    '<circle class="tick" cx="50" cy="57" r="2.1" fill="#fff" style="animation-delay:.32s"/>' +
    '<circle class="tick" cx="56" cy="57" r="2.1" fill="#fff" style="animation-delay:.64s"/></g>' +
    '<g class="wait"><circle cx="54" cy="54" r="8.5" fill="#121a1b" stroke="#fff" stroke-width="1.5"/>' +
    '<path d="M51.3 51.8Q51.3 48.8 54 48.8Q56.7 48.8 56.7 51.3Q56.7 53.2 54 54.3V55.7" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="54" cy="58.8" r="1.2" fill="#fff"/></g>'

  // the parts that move carry data-p, pose() sets their attributes
  var FIGURES = {
    teaching: function (id) {
      var eye = function (x) {
        return '<g data-p="' + (x < 32 ? 'el' : 'er') + '"><g class="eyes"><circle cx="' + x + '" cy="37" r="5.2" fill="url(#' + id + 'e)"/>' +
          '<circle cx="' + x + '" cy="37.5" r="2.5" fill="#121a1b"/><circle cx="' + (x + 0.9) + '" cy="36.5" r=".8" fill="#fff"/></g></g>'
      }
      return '<defs>' + ball(id + 'b', '#86d6d9', '#0b7a80', '#05454a') +
        '<radialGradient id="' + id + 'e" cx=".42" cy=".38" r=".7"><stop offset=".45" stop-color="#fff"/><stop offset="1" stop-color="#c9d8d8"/></radialGradient>' +
        '<linearGradient id="' + id + 'k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#46595c"/><stop offset="1" stop-color="#172123"/></linearGradient></defs>' +
        shadow(14) +
        '<circle cx="32" cy="39" r="21" fill="url(#' + id + 'b)"/>' + eye(24.5) + eye(39.5) +
        '<g data-p="m">' + mouths('M27 47Q32 51.5 37 47', 32, 48.5, '#fff') + '</g>' +
        '<path d="M19 15V24Q32 29.5 45 24V15Z" fill="url(#' + id + 'k)"/>' +
        '<polygon data-p="board" fill="#2b3a3c" stroke="#4d6164" stroke-width="1.2" stroke-linejoin="round"/>' +
        '<path data-p="tassel" fill="none" stroke="#e0e455" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<circle cx="32" cy="13" r="1.9" fill="#e0e455"/><circle data-p="knob" r="2.8" fill="#e0e455"/>'
    },
    artist: function (id) {
      var eye = function (x, key) {
        return '<g data-p="' + key + '"><path class="eyes" d="M' + (x - 4) + ' 41Q' + x + ' 35.5 ' + (x + 4) + ' 41" fill="none" stroke="#24183f" stroke-width="2.6" stroke-linecap="round"/></g>'
      }
      return '<defs>' + ball(id + 'b', '#e2d8fa', '#a68be6', '#6346b8') +
        '<linearGradient id="' + id + 'k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#57438f"/><stop offset="1" stop-color="#2c1f52"/></linearGradient></defs>' +
        shadow(15) +
        '<g data-p="brush"><path d="M43 42L58 11" fill="none" stroke="#c98a4b" stroke-width="3.4" stroke-linecap="round"/>' +
        '<path d="M56.6 14L58.4 10.2" fill="none" stroke="#a9b4b5" stroke-width="4"/>' +
        '<ellipse cx="59.6" cy="6.6" rx="2.4" ry="4" transform="rotate(26 59.6 6.6)" fill="#0b7a80"/></g>' +
        '<path d="M32 20C47 20 53 26 53 40C53 54 47 60 32 60C17 60 11 54 11 40C11 26 17 20 32 20Z" fill="url(#' + id + 'b)"/>' +
        eye(24.5, 'el') + eye(39.5, 'er') +
        '<g data-p="m">' + mouths('M28 49Q32 52.5 36 49', 32, 50.5, '#24183f') + '</g>' +
        '<g data-p="beret"><path d="M9.5 27C8 17.5 21 11 33 11.5C45.5 12 55.5 17.5 54 24.5C52.5 29.5 41 27.5 32 28C22 28.5 11.5 32 9.5 27Z" fill="url(#' + id + 'k)"/>' +
        '<path d="M32.5 11.8Q33.5 7 37.5 7.5" fill="none" stroke="#2c1f52" stroke-width="2.6" stroke-linecap="round"/>' +
        '<circle cx="21" cy="19.5" r="2" fill="#e0e455"/><circle cx="44.5" cy="18.5" r="1.6" fill="#0b7a80"/></g>'
    },
    development: function (id) {
      var cup = function (key, front) {
        return '<rect data-p="' + key + '" y="31" width="8" height="15" rx="4" fill="' + (front ? '#2a7a3e" stroke="#1b2426" stroke-width="1.4' : '#1f5c2f') + '"/>'
      }
      var lens = function (x, key) {
        return '<g data-p="' + key + '"><rect x="' + (x - 6.5) + '" y="29.5" width="13" height="11" rx="3.6" fill="url(#' + id + 'l)" stroke="url(#' + id + 'h)" stroke-width="2.8"/>' +
          '<path d="M' + (x - 6.9) + ' 30.6Q' + x + ' 27.6 ' + (x + 6.9) + ' 30.6" fill="none" stroke="#2b1a0e" stroke-width="2.2" stroke-linecap="round"/>' +
          '<rect class="eyes" x="' + (x - 2.3) + '" y="31.9" width="4.6" height="6.2" rx="1.3" fill="#6fcf86"/>' +
          '<path d="M' + (x - 4.1) + ' 32H' + (x - 1.5) + '" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".25"/></g>'
      }
      var green = function (cls, y, w, h) {
        return '<rect class="m ' + cls + '" x="' + (32 - w / 2) + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + Math.min(2, h / 2) + '" fill="#6fcf86"/>'
      }
      return '<defs>' + ball(id + 'b', '#7d9396', '#2f3d3f', '#161e20') +
        '<radialGradient id="' + id + 'l" cx=".45" cy=".4" r=".75"><stop offset="0" stop-color="#173a2f"/><stop offset="1" stop-color="#08120f"/></radialGradient>' +
        '<linearGradient id="' + id + 'h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a4f2c"/><stop offset=".5" stop-color="#4a2f1b"/><stop offset="1" stop-color="#2b1a0e"/></linearGradient></defs>' +
        shadow(15) + cup('cupLb') + cup('cupRb') +
        '<circle cx="32" cy="39" r="21" fill="url(#' + id + 'b)" stroke="#56686a" stroke-width="1.5"/>' +
        '<g data-p="tl"><path d="M18 33.5L11.6 35" stroke="#2b1a0e" stroke-width="2.2" stroke-linecap="round"/></g>' +
        '<g data-p="tr"><path d="M46 33.5L52.4 35" stroke="#2b1a0e" stroke-width="2.2" stroke-linecap="round"/></g>' +
        lens(24.5, 'gl') + lens(39.5, 'gr') +
        '<g data-p="gb"><path d="M30.4 33.6Q32 32.2 33.6 33.6" fill="none" stroke="#4a2f1b" stroke-width="2.4" stroke-linecap="round"/></g>' +
        '<g data-p="m">' + green('m0', 45, 10, 2.6) + green('m1', 43.8, 8, 4) + green('m2', 42.8, 8, 6) + '</g>' +
        '<path data-p="band" fill="none" stroke="#1b2426" stroke-width="3.6" stroke-linecap="round"/>' +
        '<path data-p="band" fill="none" stroke="#3f9a52" stroke-width="1.2" stroke-linecap="round"/>' +
        cup('cupLf', true) + cup('cupRf', true)
    },
    learner: function (id) {
      var eye = function (x) {
        return '<g data-p="' + (x < 32 ? 'el' : 'er') + '"><g class="eyes"><circle cx="' + x + '" cy="40" r="6.2" fill="url(#' + id + 'e)" stroke="#5f6b00" stroke-width="1.2"/>' +
          '<circle cx="' + x + '" cy="40.8" r="3.1" fill="#121a1b"/><circle cx="' + (x + 1.1) + '" cy="39.6" r=".9" fill="#fff"/></g></g>'
      }
      return '<defs>' + ball(id + 'b', '#f7fac4', '#d4dc4a', '#97a014') +
        '<radialGradient id="' + id + 'e" cx=".42" cy=".38" r=".7"><stop offset=".45" stop-color="#fff"/><stop offset="1" stop-color="#d6dccb"/></radialGradient></defs>' +
        shadow(13) +
        '<g data-p="sprout"><path d="M32 23C32 18 31.5 15 32 11" fill="none" stroke="#3f9a52" stroke-width="2.6" stroke-linecap="round"/>' +
        '<path d="M31.5 15C25 15.5 20 12 19 6C25.5 5.5 30.5 9 31.5 15Z" fill="#3f9a52"/>' +
        '<path d="M32 12C37.5 11 42.5 7.5 44 2.5C38 2.5 33 6 32 12Z" fill="#5bb86d"/></g>' +
        '<circle cx="32" cy="41" r="19" fill="url(#' + id + 'b)" stroke="#5f6b00" stroke-width="2"/>' + eye(24.5) + eye(39.5) +
        '<g data-p="m">' + mouths('M28.5 51Q32 54 35.5 51', 32, 52, '#121a1b', 2.4) + '</g>'
    },
  }

  // turn: -1 looks to the left, 1 to the right
  var POSES = {
    teaching: function (phi) {
      var corner = function (deg, rx, ry) {
        var a = (deg * Math.PI) / 180 - phi
        return [f(32 + rx * Math.cos(a)), f(13 + ry * Math.sin(a))]
      }
      var t = corner(0, 21, 7.2)
      return {
        el: sph(32, 39, 21, 24.5, 37, phi),
        er: sph(32, 39, 21, 39.5, 37, phi),
        m: sph(32, 39, 21, 32, 48, phi),
        board: { points: [0, 90, 180, 270].map(function (d) { return corner(d, 26, 9).join(',') }).join(' ') },
        tassel: { d: 'M32 13L' + t[0] + ' ' + t[1] + 'L' + t[0] + ' ' + f(t[1] + 11) },
        knob: { cx: t[0], cy: f(t[1] + 13) },
      }
    },
    artist: function (phi, turn) {
      return {
        el: sph(32, 40, 21, 24.5, 39, phi),
        er: sph(32, 40, 21, 39.5, 39, phi),
        m: sph(32, 40, 21, 32, 50, phi),
        beret: 'translate(' + f(turn * 2.5) + ' 0)',
        brush: 'translate(' + f(-turn * 4) + ' 0)',
      }
    },
    // the cup that turns away goes behind the head
    development: function (phi) {
      var c = Math.cos(phi)
      var l = f(32 - 21.5 * c), r = f(32 + 21.5 * c)
      return {
        gl: sph(32, 39, 21, 24.5, 35, phi),
        gr: sph(32, 39, 21, 39.5, 35, phi),
        gb: sph(32, 39, 21, 32, 33.5, phi),
        tl: sph(32, 39, 21, 15, 34, phi),
        tr: sph(32, 39, 21, 49, 34, phi),
        m: sph(32, 39, 21, 32, 45.8, phi),
        cupLf: { x: f(l - 4), opacity: phi >= 0 ? 1 : 0 },
        cupLb: { x: f(l - 4), opacity: phi >= 0 ? 0 : 1 },
        cupRf: { x: f(r - 4), opacity: phi <= 0 ? 1 : 0 },
        cupRb: { x: f(r - 4), opacity: phi <= 0 ? 0 : 1 },
        band: { d: 'M' + l + ' 33C' + l + ' 9 ' + r + ' 9 ' + r + ' 33' },
      }
    },
    learner: function (phi) {
      return {
        el: sph(32, 41, 19, 24.5, 40, phi),
        er: sph(32, 41, 19, 39.5, 40, phi),
        m: sph(32, 41, 19, 32, 52, phi),
        sprout: 'translate(32 0) scale(' + f(Math.cos(phi * 1.6)) + ' 1) translate(-32 0)',
      }
    },
  }

  function pose(svg, turn) {
    var phi = (turn * 35 * Math.PI) / 180
    var parts = POSES[svg.getAttribute('data-figure')](phi, turn)
    var all = svg.querySelectorAll('[data-p]')
    for (var i = 0; i < all.length; i++) {
      var v = parts[all[i].getAttribute('data-p')]
      if (typeof v == 'string') all[i].setAttribute('transform', v)
      else if (v) for (var k in v) all[i].setAttribute(k, v[k])
    }
  }

  // the stage turns its figure: slowly around while idle, towards the upper
  // right while thinking, a sway while reading aloud (talking, set by talk()
  // and babble()); one timer for all, it stops when none is left
  var moving = []
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function animate(svg) {
    if (still) return
    moving.push({ svg: svg, born: Date.now(), turn: 0, phase: Math.random() * 6 })
    if (moving.length == 1) setTimeout(step, 70)
  }

  function step() {
    var now = Date.now()
    var t = now / 1000
    moving = moving.filter(function (m) {
      return m.svg.isConnected || now - m.born < 3000
    })
    if (!moving.length) return
    if (!document.hidden) {
      moving.forEach(function (m) {
        if (!m.svg.isConnected) return
        var state = m.svg.getAttribute('data-state')
        var target = state == 'thinking' ? 0.3 + 0.08 * Math.sin(t * 1.3)
          : m.svg.talking ? 0.22 * Math.sin(t * 0.9 + m.phase)
          : state == 'waiting' ? 0.5 * Math.sin(t * 0.7 + m.phase)
          : 0.35 * Math.sin(t * 0.35 + m.phase)
        m.turn += (target - m.turn) * 0.2
        pose(m.svg, m.turn)
      })
    }
    setTimeout(step, 70)
  }

  var figures = 0

  function figure(kind, agent, size) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'bot figure')
    svg.setAttribute('data-figure', kind)
    svg.setAttribute('viewBox', '0 0 64 64')
    svg.setAttribute('width', size)
    svg.setAttribute('height', size)
    // gradient ids of their own: a page holds many figures
    svg.innerHTML = FIGURES[kind]('lia-fig' + figures++ + '-') + BADGES
    var delay = '-' + ((blinks++ * 1.7) % 5).toFixed(1) + 's'
    var eyes = svg.querySelectorAll('.eyes')
    for (var i = 0; i < eyes.length; i++) eyes[i].style.animationDelay = delay
    var title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = agent.label || agent.name
    svg.prepend(title)
    pose(svg, 0)
    if (size >= 40) animate(svg)
    return svg
  }

  function bot(agent, size) {
    var face = portrait(agent, size)
    if (face) return face
    var r = role(agent)
    if (r.figure) return figure(r.figure, agent, size)
    defs()
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

  function talking(bots, on) {
    bots.forEach(function (svg) {
      if (svg) svg.talking = on
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
    talking(bots, true)
    word(bots, text, wordTime(text))
  }

  // a voice that does not: a beat estimated from the text, until quiet()
  function babble(bots, text) {
    timers.forEach(clearTimeout)
    timers = []
    talking(bots, true)
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
    talking(bots, false)
    mouth(bots, 0)
  }

  return { role: role, voice: voice, bot: bot, talk: talk, babble: babble, quiet: quiet }
})()
