// Sections of a Markdown file, cut the way LiaScript cuts it into slides:
// every ATX heading at the start of a line, outside code fences and HTML
// comments (the macro header of a course), starts one. Lets an agent read and
// rewrite one section of a long journal.md instead of the whole file.

import * as crypto from 'crypto'

type Heading = { line: number; level: number; title: string; parent: number }
type Doc = { lines: string[]; eol: string; list: Heading[] }
export type Address = { section?: string; slide?: number; line?: number }

export function parse(content: string): Doc {
  const lines = content.split(/\r?\n/)
  const list: Heading[] = []
  const stack: number[] = []
  let fence = ''
  let comment = false

  lines.forEach((text, i) => {
    if (fence) {
      const close = text.match(/^\s{0,3}(`{3,}|~{3,})\s*$/)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = ''
      return
    }
    if (!comment) {
      const open = text.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (open) {
        fence = open[1]
        return
      }

      const h = text.match(/^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/)
      if (h) {
        const level = h[1].length
        while (stack.length && list[stack[stack.length - 1]].level >= level) stack.pop()
        const parent = stack.length ? stack[stack.length - 1] : -1
        stack.push(list.length)
        list.push({ line: i, level, title: h[2], parent })
      }
    }
    if (text.includes('<!--') || text.includes('-->')) {
      comment = text.lastIndexOf('<!--') > text.lastIndexOf('-->')
    }
  })

  return { lines, eol: content.includes('\r\n') ? '\r\n' : '\n', list }
}

function end(doc: Doc, k: number, deep: boolean) {
  const { list } = doc
  for (let j = k + 1; j < list.length; j++) {
    if (!deep || list[j].level <= list[k].level) return list[j].line
  }
  return doc.lines.length
}

function path(doc: Doc, k: number): string[] {
  const titles = []
  for (; k >= 0; k = doc.list[k].parent) titles.unshift(doc.list[k].title)
  return titles
}

// "3" matches "3. First words", "Agents" matches "agents"
function matches(title: string, part: string) {
  title = title.toLowerCase()
  return title.startsWith(part) && !/[\p{L}\p{N}]/u.test(title[part.length] || '')
}

// the index of the heading the address points to
export function find(doc: Doc, at: Address): number {
  const { list } = doc

  if (at.slide !== undefined) {
    if (!list[at.slide - 1]) throw new Error('slide ' + at.slide + ' does not exist, the file has ' + list.length)
    return at.slide - 1
  }

  if (at.line !== undefined) {
    for (let k = list.length - 1; k >= 0; k--) if (list[k].line < at.line) return k
    throw new Error('line ' + at.line + ' is in the header before the first heading')
  }

  // the notation of the specs: "## Agents → ### Teaching-Agent", a part with
  // #s matches only a heading of that level
  const parts = (at.section || '')
    .split('→')
    .map((part) => {
      const m = part.replace(/`/g, '').trim().match(/^(#*)\s*(.*)$/) as RegExpMatchArray
      return { level: m[1].length, text: m[2].toLowerCase() }
    })
    .filter((part) => part.text)
  if (!parts.length) throw new Error('section is empty')
  const fits = (h: Heading, part: { level: number; text: string }) =>
    (!part.level || h.level === part.level) && matches(h.title, part.text)
  const last = parts[parts.length - 1]

  let found = list
    .map((_, k) => k)
    .filter((k) => {
      if (!fits(list[k], last)) return false
      let i = parts.length - 2
      for (let a = list[k].parent; a >= 0 && i >= 0; a = list[a].parent) {
        if (fits(list[a], parts[i])) i--
      }
      return i < 0
    })
  if (found.length > 1) {
    const exact = found.filter((k) => list[k].title.toLowerCase() === last.text)
    if (exact.length === 1) found = exact
  }
  if (found.length === 1) return found[0]

  throw new Error(
    found.length
      ? 'section is ambiguous, pass more of its path or its line:\n' +
          found.map((k) => 'L' + (list[k].line + 1) + ' ' + path(doc, k).join(' → ')).join('\n')
      : 'no section ' + at.section + ', see outline',
  )
}

export function outline(doc: Doc, k: number | undefined, depth: number) {
  const { list } = doc
  const base = k === undefined ? Math.min(...list.map((h) => h.level)) : list[k].level
  const from = k === undefined ? 0 : k
  const to = k === undefined ? list.length : list.findIndex((h, j) => j > k && h.level <= list[k].level)

  const rows = []
  for (let j = from; j < (to < 0 ? list.length : to); j++) {
    const h = list[j]
    if (h.level >= base + depth) continue
    const size = end(doc, j, true) - h.line
    rows.push(j + 1 + '\tL' + (h.line + 1) + '\t' + '#'.repeat(h.level) + ' ' + h.title + ' (' + size + ')')
  }
  return (
    doc.lines.length + ' lines, ' + list.length + ' slides. slide, line, heading, (lines with subsections):\n' + rows.join('\n')
  )
}

export function read(doc: Doc, k: number, deep: boolean) {
  const start = doc.list[k].line
  const text = doc.lines.slice(start, end(doc, k, deep)).join('\n')
  return { slide: k + 1, line: start + 1, path: path(doc, k).join(' → '), hash: hash(text), text }
}

function hash(text: string) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 8)
}

// returns the new file content and the section as read_section sees it now
export function write(
  content: string,
  at: Address,
  change: { text: string; hash?: string; deep?: boolean; append?: boolean },
) {
  const doc = parse(content)
  const k = find(doc, at)
  const deep = !!(change.deep || change.append)
  const start = doc.list[k].line
  let stop = end(doc, k, deep)
  const lines = change.text.split(/\r?\n/)

  if (change.append) {
    // after the last line of text, the blank lines before the next heading stay
    while (stop > start + 1 && !doc.lines[stop - 1].trim()) stop--
    doc.lines.splice(stop, 0, '', ...lines)
  } else {
    if (change.hash !== read(doc, k, deep).hash) {
      throw new Error('the section changed since it was read or hash is missing: read it again, nothing was written')
    }
    // keep a heading that follows apart from the new text
    if (stop < doc.lines.length && lines[lines.length - 1].trim()) lines.push('')
    doc.lines.splice(start, stop - start, ...lines)
  }

  const now = parse(doc.lines.join(doc.eol))
  let n = now.list.length - 1
  while (n >= 0 && now.list[n].line > start) n--
  const { text, ...section } = n < 0 ? { text: '' } : read(now, n, deep)
  return { content: doc.lines.join(doc.eol), section }
}

// A key of the macro header of a course: the HTML comment before the first
// heading, e.g. teacher: socrates. undefined without header or key.
// all words of a line of the header, e.g. teachers: curie, einstein lovelace
export function headerList(content: string, key: string): string[] | undefined {
  const first = header(content, key)
  if (first === undefined) return undefined
  const start = content.indexOf('<!--')
  const comment = content.slice(start + 4, content.indexOf('-->', start) < 0 ? undefined : content.indexOf('-->', start))
  const match = comment.match(new RegExp('^[ \\t]*' + key + '[ \\t]*:[ \\t]*(.*)$', 'm'))
  return match ? match[1].split(/[\s,]+/).filter(Boolean) : []
}

export function header(content: string, key: string): string | undefined {
  const start = content.indexOf('<!--')
  const first = content.search(/^#{1,6}[ \t]/m)
  if (start < 0 || (first >= 0 && first < start)) return undefined
  const end = content.indexOf('-->', start)
  const comment = content.slice(start + 4, end < 0 ? undefined : end)
  const match = comment.match(new RegExp('^[ \\t]*' + key + '[ \\t]*:[ \\t]*(\\S+)', 'm'))
  return match ? match[1] : undefined
}
