// What the learner does, read the same way in the course (agent.js) and in the
// chat (chat.js): agent: links, and the quizzes, surveys and tasks as
// LiaScript stores them. Their formats are LiaScript's: Quiz/Json.elm,
// Survey/Json.elm, Task/Json.elm, Code/Json.elm and Code/Log.elm.

var Activity = (function () {
  var seen = {}
  var tasks = {}

  // [text](agent:tutor/explain?level=easy) as a command. agent://tutor/explain
  // means the same, the slashes are dropped: new URL() would take tutor as the
  // host otherwise. undefined if it is no URL.
  function link(raw) {
    var uri
    try {
      uri = new URL('agent:' + raw.slice(6).replace(/^[/]+/, ''))
    } catch (e) {
      return
    }
    var slash = uri.pathname.indexOf('/')
    var params = {}
    uri.searchParams.forEach(function (value, key) {
      params[key] = value
    })
    return {
      type: 'command',
      agent: slash < 0 ? '' : uri.pathname.slice(0, slash),
      cmd: uri.pathname.slice(slash + 1),
      params: params,
    }
  }

  // send(kind, block, params) for what is news. quiet: only remember, for the
  // states of the history
  function store(table, id, data, send, quiet) {
    data.forEach(function (block, i) {
      var key = table + id + ':' + i
      if (table == 'quiz') {
        var old = seen[key] || { trial: 0, solved: 0, hint: 0 }
        seen[key] = block
        if (quiet) return
        if (block.trial == old.trial && block.solved == old.solved && block.hint == old.hint) return
        // a hit at the first try needs no help
        if (block.solved == 1 && block.trial == 1) return
        send('quiz', i, {
          trial: String(block.trial),
          hints: String(block.hint),
          solved: block.solved == 1 ? 'solved' : block.solved == -1 ? 'resolved' : 'wrong',
          input: JSON.stringify(block.state),
          error: block.error_msg || '',
        })
      } else if (table == 'survey') {
        var before = seen[key]
        seen[key] = block.submitted
        if (block.submitted && !before && !quiet) send('survey', i, { input: JSON.stringify(block.state) })
      } else if (table == 'task') {
        // every tick is stored: one event with the final state per block
        // ponytail: debounce fixed at 2s, make it a param if authors need it
        var now = block.join(',')
        if (seen[key] == now) return
        seen[key] = now
        if (quiet) return
        clearTimeout(tasks[key])
        tasks[key] = setTimeout(function () {
          send('task', i, { checked: now })
        }, 2000)
      }
    })
  }

  // the warnings and errors of a code run, level 1 is warn, 2 error
  function errors(messages) {
    return (messages || [])
      .filter(function (m) {
        return m.level == 1 || m.level == 2
      })
      .map(function (m) {
        return m.text
      })
      .join('\n')
  }

  // the files of a code block as one text
  function code(files) {
    return (files || [])
      .map(function (f) {
        return (f.name.trim() ? '// ' + f.name + '\n' : '') + f.code
      })
      .join('\n\n')
  }

  // a new chat: what was seen belongs to the old one
  function reset() {
    seen = {}
  }

  return { link: link, store: store, errors: errors, code: code, reset: reset }
})()
