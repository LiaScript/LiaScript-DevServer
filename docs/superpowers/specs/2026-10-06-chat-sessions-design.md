# Chat-Sessions: Chats im Projekt speichern und wiederherstellen

Stand: 2026-10-06 · Branch `feature/agent-bridge`

## Context

Die Chat-Shell (`views/chat.js`) hat keinen Verlauf. Siehe den Kommentar `ponytail: no history` über `status()`:
Ein versehentliches F5, ein Live-Reload der Shell oder ein Neustart des MCP-Servers löscht den Log, und mit ihm die
Formular-Antworten des Nutzers. Ziel ist es, Chats wie in anderen KI-Chats als Sessions zu speichern, nach F5 und
Neustart automatisch fortzusetzen und über ein Verlaufsmenü einen neuen Chat oder eine ältere Session wählbar zu machen.
Die Sessions sollen Teil des Projekts werden, also committet und von anderen später fortgesetzt werden können.

Mit dem Nutzer abgestimmt:
- Ablage im Projektverzeichnis, in dem der MCP-Server läuft (`process.cwd()`), unter `.chats/<id>.json`, eine Datei
  pro Session. Der Ordner ist versteckt, deshalb ignoriert ihn der Live-Reload-Watcher und `sendFile` liefert ihn
  nicht aus (dotfiles werden ignoriert).
- F5 setzt die laufende Session still fort. Nach einem Serverneustart wird die zuletzt geänderte Session
  fortgesetzt. „Neuer Chat“ und ältere Sessions gibt es im Menü.
- Der Agent erfährt einen Wechsel über ein `session`-Event und kann den Verlauf mit einem Tool lesen.
- Mitgespeichert werden Formular-Antworten (gewählt, abgeschickt, noch offen) und nicht zugestellte Nachrichten
  (mit Button zum erneuten Senden). Statuszeile und aktiver Agent überstehen F5, aber nicht den Neustart (siehe unten).

## Dateiformat (`.chats/2026-10-06T14-03-12-a1b2.json`)

Gültiges JSON mit einem Eintrag pro Zeile. Die Datei wird bei jedem Eintrag komplett neu geschrieben. Im Diff steht
deshalb nur die neue Zeile, plus das Komma an der vorherigen. Durch die eindeutigen, sortierbaren Namen (UTC-Zeit
plus 4 Hex-Zeichen) gibt es zwischen mehreren Leuten und zwei parallel laufenden Server-Instanzen
(Claude Code und Copilot) keine Konflikte.

```json
{"id":"2026-10-06T14-03-12-a1b2","created":"…","file":"README.md","entries":[
{"t":"…","type":"ai","id":"ask-k3f9q2","markdown":"…","inputs":[…],"agent":{"name":"tutor","emoji":"🦉"},"lang":"de"},
{"t":"…","type":"user","text":"…"},
{"t":"…","type":"answer","ask":"ask-k3f9q2","values":{"level":"easy"}}
]}
```

Der Titel wird beim Auflisten abgeleitet: die erste Nutzernachricht (gekürzt auf 60 Zeichen), sonst die erste Zeile
der ersten KI-Nachricht, sonst das Datum. Eine Session-Datei entsteht erst mit dem ersten Eintrag, ein „Neuer Chat“
ohne Nachricht hinterlässt also keine Datei.

Statuszeile und Roster sind **nicht** in der Datei, damit committete Chats ruhig bleiben. Der Server hält beides im
Speicher und spielt es bei jedem `?chat`-Connect erneut ab. Damit ist F5 abgedeckt. Nach einem Neustart meldet der neue
Agent beides ohnehin neu (`set_agent`, `chat status`). Jede KI-Nachricht trägt ihr `agent {name, emoji}` selbst, der
Verlauf zeigt also auch ohne Roster die richtigen Emojis.

## Umsetzung

### 1. Neu: `src/chats.ts`, ein Dateispeicher ohne Express-Wissen (wie `sections.ts`)
- `open(dir)`, `create(file)` → Session im Speicher, `append(session, entry)` schreibt die Datei (`mkdirSync recursive`
  beim ersten Schreiben), `load(id)`, `list()` → `[{id, title, updated, count}]` neueste zuerst, `latest()`.
- `id` wird mit `isName` geprüft, bevor daraus ein Pfad wird (kein Path-Traversal). Kaputte Dateien beim Auflisten
  überspringen.
- Wird über `lib.ts` vom `tsc`-Lib-Build mitkompiliert, also ES5-tauglich bleiben (kein `find`, siehe Kommentar in
  `currentAgent()`).

### 2. `src/lib.ts`
- Im Agent-Modus in `start()`: `chats.open(path.join(process.cwd(), '.chats'))`. Aktuelle Session ist `latest()`, sonst
  eine neue (lazy). `getState()` bekommt `session: {id, title, messages}`.
- `send(msg)`: Bei `msg.chat` einen `ai`-Eintrag anhängen. `status` merken (aus `msg.status` oder `msg.chat.status`)
  für das Replay.
- `POST /agent`:
  - `chat` → `user`-Eintrag.
  - `answer` → `answer`-Eintrag.
  - Neuer Typ `session` mit `params.id` (vorhandene Session) oder leeren params (neuer Chat): wechselt die aktuelle
    Session, schickt sie an alle Chat-Clients und löst
    `emitEvent({type: 'session', params: {id, title, resumed}})` aus.
  - Eine unbekannte id ergibt 400.
- `eventsHandler`: Bei `?chat` nach der Leerzeile der Reihe nach `{sessions: list}`, `{session: {id, entries}}`,
  `agentsMessage()` und `{status}` schreiben. So kommen auch Nachrichten an, die bei geschlossenem Tab geschickt wurden.
- Exportiert `readChat(id?)` für den MCP-Adapter.

### 3. `src/mcp.ts`
- Ask-ids werden eindeutig über Neustarts hinweg (`'ask-' + crypto.randomBytes(3).toString('hex')`). Sonst kollidiert
  ein offenes `ask1` aus einer fortgesetzten Session mit einem neuen `ask1`.
- `onEvent`: Ein `session`-Event, während ein `chat`-Aufruf wartet, beendet ihn mit `{switched: true}`.
- Neues Tool `read_chat({session?, last?})`: Einträge der aktuellen (oder einer anderen) Session in kompakter Form,
  inklusive der Antworten auf Formulare.
- Die Instruktionen bekommen eine Zeile unter den Event-Typen: `session: the user opened a new chat or an old one
  (resumed true): read it with read_chat before answering.` Die 2048-Grenze in `check.js` einhalten, Details gehören
  in die Tool-Beschreibung.

### 4. `views/chat.html` + `views/chat.js`
- Neben dem Agent-Menü ein `<select id="sessions">` (immer sichtbar). Erste Option ist „＋ Neuer Chat“, danach
  „Titel · Datum“. Eine Änderung schickt `post({type: 'session', params: {id}})`, nach dem gleichen Muster wie `pick`.
- `add()` bekommt einen optionalen Zeitstempel `t`, damit der Stempel die gespeicherte Zeit zeigt.
- Das Rendern einer KI-Nachricht wandert aus `onmessage` in `showAI(chat, t)`. Formulare bekommen `data-ask`.
- `{session}` leert `log` und spielt die Einträge ab:
  - `ai` → `showAI`
  - `user` → `add('me', …)`
  - `answer` → Formular per `data-ask` finden, Werte setzen, `.chosen` markieren und sperren, dieselbe Logik wie nach
    einem erfolgreichen Absenden (als Funktion `answered(form, values)` herausziehen).
  - Formulare ohne `answer` bleiben offen und beantwortbar. Eine späte Antwort kommt beim Agenten als
    `answer`-Event an, wie bisher.
- Nicht zugestellte Nachrichten: Ein Outbox-Eintrag pro Session in `localStorage` (`liascript-chat-outbox`, im
  try/catch wie `LAYOUT`). Nach dem Replay werden sie als `failed` angehängt, mit einem Button „erneut senden“. Bei
  Erfolg verschwinden sie aus der Outbox. (Die Outbox gilt pro Origin. Weicht der Server auf einen anderen Port aus,
  geht sie verloren, das ist akzeptiert.)
- Den `ponytail: no history`-Kommentar entfernen.

### 5. Doku
- `CLAUDE.md`, Architektur-Abschnitte zu `lib.ts`, `mcp.ts` und `chat.js`: Sessions, `.chats/`, `session`-Event,
  `read_chat`, Replay-Reihenfolge.
- `README.md`: Kurzer Hinweis, dass `.chats/` committet werden kann, oder per `.gitignore` ausgeschlossen.
- Den Plan als `docs/superpowers/specs/2026-10-06-chat-sessions-design.md` ablegen.

## Verifikation

1. `npm run build`, dann `node src/check.js`, erweitert um:
   - Server mit `cwd` in einem Scratch-Ordner starten
   - Fake-SSE-Client `/gotoLine?chat` verbinden (Pflicht, bevor `chat` aufgerufen wird)
   - `chat` ohne inputs aufrufen → `.chats/*.json` existiert und enthält den `ai`-Eintrag
   - `POST /agent` vom Typ `chat` und `answer` (mit `Origin`) → Einträge in der Datei
   - Zweiten SSE-Client verbinden → erste Nachrichten sind `sessions` und `session` mit allen Einträgen
   - `POST /agent {type: 'session', params: {}}` → `session`-Event, `read_chat` ist leer
   - Mit der alten id zurückwechseln → `read_chat` liefert die Einträge
   - Server neu spawnen → `get_state.session.id` ist die letzte Session
   - Instruktionen ≤ 2048 Zeichen
2. Manuell im Browser, über den MCP-Server mit Neustart nach der Memory-Notiz: Formular schicken und beantworten, F5
   drücken (Antwort ist markiert und gesperrt). Ein zweites Formular offen lassen, F5 drücken (es ist noch
   beantwortbar). Server stoppen, Nachricht tippen (erscheint als nicht zugestellt), Server starten, erneut senden.
   „Neuer Chat“ wählen und über das Menü zur alten Session zurückkehren.

## Nachträge aus der Umsetzung

- **Verwaiste Outbox-Nachrichten:** Ein „Neuer Chat“ hat bis zur ersten Nachricht keine Datei. Scheitert seine erste
  Nachricht (Server gestoppt), setzt der Server nach dem Neustart die letzte *gespeicherte* Session fort, und die
  Nachricht hätte keinen Chat mehr. `showSession()` zeigt deshalb Outbox-Einträge, deren Session nicht in der Liste
  der gespeicherten steht, im aktuellen Chat und hängt sie ihm an.
- **Kein veralteter `chat.js`:** Chrome hat `chat.js` heuristisch gecacht und nach einem Update die alte Version
  ausgeführt. Die Shell-Dateien gehen deshalb mit `Cache-Control: no-cache` raus, `check.js` prüft das.
- **Instruktionen an der Grenze:** Die `session`-Zeile kostete drei kürzere Formulierungen, die Instruktionen haben
  jetzt 2045 von 2048 Zeichen. Eine nächste Regel braucht eigenen Platz.
