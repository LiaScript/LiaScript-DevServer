# Lehrer-Personas: historische Persönlichkeiten als Lehrperson im Chat

Stand: 2026-10-13 · Branch `feat/agent-chat`

## Context

Jeder Agent im Chat ist ein Pixel-Roboter (`views/avatar.js`). Die Roboter bleiben. Für die Lehrperson (Teaching-Agent,
Tutor, Professorin) soll man zusätzlich eine historische Persönlichkeit wählen können: Avatar, Name und Stimme dieser
Person, dazu ihr Lehrstil. Sokrates fragt nach, Montessori lässt selbst entdecken, Freire knüpft an die Lebenswelt an.

Die Personen gibt es schon im Template `LiaTemplates/virtual-speaker` (`src/famous.ts`, 196 Personen, alle
verstorben, nach Kontinent gruppiert, gezeichnet in sechs DiceBear-Stilen). Mit dem Nutzer abgestimmt:

- Kopie nach DevServer, kein eigenes npm-Paket. Die beiden Kataloge dürfen auseinanderlaufen, neue Personen werden
  bei Bedarf von Hand übertragen.
- Lehrstil ja, Rollenspiel nein: Die Persona lehrt in der Art der Person, spricht aber nicht aus ihrer Zeit heraus
  und erfindet keine Zitate.
- Auswahl: Der Agent schlägt drei oder vier zum Kurs passende Personen vor (gemischt nach Geschlecht und Region,
  Wünsche wie „lieber eine Frau“ berücksichtigt), die lernende Person wählt im Chat. Legt der Kurskopf mit
  `teacher: <id>` eine Person fest, gilt diese.
- Alle 196 Personen werden übernommen. Europa (85) bleibt der größte Block, die anderen Regionen haben genug
  Personen, um bei den Vorschlägen zu mischen.

## Technische Randbedingungen

- `@dicebear/core` und `@dicebear/collection` 9.x sind reine ESM-Pakete. Der `lib`-Build (tsc, CommonJS) und die
  `pkg`-Binaries (Node 18) laden sie nicht ohne Weiteres. Gerendert wird deshalb im Browser, wie in virtual-speaker.
- Die CSP von `views/chat.html` erlaubt `img-src 'self' data:`, die Bilder kommen als data-URI ohne CSP-Änderung.
- `mcp.ts` geht nur durch Parcel und darf die reinen Katalogdaten importieren.

## Bausteine

### `src/teachers/people.ts` (reine Daten)

Kopie von `famous.ts`, ohne DiceBear-Import, jeder Eintrag ergänzt um:

```ts
'marie-curie': {
  name: 'Marie Curie', style: 'toon-head', seed: 'marie-curie', options: { … },
  gender: 'female',                 // 'female' | 'male'
  region: 'europe',                 // europe | asia | africa | north-america | south-america | oceania | polar
  lived: [1867, 1934],              // negative Jahre v. Chr., [geboren, gestorben]
  fields: ['physics', 'chemistry'], // englische Kleinwörter, 1 bis 5
  teaching: 'Let the learner measure first, explain afterwards; …', // 1 bis 2 Sätze, Englisch
},
```

`region` folgt den Abschnittskommentaren von `famous.ts`. Die Antarktis-Forscher (Amundsen, Shackleton, Mawson)
werden `polar`. `gender` wird pro Person bestimmt, nicht aus dem Namen. `teaching` beschreibt die Art zu lehren in
der zweiten Person als Anweisung an das Modell („Ask questions instead of explaining …“) und enthält keine Zitate.

Die Merkmale schreiben parallele Hilfsagenten, aufgeteilt nach Region. Der Nutzer prüft das Ergebnis im Diff.

### `src/teachers/render.ts` und `views/teachers.js`

`render.ts` ist eine reduzierte Kopie von `avatar.ts` und `faces.ts` aus virtual-speaker, nur die sechs verwendeten
Stile (avataaars, toon-head, lorelei, micah, personas, notionists). Er liefert für eine Persona-id:

```ts
{ rest: string, mouths: string[], background: string | null, title: string }
```

`rest` ist das Ruhebild, `mouths` sind die Bilder mit offenem Mund (mindestens eins), alles data-URIs. `title` nennt
Name, Stil, Urheber und Lizenz (CC BY bei toon-head, micah, personas). Blinzeln und Umherschauen entfallen zunächst.
Ergebnisse werden pro id gecacht.

`views/teachers.js` ist ein zweites Parcel-Ziel im `build` (Browser, `outputFormat: global`, `includeNodeModules`),
Einstieg `src/teachers/browser.ts`, das `window.Teachers = { get(id), frames(id) }` setzt. `get` gibt die
Katalogdaten ohne Optionen zurück. Die Datei liegt unter `views/` und kommt damit ins npm-Tarball und in `pkg.assets`.
Ausgeliefert wird sie wie `avatar.js` über die Route in `lib.ts` (`chat.html|chat.js|chat.css|avatar.js|teachers.js`),
mit `Cache-Control: no-cache`. `chat.html` lädt sie vor `avatar.js`.

`views/teachers.js` ist ein Build-Artefakt. Es kommt wie `dist/` in `.gitignore`, `npm run build` erzeugt es. Da es
eine `.npmignore` gibt, gilt `.gitignore` für npm nicht, die Datei landet also trotzdem im Tarball.

## Agent (`src/mcp.ts`)

### Tool `find_teacher`

```
find_teacher({topic?, gender?, region?}) -> {teachers: [line, …]}
```

Jede Zeile: `id · Name · lived · region · gender · fields · teaching`. `topic` ist ein Wort, das gegen `fields` und
den Namen geprüft wird (Teilwort, ohne Groß-/Kleinschreibung). Ohne Filter kommen alle 196. Die Zuordnung von
Kursthema zu Fächern übernimmt der Agent. Die Beschreibung sagt: drei oder vier vorschlagen, nach Geschlecht und
Region mischen, Wünsche des Nutzers beachten, `get_state.teacher` hat Vorrang.

### `set_agent({…, persona})`

`persona` ist eine id aus dem Katalog, sonst ein Fehler mit Verweis auf `find_teacher`. Der Roster-Eintrag wird
`{name, emoji, label, persona}`. Ohne `label` wird es der Name der Person. Das Ergebnis enthält zusätzlich:

```json
{ "persona": { "id": "marie-curie", "name": "Marie Curie", "teaching": "…",
  "rules": "Teach in this style. You are an AI in the role of this person: say so when you introduce yourself, never invent quotes, do not act out their personal fate." } }
```

`persona: null` entfernt die Persona wieder, der Roboter kehrt zurück.

### `get_state.teacher`

`getState()` liest aus dem Kopfkommentar der aktuellen Kursdatei (der HTML-Kommentar vor der ersten Überschrift) eine
Zeile `teacher: <id>` und gibt sie als `teacher` zurück. Eine unbekannte id ergibt `teacher: null` und eine
`warning`. Die Logik liegt als reine Funktion in `src/sections.ts`, neben der Kopf-Erkennung, die dort schon lebt.
Die Server-Instruktionen nennen `teacher` in einem Satz, die Einzelheiten stehen in der Beschreibung von
`find_teacher`.

### Formular `type: "teacher"`

```json
{ "id": "who", "type": "teacher", "options": ["marie-curie", "socrates", "wangari-maathai"] }
```

Höchstens sechs ids, jede muss im Katalog stehen. Die Antwort ist `{values: {who: "marie-curie"}}`, wie bei
`buttons`.

## Chat (`views/chat.js`, `views/avatar.js`, `views/chat.css`)

- `Avatar.bot(agent, size)`: Hat `agent.persona` eine bekannte id, entsteht statt der SVG ein `<span class="bot
  persona">` mit dem Ruhebild und den Mundbildern als `<img>`. Es hat dasselbe Attribut `data-mouth`, `talk`,
  `babble` und `quiet` funktionieren unverändert. CSS zeigt je nach `data-mouth` das passende Bild (0 = Ruhe,
  1 = erstes offenes Bild, 2 = letztes offenes Bild). Der Hintergrund kommt aus `background`, der Tooltip aus `title`.
- Bühne: Lauflicht und Puls (`stageState()`) werden bei einer Persona ein Leuchtstreifen unter dem Bild, gleiche
  Klassen, eigene CSS-Regeln.
- `Avatar.voice(agent)`: Bei einer Persona kommt das Geschlecht aus `Teachers.get(id).gender`. Tonhöhe und Tempo
  kommen aus dem Hash des Namens in einem engen Bereich, damit zwei Lehrerinnen sich unterscheiden.
- Formular `teacher`: Karten mit Ruhebild, Name, Lebensdaten und dem ersten Satz von `teaching`. Ein Klick schickt
  ab wie `buttons`. In der Historie zeigt `answered()` die gewählte Karte.
- Agenten-Menü und Robot-Reihe (`#agents`) zeigen das Gesicht der Persona.
- Fehlt `window.Teachers`, zum Beispiel bei einem kaputten Build, fällt `Avatar.bot` auf den Roboter zurück.

## Speicherung

Das Agenten-Objekt jeder `ai`-Nachricht in `.chats/<id>.json` bekommt `persona`. Ältere Nachrichten behalten so ihr
Gesicht, auch nach einem Wechsel der Lehrperson oder einem Neustart. `read_chat` gibt Agenten bisher nur mit Namen
aus. Es zeigt zusätzlich die `persona` der zuletzt verwendeten Agenten, damit ein frischer Agent das Roster mit
derselben Persona neu setzen kann. Das Roster selbst bleibt im Speicher, wie bisher.

## Tests (`src/check.js`)

- Katalog: alle 196 Einträge mit gültigem `gender`, `region`, `lived` (zwei Zahlen, geboren < gestorben), `fields`
  (1 bis 5) und `teaching` (nicht leer, ohne Anführungszeichen-Zitate). Jede Persona rendert mit `@dicebear/core`
  (dynamisches `import()`) ohne Fehler und hat mindestens ein offenes Mundbild.
- `find_teacher`: Filter nach `topic`, `gender` und `region` liefern nur passende Zeilen, ein Filter ohne Treffer eine
  leere Liste.
- `set_agent`: Eine unbekannte `persona` gibt einen Fehler. Eine gültige erscheint in `get_state().agents` und im
  Ergebnis mit `teaching` und `rules`. `persona: null` entfernt sie.
- `chat`: `type: "teacher"` mit unbekannter id oder mehr als sechs ids wird abgelehnt. Die Prüfung läuft vor dem
  Öffnen eines Browsers, kein Aufruf von `chat` ohne Fake-SSE-Client.
- `get_state.teacher` aus einer Kursdatei mit `teacher: socrates` im Kopf, und `null` plus `warning` bei einer
  unbekannten id.
- Die bestehende Prüfung der 2048 Zeichen deckt die neue Tool-Beschreibung ab.

Der Browser wird nicht automatisch getestet. Am Ende folgt eine Sichtprüfung im Chat (Karten, Bühne, Mundbewegung),
das Browserfenster wird vorher angekündigt.

## Dokumentation

- `CLAUDE.md`: Absatz zu `src/teachers/`, zu `find_teacher`, `persona` und `teacher`, zum zweiten Parcel-Ziel.
- `README.md`: kurzer Abschnitt, wie ein Kurs mit `teacher:` eine Lehrperson festlegt.

## Nicht Teil dieses Vorhabens

- Blinzeln, Umherschauen und Kopfbewegung der Personas (gibt es in virtual-speaker, kann später folgen).
- Rückübertragung der Merkmale nach virtual-speaker.
- Eigene, frei beschriebene Avatare (die Idee vom Anfang des Gesprächs).
