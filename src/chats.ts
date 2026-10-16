// Chat sessions of the agent bridge: one JSON file per session in .chats/ of
// the project the server runs in, so that they can be committed and continued
// by others. One entry per line, so a new message is a small diff, and unique
// names (UTC time plus random), so that nobody's session overwrites another's.

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

// ai: {markdown, ask?, inputs?, agent?, lang?}, user: {text},
// answer: {ask, values}
export type Entry = { t: string; type: string; [key: string]: any }
// db: what the learner did with the quizzes, surveys and tasks of a message,
// per table and entry number, in the format of @liascript/chat
export type DB = { [table: string]: { [n: string]: any } }
export type Session = { id: string; created: string; file: string; entries: Entry[]; db?: DB }
export type Summary = { id: string; title: string; updated: string; count: number }

const ID = /^[\w-]{1,64}$/

var dir = ''

export function open(folder: string) {
  dir = folder
}

// in memory only, the file comes with the first entry
export function create(file: string): Session {
  const now = new Date().toISOString()
  const id = now.slice(0, 19).replace(/:/g, '-') + '-' + crypto.randomBytes(2).toString('hex')
  return { id, created: now, file, entries: [] }
}

export function append(session: Session, entry: { type: string; [key: string]: any }) {
  session.entries.push({ t: new Date().toISOString(), ...entry })
  save(session)
}

// the blocks of one table in entry n, replaced as a whole like the chat does
export function store(session: Session, table: string, n: number, data: any[]) {
  const db = session.db || (session.db = {})
  const rows = db[table] || (db[table] = {})
  rows[n] = data
  save(session)
}

function save(session: Session) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, session.id + '.json'), serialize(session))
}

function serialize(session: Session) {
  const head = JSON.stringify({ id: session.id, created: session.created, file: session.file })
  const lines = session.entries.map((entry) => JSON.stringify(entry))
  const db = session.db ? ',\n"db":' + JSON.stringify(session.db) : ''
  return head.slice(0, -1) + ',"entries":[\n' + lines.join(',\n') + '\n]' + db + '}\n'
}

export function load(id: string): Session | undefined {
  // the id becomes a path
  if (typeof id !== 'string' || !ID.test(id)) return undefined
  try {
    const session = JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'))
    if (session.id === id && Array.isArray(session.entries)) return session
  } catch (e) {}
  return undefined
}

// newest first
export function list(): Summary[] {
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch (e) {}

  const all: Summary[] = []
  names.forEach((name) => {
    const session = /\.json$/.test(name) && load(name.slice(0, -5))
    if (session) all.push(summary(session))
  })
  return all.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0))
}

export function latest(): Session | undefined {
  const all = list()
  return all.length ? load(all[0].id) : undefined
}

export function summary(session: Session): Summary {
  const last = session.entries[session.entries.length - 1]
  return {
    id: session.id,
    title: title(session),
    updated: last ? last.t : session.created,
    count: session.entries.length,
  }
}

// the first question of the user, else the first line of the AI, else the date
export function title(session: Session) {
  const user = session.entries.find((e) => e.type === 'user')
  const ai = session.entries.find((e) => e.type === 'ai')
  let text = user ? String(user.text) : ''
  if (!text && ai) {
    // without the header comment (language: of the course, import:)
    text = String(ai.markdown)
      .replace(/^\s*<!--[^]*?-->/, '')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.replace(/[#*_`>]/g, ''))[0] || ''
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return session.created.slice(0, 16).replace('T', ' ')
  return text.length > 60 ? text.slice(0, 59) + '…' : text
}
