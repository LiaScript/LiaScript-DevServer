# Lehrer-Personas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Historische Persönlichkeiten aus `LiaTemplates/virtual-speaker` können im Chat als Lehrperson auftreten: mit
DiceBear-Avatar, Stimme passend zum Geschlecht und ihrem Lehrstil, vom Agenten passend zum Kurs vorgeschlagen.

**Architecture:** Der Katalog (Aussehen aus virtual-speaker plus neue Merkmale) liegt als reine Daten in
`src/teachers/`. `mcp.ts` bindet ihn für `find_teacher`, `set_agent.persona`, das Formular `teacher` und
`get_state.teacher` ein. Ein zweites Parcel-Ziel bündelt Katalog und DiceBear-Renderer zu `views/teachers.js`, das der
Chat lädt. `avatar.js` zeigt bei einer Persona deren Bilder statt des Roboters, mit demselben `data-mouth`.

**Tech Stack:** TypeScript, Parcel 2, `@dicebear/core` 9 plus sechs Stile (ESM, nur im Browser-Bundle), Express,
Vanilla-JS im Chat, `src/check.js` als End-to-End-Test.

**Spec:** `docs/superpowers/specs/2026-10-13-teacher-personas-design.md`

## Global Constraints

- Die Roboter bleiben. Personas gibt es nur, wenn `set_agent` eine `persona` setzt.
- Kopie aus `../LiaTemplates/virtual-speaker` (Pfad relativ zum Repo-Root: `/home/andre/Workspace/Projects/Freinet/LiaTemplates/virtual-speaker`), kein npm-Paket daraus.
- `@dicebear/*` sind ESM-only: nie aus `src/lib.ts`, `src/index.ts` oder `src/mcp.ts` importieren, nur aus `src/teachers/render.ts` (Browser-Bundle).
- Alle 196 Personen. `region` ∈ `europe | asia | africa | north-america | south-america | oceania | polar`, `gender` ∈ `female | male`.
- `teaching`: englisch, Imperativ, 1 bis 2 Sätze, höchstens 240 Zeichen, keine Anführungszeichen, keine Zitate.
- `fields`: 1 bis 5 englische Kleinwörter, Bindestrich statt Leerzeichen (`computer-science`).
- Claude Code schneidet Instruktionen und jede Tool-Beschreibung bei 2048 Zeichen ab, `src/check.js` prüft das.
- `agentScript`/`gotoScript` werden nicht angefasst.
- `src/check.js` ruft `chat` oder `goto` nie ohne verbundenen Fake-SSE-Client auf.
- Code-Stil wie im Umfeld: kein Semikolon, einfache Anführungszeichen, 2 Leerzeichen, knappe englische Kommentare.
- Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nur die Dateien der Aufgabe stagen, das Arbeitsverzeichnis enthält fremde offene Änderungen.

## Review Focus

- Ein Roster-Eintrag mit `persona`, die der Browser nicht kennt (älteres `teachers.js` im Cache, kaputter Build): `Avatar.bot` fällt auf den Roboter zurück, nichts wirft. Test in Task 5 (manuell, Schritt „ohne teachers.js“).
- `set_agent` mit `agents: [...]` ohne `persona` für einen Agenten, der eine hatte: die Liste ersetzt das Roster, auch die Persona ist dann weg. Test in Task 3.
- Kurskopf mit `teacher:` in einem Kommentar *nach* der ersten Überschrift: wird nicht als Lehrperson gelesen. Test in Task 4.
- Eine gespeicherte Chat-Datei aus einer Zeit vor den Personas (`agent` ohne `persona`) lädt und zeigt Roboter wie bisher. Test in Task 3 (`read_chat` ohne `persona`-Feld).
- `find_teacher({topic: 'PHYSICS'})`: Groß-/Kleinschreibung egal. Test in Task 3.

---

## File Structure

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `src/teachers/looks.ts` | neu | wörtliche Kopie von `famous.ts`: Aussehen pro id |
| `src/teachers/traits.ts` | neu | Merkmale pro id (Geschlecht, Region, Lebensdaten, Fächer, Lehrstil) |
| `src/teachers/catalog.ts` | neu | `TEACHERS`, `find()`, `line()`, Typen, ohne DiceBear |
| `src/teachers/render.ts` | neu | DiceBear-Bilder (Ruhe + offene Münder) einer Person |
| `src/teachers/teachers.ts` | neu | Browser-Einstieg, setzt `window.Teachers` |
| `package.json` | ändern | Parcel-Ziel `teachers`, `build`, devDependencies |
| `.gitignore` | ändern | `views/teachers.js` |
| `src/lib.ts` | ändern | `Agent.persona`, Route für `teachers.js` |
| `src/mcp.ts` | ändern | `find_teacher`, `set_agent.persona`, Formular `teacher`, `get_state.teacher`, `read_chat.persona` |
| `src/sections.ts` | ändern | `header(content, key)` |
| `src/check.js` | ändern | Tests |
| `views/chat.html` | ändern | `<script src="teachers.js">` |
| `views/avatar.js` | ändern | Persona-Bild statt Roboter, Stimme |
| `views/chat.js` | ändern | Formular `teacher`, `BC` übersetzen |
| `views/chat.css` | ändern | `.bot.persona`, Karten |
| `CLAUDE.md`, `README.md` | ändern | Doku |

---

### Task 1: Katalog (`looks.ts`, `traits.ts`, `catalog.ts`)

**Files:**
- Create: `src/teachers/looks.ts`, `src/teachers/traits.ts`, `src/teachers/catalog.ts`

**Interfaces:**
- Produces:
  - `export type Look = { style: string; seed: string; options?: Record<string, unknown>; name?: string }` und `export const LOOKS` (in `looks.ts`)
  - `export type Gender = 'female' | 'male'`, `export type Region = 'europe' | 'asia' | 'africa' | 'north-america' | 'south-america' | 'oceania' | 'polar'`, `export type Traits = { gender: Gender; region: Region; lived: [number, number]; fields: string[]; teaching: string }`, `export const TRAITS: Record<keyof typeof LOOKS, Traits>` (in `traits.ts`)
  - in `catalog.ts`: `export type Teacher = Look & Traits & { id: string; name: string }`, `export const TEACHERS: Record<string, Teacher>`, `export const GENDERS: Gender[]`, `export const REGIONS: Region[]`, `export type Filter = { topic?: string; gender?: string; region?: string }`, `export function find(filter: Filter): Teacher[]`, `export function line(t: Teacher): string`, `export function years(lived: [number, number]): string`

- [ ] **Step 1: `looks.ts` als Kopie anlegen**

```bash
mkdir -p src/teachers
cp ../LiaTemplates/virtual-speaker/src/famous.ts src/teachers/looks.ts
```

Dann am Anfang von `src/teachers/looks.ts` die Zeile `import type { SpeakerDef } from './speakers'` ersetzen durch:

```ts
// A copy of src/famous.ts of LiaTemplates/virtual-speaker, the look of every
// person as DiceBear style and options. Copy it again to take over new
// people, only this header and the last line differ. Their traits are in
// traits.ts, which tsc checks against the ids here.
export type Look = { style: string; seed: string; options?: Record<string, unknown>; name?: string }
```

Die Zeile `export const FAMOUS: Record<string, SpeakerDef> = {` ersetzen durch `export const LOOKS = {`, und die letzte
Zeile `}` der Datei durch `} satisfies Record<string, Look>`. So bleiben die ids als Literaltypen erhalten.

Prüfen: `grep -c "patterns:" src/teachers/looks.ts` muss `0` ergeben (der Renderer kennt keine Muster). Wenn nicht:
Die betroffenen Einträge mit dem Nutzer klären, nicht stillschweigend weglassen.

- [ ] **Step 2: `catalog.ts` schreiben (vor `traits.ts`, damit der Typcheck dort sofort scheitert)**

```ts
// The teacher personas: historical people the chat can show instead of a
// robot, with the look of virtual-speaker (looks.ts) and the traits an
// agent picks them by (traits.ts). Pure data, no DiceBear, so that mcp.ts
// can import it; the images come from render.ts in the browser.

import { LOOKS, type Look } from './looks'
import { TRAITS, type Gender, type Region, type Traits } from './traits'

export type { Gender, Region, Traits }
export type Teacher = Look & Traits & { id: string; name: string }

export const GENDERS: Gender[] = ['female', 'male']
export const REGIONS: Region[] = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania', 'polar']

export const TEACHERS: Record<string, Teacher> = {}
for (const id of Object.keys(LOOKS) as (keyof typeof LOOKS)[]) {
  const look: Look = LOOKS[id]
  TEACHERS[id] = { ...look, ...TRAITS[id], id, name: look.name || id }
}

export type Filter = { topic?: string; gender?: string; region?: string }

// topic: part of a field or of the name, any case
export function find(filter: Filter): Teacher[] {
  const topic = (filter.topic || '').trim().toLowerCase()
  return Object.keys(TEACHERS)
    .map((id) => TEACHERS[id])
    .filter(
      (t) =>
        (!filter.gender || t.gender === filter.gender) &&
        (!filter.region || t.region === filter.region) &&
        (!topic || t.name.toLowerCase().includes(topic) || t.fields.some((f) => f.includes(topic))),
    )
}

// 1867–1934, 470–399 BC, 4 BC–65
export function years(lived: [number, number]): string {
  const [born, died] = lived
  const year = (y: number) => (y < 0 ? -y + ' BC' : String(y))
  return born < 0 && died < 0 ? -born + '–' + -died + ' BC' : year(born) + '–' + year(died)
}

export function line(t: Teacher): string {
  return [t.id, t.name, years(t.lived), t.region, t.gender, t.fields.join(', '), t.teaching].join(' · ')
}
```

- [ ] **Step 3: Gerüst von `traits.ts` anlegen und den Typcheck scheitern sehen**

```ts
// What an agent picks a teacher persona by, one entry per id of looks.ts
// (tsc reports a missing or an extra one). teaching is an instruction to
// the model: how this person taught or worked, never a quote.

import type { LOOKS } from './looks'

export type Gender = 'female' | 'male'
export type Region = 'europe' | 'asia' | 'africa' | 'north-america' | 'south-america' | 'oceania' | 'polar'
export type Traits = { gender: Gender; region: Region; lived: [number, number]; fields: string[]; teaching: string }

export const TRAITS: Record<keyof typeof LOOKS, Traits> = {
}
```

Run: `npx tsc --noEmit --strict --target es2020 --module commonjs --moduleResolution node src/teachers/catalog.ts`
Expected: FAIL, `Type '{}' is missing the following properties from type 'Record<...>': "albert-einstein", …`

- [ ] **Step 4: Merkmale mit sechs parallelen Hilfsagenten schreiben**

Die ids pro Region ermitteln (Abschnittskommentare `// Europe`, `// Asia`, … in `looks.ts`):

```bash
node -e "
const src=require('fs').readFileSync('src/teachers/looks.ts','utf8');let r='?';const out={};
for(const l of src.split('\n')){const c=l.match(/^\s{2}\/\/ (.+)$/);if(c){r=c[1];continue}
const k=l.match(/^\s{2}'?([a-z0-9-]+)'?: \{/);if(k)(out[r]=out[r]||[]).push(k[1])}
console.log(JSON.stringify(out,null,1))"
```

Erwartet (Stand 2026-10-13): Europe 85, Asia 34, Africa 22, North America 29, South America 12, Australia and Oceania 11,
Antarctica 3, zusammen 196. Weicht die Zahl ab, mit der tatsächlichen weiterarbeiten und sie im Commit nennen.

Sechs Agenten parallel starten (eine Nachricht, sechs Agent-Aufrufe): Europa erste Hälfte (43 ids), Europa zweite
Hälfte (42), Asien, Nordamerika, Afrika, Rest (Südamerika + Ozeanien + Antarktis). Prompt pro Agent, `<IDS>`,
`<REGION>` und `<PART>` ersetzen. `<PART>`: `europe-1`, `europe-2`, `asia`, `africa`, `north-america`, `rest`.
`<REGION>`: `'europe' for all of them` usw.; beim Rest-Agenten `'south-america' for <ids>, 'oceania' for <ids>,
'polar' for <ids>`, mit den ids der jeweiligen Region:

```
Write TypeScript object entries for the teacher personas of a LiaScript chat. For every id below, one entry:

  'marie-curie': {
    gender: 'female',
    region: 'europe',
    lived: [1867, 1934],
    fields: ['physics', 'chemistry', 'radioactivity'],
    teaching: 'Let the learner measure and record first, then explain the pattern behind the data; insist on careful, repeated observation.',
  },

Rules:
- gender: 'female' or 'male', from the historical record of that person, not guessed from the name.
- region: <REGION>
- lived: [born, died] as integers, years BC negative (Socrates: [-470, -399]). Uncertain dates: the commonly cited
  approximate year. Ötzi: [-3350, -3230].
- fields: 1 to 5 lowercase English words, hyphen instead of space ('computer-science'), what a course about the
  person's work would be about. Prefer common subject names (mathematics, physics, biology, history, music, art,
  literature, philosophy, education, politics, medicine, geography, engineering, economics, religion, law, chemistry,
  astronomy, computer-science, exploration, civil-rights, ecology, language), add one specific field if helpful.
- teaching: an instruction to an AI tutor that takes on this person's role, imperative, 1 to 2 sentences, at most 240
  characters, how to teach in the way this person taught, argued or worked (Socrates: ask questions instead of
  explaining). For people not known as teachers, derive it from their working method. No quotation marks, no quotes
  of the person, no role play of their life or suffering, nothing about their death.
- Look up what you are unsure about (WebSearch is fine). Do not invent facts.

Write only the entries, in the order of the ids, to the file
/home/andre/Workspace/Projects/Freinet/DevServer/src/teachers/.traits-<PART>.ts (no imports, no surrounding braces).
Then reply with the list of ids where you were unsure about a date or the gender, and why.

ids: <IDS>
```

- [ ] **Step 5: Teile zusammenführen**

Die sechs Dateien `src/teachers/.traits-*.ts` in der Reihenfolge der ids von `looks.ts` zwischen `{` und `}` von
`TRAITS` einfügen, dann die Teildateien löschen:

```bash
cd src/teachers && head -n -1 traits.ts > traits.new && cat .traits-europe-1.ts .traits-europe-2.ts .traits-asia.ts .traits-africa.ts .traits-north-america.ts .traits-rest.ts >> traits.new && echo '}' >> traits.new && mv traits.new traits.ts && rm .traits-*.ts && cd ../..
```

(Die Reihenfolge der Regionen in `looks.ts` ist Europe, Asia, Africa, North America, South America, Oceania,
Antarctica; der `cat` folgt ihr.) Die Unsicherheiten, die die Agenten gemeldet haben, sammeln und dem Nutzer am Ende
der Aufgabe nennen.

- [ ] **Step 6: Typcheck läuft durch**

Run: `npx tsc --noEmit --strict --target es2020 --module commonjs --moduleResolution node src/teachers/catalog.ts`
Expected: keine Ausgabe, Exit 0. Fehlende/überzählige ids oder falsche Werte für `gender`/`region` meldet tsc hier.

- [ ] **Step 7: Inhaltliche Regeln prüfen, die tsc nicht sieht**

```bash
cat > /tmp/claude-1000/-home-andre-Workspace-Projects-Freinet-DevServer/8627687b-3648-45d5-bc81-0fa3d751b08e/scratchpad/traits-check.mjs <<'EOF'
const src = (await import('node:fs')).readFileSync(process.argv[2], 'utf8')
const bad = []
for (const m of src.matchAll(/'([a-z0-9-]+)': \{\s*gender: '(\w+)',\s*region: '([\w-]+)',\s*lived: \[(-?\d+), (-?\d+)\],\s*fields: \[([^\]]*)\],\s*teaching:\s*'((?:[^'\\]|\\.)*)'/g)) {
  const [, id, , , born, died, fields, teaching] = m
  const f = fields.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
  if (+born >= +died) bad.push(id + ': lived')
  if (f.length < 1 || f.length > 5 || f.some((x) => !/^[a-z]+(-[a-z]+)*$/.test(x))) bad.push(id + ': fields')
  if (!teaching || teaching.length > 240 || /["“”„]/.test(teaching)) bad.push(id + ': teaching')
}
console.log(bad.length ? bad.join('\n') : 'ok')
EOF
node /tmp/claude-1000/-home-andre-Workspace-Projects-Freinet-DevServer/8627687b-3648-45d5-bc81-0fa3d751b08e/scratchpad/traits-check.mjs src/teachers/traits.ts
grep -c "gender: 'female'" src/teachers/traits.ts; grep -c "gender: 'male'" src/teachers/traits.ts
```

Expected: `ok`, die zwei Zahlen ergeben zusammen 196. Gemeldete Einträge von Hand korrigieren. (Die Prüfung
wiederholt sich dauerhaft in Task 2 über das Bundle.)

- [ ] **Step 8: Commit**

```bash
git add src/teachers/looks.ts src/teachers/traits.ts src/teachers/catalog.ts
git commit -m "Catalog of teacher personas: looks of virtual-speaker and their traits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Renderer und Browser-Bundle `views/teachers.js`

**Files:**
- Create: `src/teachers/render.ts`, `src/teachers/teachers.ts`
- Modify: `package.json` (scripts.build, targets, devDependencies), `.gitignore`, `src/lib.ts:852` (Route), `views/chat.html:315-317`
- Test: `src/check.js`

**Interfaces:**
- Consumes: `TEACHERS`, `Teacher`, `years` aus `src/teachers/catalog.ts`
- Produces:
  - `export type Frames = { rest: string; mouths: string[]; background: string | null; title: string }`, `export function frames(t: Teacher): Frames` (in `render.ts`)
  - `window.Teachers = { ids(): string[], get(id): Omit<Teacher, 'style' | 'seed' | 'options'> & { years: string } | undefined, frames(id): Frames | undefined }`
  - `GET /liascript/teachers.js` (nur im Agent-Modus, `Cache-Control: no-cache`)

- [ ] **Step 1: Failing test in `src/check.js`**

Oben bei den `require`s ergänzen: `const vm = require('vm')`. Direkt nach der Schleife, die die Länge der
Tool-Beschreibungen prüft (nach `assert.ok(t.description.length <= LIMIT, …)` und vor `// --- sections of a Markdown file`), einfügen:

```js
  // --- teacher personas: the bundle the chat loads, run as the browser would
  const bundle = await request('GET', '/liascript/teachers.js', {})
  assert.strictEqual(bundle.status, 200, 'the chat gets teachers.js')
  assert.strictEqual(bundle.headers['cache-control'], 'no-cache')
  const sandbox = { window: {} }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'views/teachers.js'), 'utf8'), sandbox)
  const Teachers = sandbox.window.Teachers
  const ids = Teachers.ids()
  assert.strictEqual(ids.length, 196, 'all people of virtual-speaker')
  const REGIONS = ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania', 'polar']
  for (const id of ids) {
    const t = Teachers.get(id)
    assert.ok(['female', 'male'].includes(t.gender), id + ' gender')
    assert.ok(REGIONS.includes(t.region), id + ' region')
    assert.ok(Number.isInteger(t.lived[0]) && t.lived[0] < t.lived[1], id + ' lived')
    assert.ok(t.fields.length >= 1 && t.fields.length <= 5 && t.fields.every((f) => /^[a-z]+(-[a-z]+)*$/.test(f)), id + ' fields')
    assert.ok(t.teaching && t.teaching.length <= 240 && !/["“”„]/.test(t.teaching), id + ' teaching')
    assert.strictEqual(t.options, undefined, 'get() leaves out the DiceBear options')
    const f = Teachers.frames(id)
    assert.ok(f.rest.startsWith('data:image/svg+xml'), id + ' rest')
    assert.ok(f.mouths.length >= 1 && f.mouths.every((m) => m.startsWith('data:image/svg+xml') && m !== f.rest), id + ' mouths')
    assert.ok(f.title.includes(t.name) && f.title.includes('licensed under'), id + ' title')
  }
  assert.strictEqual(Teachers.get('nobody'), undefined)
  assert.strictEqual(Teachers.frames('nobody'), undefined)
  assert.strictEqual(Teachers.get('socrates').years, '470–399 BC')
```

- [ ] **Step 2: Test scheitern sehen**

Run: `npm run build && node src/check.js`
Expected: FAIL bei `the chat gets teachers.js` (404).

- [ ] **Step 3: devDependencies installieren**

```bash
npm install --save-dev --ignore-scripts @dicebear/core@9.4.2 @dicebear/avataaars@9.4.2 @dicebear/toon-head@9.4.2 @dicebear/lorelei@9.4.2 @dicebear/micah@9.4.2 @dicebear/personas@9.4.2 @dicebear/notionists@9.4.2
```

(`--ignore-scripts` wegen `@liascript/chat`, siehe CLAUDE.md.) Danach in `package.json` prüfen, dass die Versionen als
`^9.4.2` unter `devDependencies` stehen: Das Bundle enthält sie, zur Laufzeit braucht sie niemand.

Prüfen, welche Stile `looks.ts` verwendet: `grep -o "style: '[a-z-]*'" src/teachers/looks.ts | sort -u` muss genau
avataaars, lorelei, micah, notionists, personas, toon-head ergeben. Kommt ein weiterer dazu, das Paket ergänzen und in
`STYLES`/`FACES` von Step 4 aufnehmen (die Gesichter stehen in `../LiaTemplates/virtual-speaker/src/faces.ts`).

- [ ] **Step 4: `src/teachers/render.ts`**

```ts
// The images of a teacher persona, a reduced copy of src/avatar.ts and
// src/faces.ts of LiaTemplates/virtual-speaker: the resting face and the
// faces with an open mouth, as data URIs, for the styles looks.ts uses.
// Only in the browser bundle: DiceBear is ESM only.

import { createAvatar } from '@dicebear/core'
import * as avataaars from '@dicebear/avataaars'
import * as lorelei from '@dicebear/lorelei'
import * as micah from '@dicebear/micah'
import * as notionists from '@dicebear/notionists'
import * as personas from '@dicebear/personas'
import * as toonHead from '@dicebear/toon-head'
import type { Teacher } from './catalog'

const STYLES: Record<string, any> = {
  avataaars,
  lorelei,
  micah,
  notionists,
  personas,
  'toon-head': toonHead,
}

// key: the component of the mouth; open: shown while speaking; closed: the
// resting mouth, unless the look sets one. eyes: the resting eyes, unless
// the look sets them (selected visually in virtual-speaker)
type Face = { mouth: { key: string; open: string[]; closed?: string[] }; eyes?: string[] }

const FACES: Record<string, Face> = {
  avataaars: {
    mouth: { key: 'mouth', open: ['default', 'disbelief'], closed: ['twinkle', 'smile', 'serious'] },
    eyes: ['default', 'squint', 'surprised'],
  },
  lorelei: {
    mouth: { key: 'mouth', open: ['happy07', 'happy08', 'sad01'] },
    eyes: ['variant24', 'variant23', 'variant21', 'variant20', 'variant16', 'variant14', 'variant13', 'variant10', 'variant06', 'variant04', 'variant02'],
  },
  micah: {
    mouth: { key: 'mouth', open: ['surprised', 'laughing'], closed: ['smile', 'smirk', 'pucker'] },
    eyes: ['eyes', 'round', 'eyesShadow'],
  },
  notionists: { mouth: { key: 'lips', open: ['variant29', 'variant25', 'variant14', 'variant11'] } },
  personas: {
    mouth: { key: 'mouth', open: ['surprise', 'bigSmile'], closed: ['smile', 'smirk', 'lips'] },
    eyes: ['open'],
  },
  'toon-head': {
    mouth: { key: 'mouth', open: ['agape', 'laugh'], closed: ['smile', 'sad'] },
    eyes: ['happy', 'wide'],
  },
}

export type Frames = { rest: string; mouths: string[]; background: string | null; title: string }

export function frames(t: Teacher): Frames {
  const style = STYLES[t.style]
  const { mouth, eyes } = FACES[t.style]
  const options: Record<string, unknown> = { ...t.options, seed: t.seed }
  if (mouth.closed && options[mouth.key] === undefined) options[mouth.key] = mouth.closed
  if (eyes && options.eyes === undefined) options.eyes = eyes

  const resting = createAvatar(style, options).toJson().extra as Record<string, any>
  const background = toCSS(resting)
  // the background stays behind the images, also while the mouth moves
  options.backgroundColor = ['transparent']

  const face = (value: string) =>
    createAvatar(style, { ...options, [mouth.key]: [value], [mouth.key + 'Probability']: 100 }).toDataUri()

  return {
    rest: face(resting[mouth.key]),
    mouths: mouth.open.filter((v) => v !== resting[mouth.key]).map(face),
    background,
    title: title(t, style.meta || {}),
  }
}

// a linear gradient of DiceBear runs from left to right, rotated clockwise
function toCSS(extra: Record<string, any>): string | null {
  const primary = extra.primaryBackgroundColor
  if (!primary || primary === 'transparent') return null
  if (extra.backgroundType === 'gradientLinear') {
    return 'linear-gradient(' + (90 + (Number(extra.backgroundRotation) || 0)) + 'deg, ' + primary + ', ' + extra.secondaryBackgroundColor + ')'
  }
  return primary
}

// the licenses of toon-head, micah and personas ask for the credit
function title(t: Teacher, meta: any): string {
  const credit = [meta.title && '"' + meta.title + '"', meta.creator && 'by ' + meta.creator, meta.license && meta.license.name && 'licensed under ' + meta.license.name]
    .filter(Boolean)
    .join(' ')
  return t.name + ' – Avatar: ' + credit + ' (via DiceBear)'
}
```

Hinweis: DiceBear liefert `primaryBackgroundColor` als `#rrggbb` oder ohne `#`. Falls `toCSS` in Step 8 farblose
Hintergründe zeigt, `'#' + primary.replace(/^#/, '')` verwenden (so macht es virtual-speaker nicht, also erst sehen).

- [ ] **Step 5: `src/teachers/teachers.ts` (Browser-Einstieg)**

```ts
// window.Teachers for the chat (views/avatar.js, views/chat.js): the
// catalog without the DiceBear options, and the images of a person.

import { TEACHERS, years } from './catalog'
import { frames, type Frames } from './render'

const cache: Record<string, Frames> = {}

;(window as any).Teachers = {
  ids: () => Object.keys(TEACHERS),
  get(id: string) {
    const t = TEACHERS[id]
    if (!t) return undefined
    const { style, seed, options, ...rest } = t
    return { ...rest, years: years(t.lived) }
  },
  frames(id: string) {
    const t = TEACHERS[id]
    if (!t) return undefined
    return cache[id] || (cache[id] = frames(t))
  },
}
```

- [ ] **Step 6: Parcel-Ziel, Build-Skript, `.gitignore`**

In `package.json`:

```json
    "build": "npx parcel build src/index.ts --target main && npx parcel build --target teachers && npm run shebang && npm run lib && cp src/codex-bridge.js dist/codex-bridge.js",
```

und unter `targets` neben `main`:

```json
    "teachers": {
      "source": "src/teachers/teachers.ts",
      "distDir": "views",
      "context": "browser",
      "outputFormat": "global",
      "includeNodeModules": true,
      "sourceMap": false,
      "optimize": true
    }
```

`.gitignore`: Zeile `views/teachers.js` ergänzen.

Run: `npm run build && ls -la views/teachers.js dist/index.js && git status --short views/`
Expected: beide Dateien existieren; `git status` zeigt `views/teachers.js` nicht (ignoriert) und keine weiteren neuen
Dateien unter `views/` (Parcel darf dort nichts anderes ablegen; falls doch, z. B. eine `.map`, `sourceMap: false`
prüfen). Die Größe von `views/teachers.js` notieren und im Commit nennen (erwartet: unter 2 MB).

Falls Parcel `src/index.ts` auch für das Ziel `teachers` baut oder `--target teachers` ohne Einstieg ablehnt: in
`build` statt dessen `npx parcel build src/teachers/teachers.ts --target teachers` schreiben.

- [ ] **Step 7: Route und Script-Tag**

`src/lib.ts`, in der Shell-Route (`'/liascript/:file(chat.html|chat.js|chat.css|avatar.js)'`):

```ts
      '/liascript/:file(chat.html|chat.js|chat.css|avatar.js|teachers.js)',
```

und den Kommentar darüber um `and the portraits of the teacher personas` ergänzen.

`views/chat.html`, vor `<script src="avatar.js"></script>`:

```html
    <!-- the teacher personas: DiceBear portraits, built by npm run build -->
    <script src="teachers.js"></script>
```

- [ ] **Step 8: Tests laufen durch**

Run: `npm run build && node src/check.js`
Expected: `ok`. Scheitert `vm.runInContext`, weil das Bundle ein Browser-Global erwartet (z. B. `self`, `document`),
dem `sandbox` genau dieses Global ergänzen (`sandbox.self = sandbox.window`) und den Grund als Kommentar dazuschreiben.

- [ ] **Step 9: Commit**

```bash
git add src/teachers/render.ts src/teachers/teachers.ts package.json package-lock.json .gitignore src/lib.ts views/chat.html src/check.js
git commit -m "Render the teacher personas in the browser: views/teachers.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Agent-Seite: `find_teacher`, `set_agent.persona`, Formular `teacher`, `read_chat`

**Files:**
- Modify: `src/lib.ts:73-76` (Typ `Agent`), `src/mcp.ts` (TOOLS, `setAgent`, `chat`, `readChat`, Dispatch)
- Test: `src/check.js`

**Interfaces:**
- Consumes: `TEACHERS`, `find`, `line`, `GENDERS`, `REGIONS` aus `src/teachers/catalog.ts`
- Produces:
  - `export type Agent = { name: string; emoji: string; label?: string; persona?: string }` in `lib.ts`
  - Tool `find_teacher({topic?, gender?, region?}) -> {teachers: string[]}`
  - `set_agent({name, emoji?, label?, persona?: string | null, agents?: [{name, emoji, label?, persona?}]}) -> {agent, agents, persona?: {id, name, teaching, rules}}`
  - `chat` akzeptiert `inputs[].type === 'teacher'` (1 bis 6 bekannte ids)
  - `read_chat` Einträge: `agent: <name>` und, falls vorhanden, `persona: <id>`

- [ ] **Step 1: Failing tests in `src/check.js`**

a) In der Liste der erwarteten Tools (`for (const name of ['get_state', 'goto', …, 'write_section'])`) `'find_teacher'` ergänzen.

b) Direkt nach dem Bundle-Block aus Task 2 einfügen:

```js
  // --- find_teacher: the catalog for the agent, one line per person
  const allTeachers = (await tool('find_teacher', {})).teachers
  assert.strictEqual(allTeachers.length, 196)
  assert.ok(allTeachers.includes('socrates · Socrates · 470–399 BC · europe · male · ' + Teachers.get('socrates').fields.join(', ') + ' · ' + Teachers.get('socrates').teaching), allTeachers[0])
  const physics = (await tool('find_teacher', { topic: 'PHYSICS', gender: 'female' })).teachers
  assert.ok(physics.length >= 1 && physics.every((l) => l.includes(' · female · ') && /physics/.test(l.split(' · ')[5])), 'topic in any case: ' + physics)
  const africa = (await tool('find_teacher', { region: 'africa' })).teachers
  assert.ok(africa.length >= 1 && africa.every((l) => l.split(' · ')[3] === 'africa'))
  assert.deepStrictEqual((await tool('find_teacher', { topic: 'no-such-field-xyz' })).teachers, [])
  assert.ok((await tool('find_teacher', { region: 'atlantis' })).isError, 'region is one of the list')
  assert.ok((await tool('find_teacher', { gender: 'x' })).isError, 'gender is female or male')
```

c) Bei den Formular-Fehlern (nach `assert.ok((await tool('chat', { markdown: 'x', inputs: [{ id: 'a', type: 'radio', options: [] }] })).isError)`):

```js
  assert.ok((await tool('chat', { markdown: 'x', inputs: [{ id: 'who', type: 'teacher', options: ['nobody'] }] })).isError, 'only known teachers')
  assert.ok((await tool('chat', { markdown: 'x', inputs: [{ id: 'who', type: 'teacher', options: ids.slice(0, 7) }] })).isError, 'at most six teachers')
  const pick = await tool('chat', { markdown: 'Wer soll dich unterrichten?', inputs: [{ id: 'who', type: 'teacher', options: ['socrates', 'marie-curie'] }], wait: false })
  assert.ok(pick.ask, 'a teacher form is a form')
  assert.ok(stream.includes('"inputs":[{"id":"who","type":"teacher","options":["socrates","marie-curie"]}]'), 'the shell gets the ids')
  await tool('chat', { close: true })
```

d) Nach dem Block `const declared = await tool('set_agent', { name: 'examiner', agents: [{ ...tutor, label: 'Unterricht' }, examiner] })` und seinem `assert`:

```js
  // a teacher persona instead of the robot
  assert.ok((await tool('set_agent', { name: 'tutor', persona: 'nobody' })).isError, 'only known personas')
  assert.ok((await tool('set_agent', { name: 'tutor', persona: 5 })).isError, 'persona is an id')
  const curie = await tool('set_agent', { name: 'tutor', persona: 'marie-curie' })
  assert.deepStrictEqual(curie.agents[0], { ...tutor, label: 'Unterricht', persona: 'marie-curie' }, 'a label of its own stays')
  assert.strictEqual(curie.persona.id, 'marie-curie')
  assert.strictEqual(curie.persona.name, 'Marie Curie')
  assert.strictEqual(curie.persona.teaching, Teachers.get('marie-curie').teaching)
  assert.ok(/AI/.test(curie.persona.rules) && /quote/.test(curie.persona.rules), 'the rules of the role: ' + curie.persona.rules)
  assert.ok(stream.includes('"persona":"marie-curie"'), 'the shell learns the persona')
  await tool('chat', { markdown: 'Bonjour, je suis une IA dans le rôle de Marie Curie' })
  assert.ok(stream.includes('"agent":{"name":"tutor","emoji":"🧑‍🏫","label":"Unterricht","persona":"marie-curie"}'), 'a message carries it')
  const savedEntry = (await tool('read_chat', { last: 1 })).entries[0]
  assert.strictEqual(savedEntry.agent, 'tutor')
  assert.strictEqual(savedEntry.persona, 'marie-curie', 'read_chat tells a fresh agent the persona')
  const plain = (await tool('read_chat', { last: 1000 })).entries.filter((e) => e.type === 'ai' && e.agent === 'examiner')[0]
  assert.ok(plain && !('persona' in plain), 'a message without persona has none')
  const profAgent = await tool('set_agent', { name: 'prof', emoji: '🎓', persona: 'socrates' })
  assert.strictEqual(profAgent.agents[2].label, 'Socrates', 'without a label the name of the person')
  const gone = await tool('set_agent', { name: 'prof', persona: null })
  assert.strictEqual(gone.agents[2].persona, undefined, 'null removes the persona')
  assert.strictEqual(gone.agents[2].label, undefined, 'and the label it brought')
  assert.strictEqual(gone.persona, undefined)
  const listed = await tool('set_agent', { name: 'tutor', agents: [{ ...tutor, persona: 'hypatia' }, examiner] })
  assert.deepStrictEqual(listed.agents, [{ ...tutor, persona: 'hypatia', label: 'Hypatia' }, examiner], 'agents replaces the roster, personas too')
  assert.strictEqual(listed.persona.id, 'hypatia', 'the persona of the current agent')
  assert.ok((await tool('set_agent', { name: 'tutor', agents: [{ ...tutor, persona: 'nobody' }] })).isError)
  await tool('set_agent', { name: 'tutor', agents: [tutor, examiner] })
```

Die Namen `all`, `saved` und `fresh` gibt es in `check.js` schon, deshalb `allTeachers`, `savedEntry`, `profAgent`.
Zum Roster an dieser Stelle: nach `declared` ist es `[{tutor, label: 'Unterricht'}, examiner ohne label]`.

- [ ] **Step 2: Tests scheitern sehen**

Run: `npm run build && node src/check.js`
Expected: FAIL bei `find_teacher` (fehlt in der Tool-Liste).

- [ ] **Step 3: `Agent` in `src/lib.ts`**

```ts
// label: what the user reads instead of the name, e.g. "Unterrichtsplanung"
// persona: a historical person of src/teachers/ the chat shows instead of the robot
export type Agent = { name: string; emoji: string; label?: string; persona?: string }
```

- [ ] **Step 4: Tool-Definitionen in `src/mcp.ts`**

Import oben, nach `import * as sections from './sections'`:

```ts
import * as teachers from './teachers/catalog'
```

In `TOOLS`, beim `chat`-Tool im Schema von `inputs.items`:

```ts
              type: { type: 'string', enum: ['buttons', 'radio', 'checkbox', 'teacher'] },
```

und im `description`-Text des `chat`-Tools den letzten Satz ersetzen durch
`buttons submit the form on click, radio picks one option, checkbox any number, teacher shows 1 to 6 ids of find_teacher as portraits to click.`

Beim `set_agent`-Tool `properties` ergänzen:

```ts
        persona: {
          type: ['string', 'null'],
          description: 'id of find_teacher: this agent shows that historical person instead of a robot and teaches in their style, null removes it',
        },
```

und im `agents.items.properties` `persona: { type: 'string' }`. Den `description`-Text des `set_agent`-Tools um diesen Satz
vor `Opens no browser.` ergänzen: `persona turns the agent into a teacher persona, the result has its teaching style and rules.`

Neues Tool nach `set_agent`:

```ts
  {
    name: 'find_teacher',
    description:
      'Historical people a teaching agent can take on as persona (set_agent persona): portrait, voice and teaching style. One line per person: id · name · lived · region · gender · fields · teaching. topic matches a part of a field or the name, any case; gender female|male; region europe|asia|africa|north-america|south-america|oceania|polar. Without filters all of them. If get_state.teacher names one, take that one and ask nobody. Otherwise find 3 or 4 that fit the course: read its topic first, match it to fields yourself (try several topics), mix women and men and regions, follow wishes of the user (a woman, someone from Africa). Describe each in one sentence of the language of the course in the markdown, then ask with a chat form {type: "teacher", options: [ids]}; the answer is the id. Then set_agent with that persona, introduce yourself as an AI in the role of that person, and teach in their style until the user asks for someone else.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'e.g. physics, music, education' },
        gender: { type: 'string', enum: ['female', 'male'] },
        region: { type: 'string', enum: ['europe', 'asia', 'africa', 'north-america', 'south-america', 'oceania', 'polar'] },
      },
    },
  },
```

- [ ] **Step 5: Handler in `src/mcp.ts`**

Neben `readChat`:

```ts
const RULES =
  'Teach in this style. You are an AI in the role of this person: say so when you introduce yourself, never invent quotes, do not act out their personal fate.'

function findTeacher(args: any) {
  if (args.topic !== undefined && typeof args.topic !== 'string') throw new Error('topic must be a string')
  if (args.gender !== undefined && teachers.GENDERS.indexOf(args.gender) < 0) throw new Error('gender must be female or male')
  if (args.region !== undefined && teachers.REGIONS.indexOf(args.region) < 0) {
    throw new Error('region must be one of ' + teachers.REGIONS.join(', '))
  }
  return { teachers: teachers.find(args).map(teachers.line) }
}

function isPersona(value: any) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(teachers.TEACHERS, value)
}

// what an agent with a persona needs to take on the role
function personaOf(agent?: server.Agent) {
  const t = agent && agent.persona ? teachers.TEACHERS[agent.persona] : undefined
  return t ? { id: t.id, name: t.name, teaching: t.teaching, rules: RULES } : undefined
}

// persona given: set it, and the name of the person as label unless the agent
// has one; null: remove it, and the label it brought
function withPersona(agent: server.Agent, persona: any): server.Agent {
  if (persona === undefined) return agent
  const before = agent.persona
  const out: server.Agent = { name: agent.name, emoji: agent.emoji }
  // the keys always in this order: the shell and the tests compare JSON
  if (persona === null) {
    if (agent.label !== undefined && !(before && agent.label === teachers.TEACHERS[before].name)) out.label = agent.label
    return out
  }
  out.label = agent.label !== undefined ? agent.label : teachers.TEACHERS[persona].name
  out.persona = persona
  return out
}
```

In `setAgent`:
1. Nach der Prüfung von `label`:

```ts
  const persona = args.persona
  if (persona !== undefined && persona !== null && !isPersona(persona)) {
    throw new Error('persona must be an id of find_teacher, or null')
  }
```

2. In der Schleife über `args.agents`, nach der `label`-Prüfung:

```ts
      if (agent.persona !== undefined && !isPersona(agent.persona)) {
        throw new Error('agents[].persona must be an id of find_teacher')
      }
```

und `list.push(declared)` ersetzen durch `list.push(withPersona(declared, agent.persona))`.

3. Die Bedingung `if (emoji !== undefined || label !== undefined) {` ersetzen durch
`if (emoji !== undefined || label !== undefined || persona !== undefined) {`, und in diesem Zweig die Zeile
`if (label !== undefined) agent.label = label` gefolgt von `list = known ? …` ersetzen durch:

```ts
    if (label !== undefined) agent.label = label
    const updated = withPersona(agent, persona)
    // in its place, the menu keeps its order
    list = known ? list.map((a) => (a.name === name ? updated : a)) : list.concat(updated)
```

Die Fehlermeldung `unknown agent ' + name + ', pass its emoji or declare it in agents` bleibt; sie greift jetzt auch,
wenn nur `persona` für einen unbekannten Agenten kommt.

4. Das Ende von `setAgent`:

```ts
  server.setAgent(name, list)
  const { agent, agents } = server.getState()
  const role = personaOf(server.currentAgent())
  return role ? { agent, agents, persona: role } : { agent, agents }
```

In `readChat` die Abbildung der Einträge ersetzen:

```ts
    // the name is enough, the emoji is for the user; the persona tells a
    // fresh agent which role to take on again
    entries: entries.slice(-last).map((e: any) =>
      e.agent ? { ...e, agent: e.agent.name, ...(e.agent.persona ? { persona: e.agent.persona } : {}) } : e,
    ),
```

In `chat`, die Prüfung der Typen ersetzen:

```ts
    if (['buttons', 'radio', 'checkbox', 'teacher'].indexOf(input.type) < 0) {
      throw new Error('input.type must be buttons, radio, checkbox or teacher')
    }
```

und nach der bestehenden Prüfung von `input.options` ergänzen:

```ts
    if (input.type === 'teacher' && (input.options.length > 6 || !input.options.every(isPersona))) {
      throw new Error('a teacher input has 1 to 6 ids of find_teacher')
    }
```

Dispatch, nach `else if (params.name === 'set_agent') …`:

```ts
      else if (params.name === 'find_teacher') call = () => findTeacher(args)
```

- [ ] **Step 6: Instruktionen bleiben unverändert**

`INSTRUCTIONS` hat schon 2045 von 2048 Zeichen. Keine Zeile ergänzen: Die Agenten finden `find_teacher` über die
Tool-Liste, und die Beschreibungen von `set_agent` und `chat` nennen es.

- [ ] **Step 7: Tests laufen durch**

Run: `npm run build && node src/check.js`
Expected: `ok`. Scheitert die 2048-Grenze, die Beschreibung von `find_teacher` kürzen (die Regeln zur Auswahl zuerst
behalten, Beispiele zuletzt streichen), nicht die Grenze ändern.

- [ ] **Step 8: Commit**

```bash
git add src/lib.ts src/mcp.ts src/check.js
git commit -m "find_teacher and set_agent persona: historical people as teachers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `get_state.teacher` aus dem Kurskopf

**Files:**
- Modify: `src/sections.ts` (neue Funktion `header`), `src/mcp.ts` (Handler `get_state`, Beschreibung `get_state`)
- Test: `src/check.js`

**Interfaces:**
- Consumes: `teachers.TEACHERS` (Task 3), `courseFile()` in `mcp.ts`
- Produces: `export function header(content: string, key: string): string | undefined` in `sections.ts`; `get_state` liefert `teacher: <id> | null` (nur wenn der Kopf `teacher:` hat) und bei unbekannter id `warning`

- [ ] **Step 1: Failing test in `src/check.js`**

Nach `await post(report)` (die Zeile nach dem Test `forged browser paths cannot become external launch inputs`) einfügen:

```js
  // a course can fix its teacher in the header: teacher: <id>
  const COURSE = path.join(ROOT, 'check-teacher.md')
  const course = (head, rest) => fs.writeFileSync(COURSE, head + '\n# Course\n\n' + (rest || ''))
  const at = (file) => post({ type: 'state', context: { ...report.context, file } })
  try {
    course('<!--\nauthor: x\nteacher: socrates\n-->')
    await at('check-teacher.md')
    assert.strictEqual((await tool('get_state', {})).teacher, 'socrates', 'the header names the teacher')
    course('<!--\nteacher: nobody\n-->')
    state = await tool('get_state', {})
    assert.strictEqual(state.teacher, null, 'an unknown teacher is none')
    assert.ok(/nobody/.test(state.warning), 'and a warning: ' + state.warning)
    course('<!--\nauthor: x\n-->', '<!--\nteacher: socrates\n-->\n')
    assert.strictEqual((await tool('get_state', {})).teacher, undefined, 'only the header counts, not a comment after the first heading')
    await at('../outside.md')
    assert.strictEqual((await tool('get_state', {})).teacher, undefined, 'a forged path reads nothing')
  } finally {
    fs.rmSync(COURSE, { force: true })
  }
  await post(report)
  assert.strictEqual((await tool('get_state', {})).teacher, undefined, 'README.md has no teacher')
```

- [ ] **Step 2: Test scheitern sehen**

Run: `npm run build && node src/check.js`
Expected: FAIL bei `the header names the teacher` (`undefined !== 'socrates'`).

- [ ] **Step 3: `header` in `src/sections.ts`** (ans Dateiende)

```ts
// A key of the macro header of a course: the HTML comment before the first
// heading, e.g. teacher: socrates. undefined without header or key.
export function header(content: string, key: string): string | undefined {
  const start = content.indexOf('<!--')
  const first = content.search(/^#{1,6}[ \t]/m)
  if (start < 0 || (first >= 0 && first < start)) return undefined
  const end = content.indexOf('-->', start)
  const comment = content.slice(start + 4, end < 0 ? undefined : end)
  const match = comment.match(new RegExp('^[ \\t]*' + key + '[ \\t]*:[ \\t]*(\\S+)', 'm'))
  return match ? match[1] : undefined
}
```

- [ ] **Step 4: Handler `get_state` in `src/mcp.ts`**

Neue Funktion neben `findTeacher`:

```ts
// teacher: <id> in the header of the open course; a path the browser forged
// or a file that is gone reads nothing
function courseTeacher(state: any): { teacher?: string | null; warning?: string } {
  let content
  try {
    content = fs.readFileSync(path.join(state.root, courseFile(state.file)), 'utf8')
  } catch (e) {
    return {}
  }
  const id = sections.header(content, 'teacher')
  if (id === undefined) return {}
  if (isPersona(id)) return { teacher: id }
  return { teacher: null, warning: 'the course names teacher ' + id + ', which find_teacher does not know' }
}
```

Im Dispatch von `get_state` das zurückgegebene Objekt ändern zu:

```ts
        return {
          ...state,
          ...courseTeacher(state),
          codex_bridge: {
```

Im `description`-Text von `get_state` nach dem Satz über `session` ergänzen:
`teacher is the id of find_teacher the course header names (teacher: <id>), null with a warning if unknown.`

- [ ] **Step 5: Tests laufen durch**

Run: `npm run build && node src/check.js`
Expected: `ok`. `ls check-teacher.md` meldet „No such file“ (der `finally` räumt auf).

- [ ] **Step 6: Commit**

```bash
git add src/sections.ts src/mcp.ts src/check.js
git commit -m "get_state.teacher: a course fixes its teacher persona in the header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Chat zeigt Personas (Bühne, Nachrichten, Menü, Formular, Stimme)

**Files:**
- Modify: `views/avatar.js` (`bot`, `voice`, neue `portrait`), `views/chat.js` (`form`, `TEXTS.de`), `views/chat.css`
- Test: manuell im Browser (kein automatischer Browser-Test, siehe Spec)

**Interfaces:**
- Consumes: `window.Teachers.get(id)`, `window.Teachers.frames(id)` (Task 2); Roster-Einträge mit `persona` (Task 3); Formular `{type: 'teacher', options: [ids]}` (Task 3)
- Produces: `Avatar.bot(agent, size)` gibt bei bekannter Persona ein `<span class="bot persona">` mit `data-mouth`/`data-state`-Verhalten wie die SVG zurück

- [ ] **Step 1: `portrait` und Rückfall in `views/avatar.js`**

Vor `var blinks = 0`:

```js
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
```

Am Anfang von `function bot(agent, size) {`:

```js
    var face = portrait(agent, size)
    if (face) return face
```

`voice` ersetzen:

```js
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
    return { gender: v[0], pitch: v[1], rate: v[2], pick: hash(agent && agent.name ? agent.name : '') }
  }
```

- [ ] **Step 2: CSS in `views/chat.css`** (nach dem `@keyframes bot-wait`-Block)

```css
/* a teacher persona: the portrait with three mouths stacked, and a bar
   below for the running light (.tick) and the pulse (.wait) */
.bot.persona {
  position: relative;
  display: inline-block;
  overflow: hidden;
  background: #334155;
}
.bot.persona img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.bot.persona .tick,
.bot.persona .wait {
  position: absolute;
  bottom: 0;
  height: 8%;
  background: #7dd3fc;
}
.bot.persona .tick {
  width: 12.5%;
}
.bot.persona .tick:nth-of-type(1) { left: 0 }
.bot.persona .tick:nth-of-type(2) { left: 12.5% }
.bot.persona .tick:nth-of-type(3) { left: 25% }
.bot.persona .tick:nth-of-type(4) { left: 37.5% }
.bot.persona .tick:nth-of-type(5) { left: 50% }
.bot.persona .tick:nth-of-type(6) { left: 62.5% }
.bot.persona .tick:nth-of-type(7) { left: 75% }
.bot.persona .tick:nth-of-type(8) { left: 87.5% }
.bot.persona .wait {
  left: 0;
  right: 0;
}
/* the portraits of a teacher form */
.msg fieldset.teacher {
  border: 0;
  padding: 0;
}
.msg fieldset.teacher button {
  display: grid;
  justify-items: center;
  gap: 0.25em;
  padding: 0.4em;
  min-width: 6.5em;
}
.msg fieldset.teacher small {
  color: GrayText;
}
```

Hinweis: `:nth-of-type` zählt `<i>`-Elemente getrennt von den `<img>`, deshalb sind die Ticks `<i>` und die Wait-Leiste
ist das neunte `<i>`; sie bekommt durch `.wait` `left: 0; right: 0`, das überschreibt ihr `nth-of-type`-`left` nicht,
weil kein `:nth-of-type(9)` existiert. Die bestehenden Regeln `.bot .m, .bot .tick, .bot .wait { visibility: hidden }`
und die `data-mouth`/`data-state`-Regeln gelten unverändert, ebenso die Animationen `bot-tick`/`bot-wait`.

- [ ] **Step 3: Formular `teacher` in `views/chat.js`**

Kommentar über `function form(` ergänzen: `// inputs: [{id, type: buttons|radio|checkbox|teacher, label?, options: [string]}]`
(teacher: ids of teachers.js, shown as portraits).

In `input.options.forEach(function (option) {` als ersten Zweig:

```js
      if (input.type == 'teacher') {
        var person = window.Teachers && window.Teachers.get(option)
        var card = document.createElement('button')
        card.name = input.id
        card.value = option
        card.append(Avatar.bot({ name: option, persona: option, label: person ? person.name : option }, 64))
        var name = document.createElement('strong')
        name.textContent = person ? person.name : option
        card.append(name)
        if (person) card.append(lived(person.lived))
        set.append(card)
      } else if (input.type == 'buttons') {
```

(das bisherige `if (input.type == 'buttons') {` wird damit zu `} else if (input.type == 'buttons') {`).

Neue Funktion direkt vor `function form(`:

```js
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
```

 In `TEXTS.de` ergänzen: `BC: 'v. Chr.',`

`answered()` braucht keine Änderung: Es sucht `button[name]` und markiert den mit passendem `value` als `chosen`.

- [ ] **Step 4: Bauen, Tests laufen weiter durch**

Run: `npm run build && node src/check.js`
Expected: `ok` (die Shell-Dateien werden nur ausgeliefert, nicht ausgeführt).

- [ ] **Step 5: Sichtprüfung im Browser**

Dem Nutzer vorher sagen: „Ich öffne jetzt ein Browserfenster für die Sichtprüfung der Personas und schließe es danach.“
(Siehe Memory „No surprise browser windows“.) Den MCP-Server neu starten, damit der neue Build läuft (Memory „Restart
the liascript MCP server“: den `--mcp`-Kindprozess beenden, der nächste Tool-Aufruf startet ihn neu).

Mit den `mcp__liascript__*`-Tools nacheinander prüfen und für jeden Punkt notieren, ob er stimmt:

1. `set_agent({name: 'teaching', emoji: '🧑‍🏫', persona: 'marie-curie'})`, dann `chat({markdown: 'Hallo'})`: Button,
   Bühne und Fußzeile der Nachricht zeigen Marie Curie statt des Roboters, Tooltip mit Name und Lizenz.
2. `chat({status: 'Lese den Kurs'})`: unter dem Porträt läuft das Lauflicht.
3. `chat({markdown: 'Wer?', inputs: [{id: 'who', type: 'teacher', options: ['socrates', 'hypatia', 'wangari-maathai']}]})`:
   drei Karten mit Porträt, Name, Jahren (`470–399 v. Chr.` bei Sokrates, der Kurs ist deutsch); während das Formular
   offen ist, pulsiert die Leiste. Ein Klick schickt ab, die gewählte Karte ist markiert.
4. „Vorlesen“ an der Nachricht aus 1: der Mund bewegt sich, die Stimme ist weiblich (sofern der Browser eine hat).
5. F5: Nachrichten behalten Marie Curie.
6. Ohne `teachers.js`: in den DevTools `window.Teachers = undefined` setzen und `set_agent({name: 'teaching', persona:
   'socrates'})` aufrufen: Roboter statt Porträt, keine Fehler in der Konsole.
7. Agent-Menü mit zwei Agenten (`set_agent({name: 'teaching', agents: [{name: 'teaching', emoji: '🧑‍🏫', persona: 'socrates'}, {name: 'reviewer', emoji: '✅'}]})`): die Reihe zeigt Porträt und Roboter.

Fenster danach schließen. Abweichungen beheben, dann Schritt 4 wiederholen.

- [ ] **Step 6: Commit**

```bash
git add views/avatar.js views/chat.js views/chat.css
git commit -m "Show teacher personas in the chat: portrait, mouth, voice and the teacher form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dokumentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: `CLAUDE.md`**

Unter „Build commands“ den Satz zu den zwei Build-Ausgaben um eine dritte ergänzen:

```
- `views/teachers.js` — parcel target `teachers` (browser, global), entry `src/teachers/teachers.ts`: the catalog of
  the teacher personas and their DiceBear portraits for the chat. A build artefact (`.gitignore`), shipped because
  `.npmignore` is what npm reads. DiceBear is ESM only and a devDependency: never import it outside `src/teachers/render.ts`.
```

In „Architecture“, nach dem Absatz zu `src/mcp.ts`, einen Absatz:

```
- **`src/teachers/`** — teacher personas: historical people a teaching agent can take on. `looks.ts` is a verbatim
  copy of `src/famous.ts` of `LiaTemplates/virtual-speaker` (copy it again to take over new people, only header and
  last line differ), `traits.ts` holds gender, region, lived, fields and teaching (an English instruction, never a
  quote) per id, typed against the ids of `looks.ts`, `catalog.ts` joins them (`TEACHERS`, `find`, `line`) without
  DiceBear, so `mcp.ts` imports it. `render.ts` (copy of virtual-speaker's `avatar.ts`/`faces.ts`, six styles) makes
  the resting face and the open mouths. The MCP side: `find_teacher` lists them, `set_agent.persona` puts one on a
  roster agent (label defaults to the person's name, `null` removes it, the result carries `teaching` and `rules`),
  the chat form `type: "teacher"` shows 1 to 6 as portraits, `get_state.teacher` is `teacher: <id>` of the course
  header (`sections.header()`). `Avatar.bot()` in `views/avatar.js` returns a `span.bot.persona` with the same
  `data-mouth`/`data-state` classes as the robot, and falls back to the robot if `window.Teachers` does not know
  the id; `Avatar.voice()` takes the gender of the person.
```

Den Satz `src/check.js` in „Build commands“ ergänzen: `It also runs views/teachers.js in a vm sandbox and renders every persona.`

- [ ] **Step 2: `README.md`**

Einen kurzen Abschnitt in der Nähe der Beschreibung von `--mcp` (mit `grep -n "mcp" README.md` die Stelle finden):

```markdown
### Teacher personas

With `--mcp` an agent can teach as a historical person: Marie Curie, Socrates, Hypatia, Paulo Freire and nearly 200
more, with a portrait, a voice and their way of teaching. The agent suggests a few that fit the course, the learner
picks one in the chat. A course can fix its teacher in the header:

    <!--
    author: …
    teacher: maria-montessori
    -->

The ids are those of `find_teacher`. The portraits are DiceBear avatars of
[virtual-speaker](https://github.com/LiaTemplates/virtual-speaker), their styles' licenses are named in the tooltip.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "Document the teacher personas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Hinweis: `CLAUDE.md` hat bereits offene, nicht committete Änderungen des Nutzers (siehe `git status` zu Beginn der
Sitzung). Interaktives `git add -p` geht hier nicht. Vor dem Commit den Nutzer fragen, ob `CLAUDE.md` samt seiner
offenen Änderungen mit committet werden darf; sonst nur `README.md` committen und `CLAUDE.md` geändert liegen lassen.
