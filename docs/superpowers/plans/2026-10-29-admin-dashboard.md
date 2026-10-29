# Admin-Dashboard für `--users` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `liadev --users klasse` genügt; Share, LAN, Modelle, Webseiten, Leerlauf, Kurs- und Kit-Ordner stellt die Lehrkraft auf der Admin-Seite ein, sieht Links mit QR-Codes, Warnungen, wenn die KI etwas ablehnt, und Kosten je Tag.

**Architecture:** `src/gateway.ts` bekommt eine gespeicherte Konfiguration (`DIR/.gateway.json`), aus der es Share (über `share()` von `src/share.ts`, jetzt stoppbar), LAN und die Starts der Nutzer-Instanzen steuert. Die Instanzen (`src/acp.ts`, `src/mcp.ts`) melden Ablehnungen als Zeile auf ihrer Standardausgabe, die das Gateway ohnehin liest, und schreiben Kosten je Tag in ihren `.chats/`-Ordner. Die Admin-Seite bleibt ein auf dem Server gebauter HTML-String.

**Tech Stack:** Node ≥ 20, TypeScript über parcel, `http` ohne Express im Gateway, neue Abhängigkeit `qrcode-generator`.

**Spec:** `docs/superpowers/specs/2026-10-29-admin-dashboard-design.md`

## Global Constraints

- Admin-Seite nur loopback, `Host`-Prüfung und `Origin` bei jedem POST wie heute in `adminRoute()`.
- Dateien mit Einstellungen, Warnungen, Logins: Modus `0600`.
- Nie gespeichert: `--no-sandbox`, `--share-new`.
- Kein Passwort in Link, QR-Code oder Datei im Klartext.
- Texte der Seite deutsch, Erklärungen ein bis zwei Sätze ohne Fachwörter.
- Standardwerte: Share aus, LAN aus (Port 8000), Webseiten an, Leerlauf 15 min, Modell Standard, Kursordner = Startordner, Teaching-Agent aus, Admin-Port 3000, Agent `claude`.
- `mcp.ts`-Anweisungen bleiben ≤ 2048 Zeichen (`check.js` prüft es); neue Regeln in Werkzeugbeschreibungen und `RULES` von `acp.ts`.
- Jede Aufgabe endet mit `npm run build && node src/check.js` → letzte Zeile `ok`.
- `check.js` startet das Gateway künftig mit `HOME=PROJECT` (Share-Datei und Ordnerauswahl liegen dann im Testordner) und darf kein Netz außer loopback brauchen.

## Review Focus

- Ein Kursordner-Wechsel, nach dem ein gleichnamiger Kurs im neuen Ordner liegt: ein Update darf die Kopie des Nutzers nicht ersetzen (Task 2 testet es).
- Share zweimal an/aus hintereinander: die Sperrdatei `share-<room>.pid` muss nach „aus“ weg sein, sonst sagt der nächste Start „wird schon geteilt“ (Task 3).
- LAN einschalten, wenn der Port belegt ist: Meldung auf der Seite, kein Absturz des Gateways (Task 3).
- Ordnerauswahl mit `..`, Symlink oder absolutem Pfad außerhalb von Home: abgelehnt (Task 4).
- `?user=` mit HTML darin: im Login-Formular escaped (Task 5).

---

### Task 1: Gespeicherte Konfiguration und kurzer Start

**Files:**
- Modify: `src/gateway.ts` (Typ `Options` Z. 38-48, Anfang von `gateway()`)
- Modify: `src/index.ts` (Block `if (argv.users)` Z. 58-130, Hilfe-Text)
- Modify: `src/share.ts` (Konstante der Share-Seite)
- Test: `src/check.js` (Gateway-Abschnitt ab „--- --users“)

**Interfaces:**
- Produces in `src/gateway.ts`:
  ```ts
  export type Config = {
    courses: string; kit: string | null; admin: number; agent: string
    models: { student?: string; author?: string }
    share: { on: boolean; page: string; web: string }
    lan: { on: boolean; port: number }
    web: boolean; idleMinutes: number
  }
  export function loadConfig(dir: string, given: Partial<Config>): Config // Standard ← DIR/.gateway.json ← given, schreibt das Ergebnis zurück (0600)
  gateway(o: { dir: string; given: Partial<Config>; sandbox: boolean; fresh: boolean })
  ```
  In `gateway()` heißt die Konfiguration `cfg` (veränderlich), `saveConfig()` schreibt sie. Alle bisherigen Zugriffe auf `o.courses`, `o.kit`, `o.admin`, `o.agent`, `o.models`, `o.lan` gehen über `cfg`.
- Produces in `src/share.ts`: `export const PAGE = 'https://liascript.github.io/share/'` (ersetzt `SHARE_PAGE` in `index.ts`).

- [ ] **Step 1: Test schreiben.** Im Gateway-Abschnitt: die Spawn-Funktion `gateway()` bekommt `env: { ...process.env, HOME: PROJECT }`. Nach dem bestehenden Neustart (`front2`) einen dritten Start nur mit `--users USERS --no-sandbox --agent <stub>` (ohne `-p`, `--courses`, `--kit`, `--lan`):
  ```js
  const saved = JSON.parse(fs.readFileSync(path.join(USERS, '.gateway.json'), 'utf8'))
  assert.strictEqual(fs.statSync(path.join(USERS, '.gateway.json')).mode & 0o777, 0o600, '.gateway.json for the owner only')
  assert.strictEqual(saved.admin, ADMIN, 'the port is kept')
  assert.ok(!('sandbox' in saved), '--no-sandbox is never saved')
  const page3 = (await request('GET', '/', { Host: ADM.Host }, undefined, ADMIN)).data
  assert.ok(page3.includes('<option>prolog</option>'), 'the course folder of the last start')
  ```
- [ ] **Step 2:** `npm run build && node src/check.js` → FAIL (keine `.gateway.json`).
- [ ] **Step 3: Umsetzen.** `index.ts` baut `given` nur aus angegebenen Flags (`--courses`, `--kit`, `-p/--port`, `--agent`, `--student-model`, `--author-model`, `--share [URL]` → `share: {on: true, page?}`, `--share-web`, `--lan [PORT]` → `lan: {on: true, port?}`) und ruft `gateway({ dir, given, sandbox: argv.sandbox !== false, fresh: !!argv['share-new'] })`. Fehlt `share.web`, ist es `otherOrigin(page)`. Nach dem Start öffnet das Gateway die Admin-Seite mit dem Paket `open` (schon Abhängigkeit), nur wenn `process.stdout.isTTY` (check.js läuft ohne TTY).
- [ ] **Step 4:** `npm run build && node src/check.js` → `ok`.
- [ ] **Step 5: Commit** `feat(gateway): settings kept in .gateway.json, a short start`.

### Task 2: Kurs eines Nutzers mit Pfad

**Files:**
- Modify: `src/gateway.ts` (Typ `User`, `updateCourse()` Z. 341-360, Aktionen `users`, `assign`, `update` in `adminRoute()`)
- Test: `src/check.js`

**Interfaces:**
- Produces: `User.source?: string` — absoluter Pfad des Kurses beim Zuweisen; `course` bleibt der Name für die Anzeige. `updateCourse()` synchronisiert gegen `source`, nie gegen `cfg.courses + course`.
- Migration beim Start: ein Nutzer mit `course` ohne `source` bekommt `source = path.join(cfg.courses, course)`, wenn der Ordner existiert, und `save()`.

- [ ] **Step 1: Test.** Nach dem Anlegen von `carl` mit `prolog`:
  ```js
  assert.strictEqual(JSON.parse(fs.readFileSync(usersFile, 'utf8')).carl.source, path.join(COURSES, 'prolog'), 'the path of the course')
  ```
  Später (nach Task 1 gibt es den dritten Start): einen zweiten Kursordner `kurse2/prolog/README.md` = `'# Fremd\n'` anlegen, den Kursordner per `POST /settings/courses` (Task 4) oder, solange es den nicht gibt, per Neustart mit `--courses kurse2` wechseln, `POST /update/carl`, `settled()`:
  ```js
  assert.ok(!carlFile('README.md').includes('Fremd'), 'an update follows the course carl got, not a course of the same name')
  ```
- [ ] **Step 2:** check → FAIL.
- [ ] **Step 3:** `source` beim Anlegen und `assign` setzen; `updateCourse()`, `update/all` und die Prüfung „hat einen Kurs“ auf `fs.existsSync(source)` umstellen.
- [ ] **Step 4:** check → `ok`.
- [ ] **Step 5: Commit** `fix(gateway): a user's course keeps its path`.

### Task 3: Share und LAN zur Laufzeit schalten

**Files:**
- Modify: `src/share.ts` (`share()`, `host()`, `claim()`)
- Modify: `src/gateway.ts` (Start von Share Z. 871, LAN-Server Z. 875-888, `adminRoute()`)
- Test: `src/check.js`

**Interfaces:**
- Produces in `src/share.ts`: `share(o: Options): { link: string; stop: () => void } | { holder: number }`. `stop()` schließt Signalling (`sig.close()`), alle Verbindungen und Timer und löscht die Sperrdatei, falls sie diesem Prozess gehört. `host()` liefert dafür eine Funktion zum Schließen.
- Produces in `src/gateway.ts`: `setShare(on: boolean, fresh = false): string` (Meldung), `setLan(on: boolean): Promise<string>` (Meldung; belegter Port → `'Port <n> ist belegt …'`, kein Wurf). `link` und `lanAddresses` werden dabei neu gesetzt. Routen: `POST /settings/share` (`on=1|0`), `POST /settings/share-new`, `POST /settings/lan` (`on=1|0`, optional `port`). Jede speichert `cfg`.

- [ ] **Step 1: Test.** In `check.js` die Signalling-Hilfe aus `checkShare()` auf oberste Ebene ziehen (`signallingServer(port)` und eine Seite, die `signaling.json` → `ws://127.0.0.1:4711` liefert) und im Gateway-Test nutzen:
  ```js
  await request('POST', '/settings/share', ADM, 'on=1', ADMIN)
  assert.ok((await request('GET', '/', { Host: ADM.Host }, undefined, ADMIN)).data.includes('#room='), 'share on: the link')
  await request('POST', '/settings/share', ADM, 'on=0', ADMIN)
  assert.ok(!fs.readdirSync(path.join(PROJECT, '.config', 'liascript')).some((f) => f.startsWith('share-')), 'share off: the lock is gone')
  await request('POST', '/settings/share', ADM, 'on=1', ADMIN) // a second time works
  await request('POST', '/settings/lan', ADM, 'on=0', ADMIN)
  await assert.rejects(request('GET', '/', {}, undefined, LAN), 'LAN off: nobody answers')
  await request('POST', '/settings/lan', ADM, 'on=1', ADMIN)
  assert.strictEqual((await request('GET', '/', { Host: '127.0.0.1:' + LAN }, undefined, LAN)).status, 200, 'LAN on again')
  await request('POST', '/settings/lan', ADM, 'on=0', ADMIN)
  const busy = http.createServer().listen(LAN)
  assert.ok(/belegt/.test(decodeURIComponent((await request('POST', '/settings/lan', ADM, 'on=1', ADMIN)).headers.location)), 'a busy port: a message, no crash')
  busy.close()
  assert.strictEqual((await request('GET', '/', { Host: ADM.Host }, undefined, ADMIN)).status, 200, 'the gateway still answers')
  ```
  Die Seite der Share-Option im Test: `--share http://127.0.0.1:4712/` beim ersten Start.
- [ ] **Step 2:** check → FAIL.
- [ ] **Step 3:** umsetzen; der LAN-Server wird in `setLan` erzeugt bzw. mit `close()` gestoppt (offene Verbindungen mit `closeAllConnections()`).
- [ ] **Step 4:** check → `ok`.
- [ ] **Step 5: Commit** `feat(gateway): share and LAN switched on the admin page`.

### Task 4: Einstellungen der Instanzen und Ordnerauswahl

**Files:**
- Modify: `src/gateway.ts` (`start()` Z. 242-292, Leerlauf-Timer Z. 858, `adminRoute()`)
- Test: `src/check.js`

**Interfaces:**
- Consumes: `cfg` aus Task 1.
- Produces: Routen `POST /settings/models` (`student`, `author` ∈ `'' | 'haiku' | 'sonnet' | 'opus'`), `POST /settings/web` (`on=1|0`), `POST /settings/idle` (`minutes`, ganzzahlig 5–240), `POST /settings/courses` und `POST /settings/kit` (`path`, `kit` auch leer = aus), `GET /folders?path=` → JSON `{ path, parent, folders: string[], courses: number }`.
- `start()` übergibt `--proxy off`, wenn `cfg.web === false`, und `ANTHROPIC_MODEL` aus `cfg.models[role]`. Der Leerlauf-Timer nutzt `cfg.idleMinutes`.
- Pfadprüfung `inHome(p: string): string | null` — `fs.realpathSync`, muss unter `fs.realpathSync(os.homedir())` liegen und ein Ordner sein.

- [ ] **Step 1: Test.**
  ```js
  const msg = async (url, body) => decodeURIComponent((await request('POST', url, ADM, body, ADMIN)).headers.location.split('m=')[1] || '')
  assert.ok(/nicht erlaubt|außerhalb/.test(await msg('/settings/courses', 'path=/etc')), 'a folder outside home')
  assert.ok(/nicht erlaubt|außerhalb/.test(await msg('/settings/courses', 'path=' + encodeURIComponent(PROJECT + '/../..'))), 'no way out with ..')
  fs.symlinkSync('/etc', path.join(PROJECT, 'etc-link'))
  assert.ok(/nicht erlaubt|außerhalb/.test(await msg('/settings/courses', 'path=' + encodeURIComponent(path.join(PROJECT, 'etc-link')))), 'no way out through a symlink')
  await msg('/settings/courses', 'path=' + encodeURIComponent(COURSES))
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(USERS, '.gateway.json'), 'utf8')).courses, COURSES)
  const folders = JSON.parse((await request('GET', '/folders?path=' + encodeURIComponent(PROJECT), { Host: ADM.Host }, undefined, ADMIN)).data)
  assert.ok(folders.folders.includes('kurse'), 'the folders below home')
  await msg('/settings/web', 'on=0')
  // anna logs in again, her new instance has no web pages
  assert.strictEqual((await request('GET', '/web?url=' + encodeURIComponent('https://example.org/'), { ...TAB, 'X-Lia-Token': token3 }, undefined, front3)).status, 404, 'web pages off')
  await msg('/settings/models', 'student=haiku&author=')
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(USERS, '.gateway.json'), 'utf8')).models.student, 'haiku')
  ```
  (`front3`, `token3`: Front und Login des dritten Starts aus Task 1; laufende Instanz vorher mit `POST /settings/web` beenden lassen, siehe Step 3.)
- [ ] **Step 2:** check → FAIL.
- [ ] **Step 3:** umsetzen. `web` und `models` beenden laufende Instanzen nicht; die Seite sagt „gilt ab dem nächsten Start eines Nutzers“. Im Test kommt `POST /settings/web` deshalb im dritten Start, bevor anna ihre erste Anfrage stellt: ihre Instanz startet erst danach.
- [ ] **Step 4:** check → `ok`.
- [ ] **Step 5: Commit** `feat(gateway): models, web pages, idle time and folders on the admin page`.

### Task 5: Links, QR-Codes, vorausgefüllter Name

**Files:**
- Modify: `package.json` (`qrcode-generator` in `dependencies`)
- Modify: `src/gateway.ts` (`login()` Z. 470, `rows()`, `adminPage()`)
- Modify: `share/lia-share.js` (Frame-Adresse in `dial()`/`dc.onopen`)
- Test: `src/check.js`

**Interfaces:**
- Produces: `qr(text: string): string` in `src/gateway.ts` — SVG (`qrcode-generator`, Fehlerkorrektur `M`, `createSvgTag`). `userLink(name: string, base: string): string` — Share: `link + '&user=' + name`; LAN: `base + '?user=' + name`.
- `login(res, base, message, user = '')` setzt `value="<esc(user)>"` im Namensfeld; `serve()` liest `user` aus der Query von `req.url`.
- `lia-share.js`: `frame.src = here + '/' + (link.get('user') ? '?user=' + encodeURIComponent(link.get('user')) : '')`.

- [ ] **Step 1: Test.**
  ```js
  const pre = await request('GET', '/?user=' + encodeURIComponent('<b>x'), TAB, undefined, front3)
  assert.ok(pre.data.includes('value="&#60;b&#62;x"'), 'the name from the link, escaped')
  const rowsQr = (await request('GET', '/rows', { Host: ADM.Host }, undefined, ADMIN)).data
  assert.ok(rowsQr.includes('<svg') && rowsQr.includes('user=anna'), 'a QR code and link per user')
  assert.ok(!/secret1/.test(rowsQr), 'no password in a link')
  ```
- [ ] **Step 2:** check → FAIL.
- [ ] **Step 3:** umsetzen; `npm install qrcode-generator`.
- [ ] **Step 4:** check → `ok`.
- [ ] **Step 5: Commit** `feat(gateway): links and QR codes per user, the name filled in`.

### Task 6: Warnungen, wenn die KI etwas ablehnt

**Files:**
- Modify: `src/acp.ts` (`permission()` Z. 251-275, `RULES` Z. 27-35)
- Modify: `src/mcp.ts` (Werkzeug `report_refusal` in `TOOLS`, nur wenn `process.env.LIA_GATEWAY`)
- Modify: `src/gateway.ts` (Ausgabe der Instanz in `start()` Z. 276, Warnungen speichern, `adminRoute()`)
- Create: `src/check-acp-stub.js` (ACP-Agent für Tests)
- Test: `src/check.js`

**Interfaces:**
- Zeile auf der Standardausgabe der Instanz (nicht stderr; der Agent selbst kann sie nicht schreiben, seine stdout ist die ACP-Leitung): `🚫 refused ` + JSON `{ by: 'server' | 'agent', what: string, reason: string }`, `what`/`reason` auf 300 Zeichen gekürzt. Eine Funktion `refused(by, what, reason): void` in `src/mcp.ts`, exportiert, von `acp.ts` genutzt.
- `report_refusal` Eingabe `{ what: string, reason: string }`, Ergebnis `{ reported: true }`. Beschreibung: wann aufrufen (eine Bitte, Befehle auszuführen, Dateien außerhalb des Kurses zu lesen, Geheimnisse zu zeigen oder Einstellungen zu ändern, abgelehnt), dass die Lehrkraft es sieht.
- `RULES` für `LIA_GATEWAY`: ein Satz „Whenever you refuse such a request, call report_refusal once with what was asked and why.“
- Gateway: `DIR/.class/warnings.jsonl` (`0600`), je Zeile `{ id, name, t, by, what, reason }`; `DIR/.class/warnings-done.json` = Liste erledigter ids. `POST /warnings/<id>/done`.
- `src/check-acp-stub.js`: antwortet `initialize` (`{protocolVersion: 1, agentCapabilities: {}}`), `session/new` (`{sessionId: 's1'}`); auf `session/prompt`: sendet `session/request_permission` mit `toolCall: {title: 'Bash: cat /etc/passwd'}` und Optionen `allow_once`/`reject_once`, ruft per HTTP-POST an die `url` aus `mcpServers` `tools/call` `report_refusal` `{what: 'read /etc/passwd', reason: 'outside the course'}`, sendet `session/update` mit `usage_update` `cost: {amount: 0.5, currency: 'USD'}`, dann `0.8`, und antwortet `{stopReason: 'end_turn'}`.

- [ ] **Step 1: Test.** Gateway-Starts im Test mit `--agent 'node <ROOT>/src/check-acp-stub.js'`. Nach Login von anna einen Chat schicken (`POST /agent` über die Front mit `X-Lia-Token`, `{type: 'chat', params: {text: 'hi'}}`), dann bis zu 10 s warten:
  ```js
  const warnings = fs.readFileSync(path.join(USERS, '.class', 'warnings.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
  assert.ok(warnings.some((w) => w.name === 'anna' && w.by === 'server' && /passwd/.test(w.what)), 'a refused permission')
  assert.ok(warnings.some((w) => w.name === 'anna' && w.by === 'agent' && /outside/.test(w.reason)), 'a refusal the agent reported')
  assert.ok((await request('GET', '/', { Host: ADM.Host }, undefined, ADMIN)).data.includes('passwd'), 'the admin page shows it')
  await request('POST', '/warnings/' + warnings[0].id + '/done', ADM, '', ADMIN)
  assert.ok(!(await request('GET', '/', { Host: ADM.Host }, undefined, ADMIN)).data.includes('cat /etc/passwd'), 'done: gone from the page')
  ```
  Und im MCP-Teil von `check.js`: `tools/list` enthält `report_refusal` nicht (kein `LIA_GATEWAY`).
- [ ] **Step 2:** check → FAIL.
- [ ] **Step 3:** umsetzen.
- [ ] **Step 4:** check → `ok`.
- [ ] **Step 5: Commit** `feat(gateway): warnings when the AI refuses something`.

### Task 7: Kosten je Tag

**Files:**
- Modify: `src/acp.ts` (Behandlung von `usage_update` Z. 182-187)
- Modify: `src/gateway.ts` (`costOf()` Z. 594, neuer Kosten-Kasten)
- Test: `src/check.js`

**Interfaces:**
- Produces: `.chats/.acp-days.json` im Nutzerordner, `{ 'YYYY-MM-DD': { [currency]: number } }` (Ortszeit-Datum). Jedes `usage_update` addiert die Differenz zur letzten Summe dieser Session; die Summe je Session in `.acp-costs.json` bleibt wie sie ist.
- Gateway: `daysOf(name: string): Record<string, Record<string, number>>`, `chart(days: Record<string, number>): string` (inline SVG, 7 Balken).

- [ ] **Step 1: Test** (nach dem Chat aus Task 6, der Stub schickt 0.5 und dann 0.8):
  ```js
  const days = JSON.parse(fs.readFileSync(path.join(USERS, 'anna', '.chats', '.acp-days.json'), 'utf8'))
  const today = Object.values(days).pop()
  assert.ok(Math.abs(today.USD - 0.8) < 1e-9, 'the day gets the difference, not every total')
  assert.ok(/0,80/.test((await request('GET', '/', { Host: ADM.Host }, undefined, ADMIN)).data), 'costs today on the admin page')
  ```
- [ ] **Step 2:** check → FAIL.
- [ ] **Step 3:** umsetzen.
- [ ] **Step 4:** check → `ok`.
- [ ] **Step 5: Commit** `feat(gateway): costs per day, a chart of the last 7 days`.

### Task 8: Seite nach Entwurf A, Doku, Share-Seite veröffentlichen

**Files:**
- Modify: `src/gateway.ts` (`adminPage()` Z. 671-715)
- Modify: `CLAUDE.md` (Abschnitt `src/gateway.ts`), `src/index.ts` (Hilfe zu `--users`)
- Modify: LiaScript/share (Kopie von `share/*`, eigener Commit dort)
- Test: `src/check.js`

**Interfaces:**
- Consumes: alles aus Task 1–7.
- Aufbau: oben drei Kästen (Zugang | Warnungen | Kosten), auf schmalen Bildschirmen untereinander; Nutzer-Tabelle mit kleinem QR-Code (Klick vergrößert), „Link kopieren“ (`navigator.clipboard.writeText`); Klassen-Chat; „Neuer Nutzer“ (nach Anlegen bzw. Passwort setzen: das Passwort einmal mit Kopier-Knopf zeigen); `<details>` „Einstellungen“ mit Erklärung je Option. Links mit `target="_blank" rel="noopener"`. LAN-Schalter mit Warnung „Passwörter gehen im Schulnetz unverschlüsselt“. „Neuer Link“ mit `confirm()`. Warnungen-Kasten nur mit offenen Warnungen sichtbar, rot.

- [ ] **Step 1: Test.**
  ```js
  const pageA = (await request('GET', '/', { Host: ADM.Host }, undefined, ADMIN)).data
  for (const t of ['Zugang', 'Kosten', 'Einstellungen', 'Link kopieren', 'unverschlüsselt']) assert.ok(pageA.includes(t), 'admin page: ' + t)
  assert.ok(!/<script[^>]*src=/.test(pageA), 'no external script')
  ```
- [ ] **Step 2:** check → FAIL.
- [ ] **Step 3:** Seite umbauen; einmal headless (Playwright, wie im Share-Test) bei 1200 px und 390 px Breite ansehen, keine waagerechte Scrollleiste bei 390 px.
- [ ] **Step 4:** check → `ok`; CLAUDE.md und Hilfe-Text aktualisieren.
- [ ] **Step 5: Commit** `feat(gateway): the admin page of design A`. Danach `share/*` nach LiaScript/share kopieren und dort pushen — **vorher die Nutzerin fragen**.
