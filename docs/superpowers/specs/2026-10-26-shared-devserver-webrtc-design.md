# Geteilter DevServer über WebRTC

## Context

Ein Lehrer lässt den DevServer bei sich auf localhost laufen und teilt ihn über WebRTC
mit mehreren Nutzern. Jeder Nutzer bekommt ein eigenes Verzeichnis und eine eigene
KI-Instanz: als Autor plant er Kurse und legt sie an, als Schüler lernt er mit dem
Material und dem Chat mit einer Lehrer-Persona. Ziel: Ein Lehrer teilt seine KI und seine
Kurse mit seinen Schülern, ohne dass Inhalte über fremde Server lesbar sind. Die
Entscheidungen unten stammen aus einem Grill-Interview, der erste Schritt ist ein
Tunnel-Spike.

## Entscheidungen

1. **KI**: zuerst Claude Code und Codex, allgemein mit API-Schlüssel, angesprochen über
   **ACP** (Agent Client Protocol, Adapter für beide existieren). Browser-Events werden
   Prompts der ACP-Session, `session/request_permission` geht an die Admin-Seite. Der
   DevServer `--mcp` der Instanz wird der Session als MCP-Server mitgegeben.
   `src/codex-bridge.js` wird später dadurch ersetzt.
2. **Sandbox**: Jeder Agent ist in seinem Verzeichnis eingesperrt, und das erzwingt das
   Betriebssystem. Gefährliches geht nur über Terminal oder Admin. Linux: bubblewrap
   (direkt aufrufen, keine Schnittstelle, bis eine zweite Plattform existiert). Windows muss folgen
   (Codex-Windows-Sandbox/AppContainer oder WSL2), **größtes offenes Risiko**.
3. **Transport**: WebRTC-DataChannel, Ende-zu-Ende (DTLS). Signaling über öffentliche
   Relays wie im LiaScript-Classroom (Trystero, Nostr/MQTT), öffentliches STUN, TURN
   nur als Fallback.
4. **Service-Worker-Tunnel**: Eine statische Verbinde-Seite auf GitHub Pages hält die
   RTCPeerConnection und lädt die heutige UI im iframe. Der Service Worker reicht jeden
   fetch per postMessage an die Seite und weiter über den Kanal. SSE wird als
   ReadableStream getunnelt, Live-Reload kommt als SSE-Nachricht statt WebSocket, der
   Web-Proxy entfällt remote (`--proxy off`).
5. **Prozess je Nutzer + Gateway** (Node): WebRTC-Host, Login, Routing auf die
   Instanz-Ports. `lib.ts` bleibt ein Nutzer pro Prozess.
6. **Material**: Kopie je Schüler als Git-Klon des Lehrerkurses (`src/git.ts`).
   Update = Pull mit Merge; bei Konflikt bleibt der Schülerstand, sein Agent hilft.
7. **Nutzer**: Admin-Seite nur auf localhost (anlegen, Rolle Autor/Schüler, Kurs
   zuweisen, Passwort zurücksetzen, Freigaben, wer ist online, Kosten je Nutzer sichtbar),
   `users.json` mit scrypt (Node `crypto`).
8. **Last**: Instanz (Agent + DevServer) startet beim Login und endet nach 15 min
   Leerlauf; der Chat geht über die gespeicherte Session und `read_chat` weiter. Bewusst
   kein Budget und keine Obergrenze gleichzeitiger Agenten.
9. **Einstieg**: Raum als Link-Parameter und QR-Code. Raum-ID lang und zufällig, im
   Fragment (`#room=…`), auf der Admin-Seite neu erzeugbar, Login-Versuche gedrosselt.

10. **Lehrer-Dashboard** (Teil der Admin-Seite, nur localhost) je Nutzer: online/offline,
    zuletzt aktiv, Agent läuft/schläft; Kurs, Folie, gelöste Quizze, rot bei `needsHelp()`;
    KI-Chat mitlesen (Schüler sehen beim Login einen Hinweis darauf); Kosten (Tokens/€)
    aus ACP. Das Gateway liest dafür den Event-Stream jeder Instanz
    (`/agent/events/<token>`, das Token übergibt es beim Start) und die `.chats/`-Dateien
    im Nutzerordner. Es braucht kein neues Protokoll zur Instanz.
11. **Nachrichten von Mensch zu Mensch** in einem eigenen Kanal: Reiter „Klasse“ im
    Chat-Panel neben dem KI-Chat, Rundruf des Lehrers zusätzlich als Banner. Kein
    Agent sieht diese Nachrichten. Sie leben im Gateway (über alle Nutzer hinweg,
    gespeichert als `class/messages.jsonl`). Der Tunnel leitet `/class/*` ans Gateway
    (eigener SSE-Stream + `POST`), alles andere an die Instanz des Nutzers.
12. **Regeln für Direktnachrichten**: standardmäßig aus, der Lehrer schaltet sie je
    Klasse/Gruppe frei. Alles wird gespeichert und ist für den Lehrer einsehbar
    (Hinweis für Schüler). Der Lehrer kann einzelne Nutzer stummschalten.

Annahmen: Ein Schüler-Agent startet mit der Persona aus `teacher:` im Kurskopf
(Lernenden-Ansicht), Autoren im heutigen Autorenmodus. Der Lehrer-Rechner muss laufen,
solange Schüler arbeiten.

## Befunde im Code, die der Tunnel lösen muss

- `origin` in `src/lib.ts:541` ist fest `http://<host>:<port>` und steckt in Redirects
  und Links (`lib.ts:718`, `:732`, `:1151`, `:406-418`). Ein entfernter Browser bekäme
  `http://localhost:3001/…` und würde seinen *eigenen* localhost fragen. → `lib.ts`
  braucht einen öffentlichen Origin je Request (Header `X-Lia-Origin` vom Gateway, sonst
  wie heute).
- Host-Prüfung (`lib.ts:553-562`) und Origin-Prüfung bei `POST /agent` / `/git`
  (`lib.ts:845`, `:1088`): Das Gateway setzt `Host` auf die Instanz und ersetzt `Origin`
  durch `http://<Host>`, erst *nach* eigener Authentifizierung der Sitzung.
- Live-Reload nutzt `ws` auf port+10000 (`reloadPort`, `lib.ts:1204`, `:646`) → remote
  als SSE-Nachricht `{reload: true}` über den vorhandenen Stream.
- Die Shell baut Pfade ab der Origin-Wurzel (`views/chat.js:227`, `:1755`,
  `views/agent.js:230`: `location.origin + '/' + file`). Ein Service Worker auf einer
  GitHub-Projektseite (`user.github.io/repo/`) kontrolliert aber nur `/repo/`. → Die
  Verbinde-Seite braucht **einen eigenen Origin** (eigene Org-Seite
  `<org>.github.io` oder eigene Domain), *nicht* `liascript.github.io`, sonst fängt der
  SW die ganze LiaScript-Seite ab.

## Meilenstein 1: Tunnel-Spike

Ein heutiger `liadev --mcp`-Server mit seinem Agenten wird über WebRTC an **einen**
entfernten Browser geteilt. Kein Gateway, keine Nutzer, kein ACP.

- `src/share.ts`: Trystero (`@trystero-p2p/nostr`) mit `werift` als RTCPeerConnection.
  `node-datachannel` fiel durch: Das Signaling lief, die Verbindung kam zwischen zwei
  Node-Peers nie zustande; mit `werift` steht sie in rund 1 s. Trystero stückelt und
  wartet auf den Kanal selbst. Aktionen `hello` (wer ist Host), `req` (Metadaten, bei
  Body binär mit Metadaten), `res` (Kopf, Stücke, Ende/Fehler), `abort`. `fetch` an
  den lokalen Server mit `redirect: 'manual'`, `Origin` = lokaler Server,
  `X-Lia-Origin` = Seite, `Sec-Fetch-Dest` = `request.destination`.
- `share/` (statisch, ohne Build): `index.html`, `lia-share.js` (Trystero als ESM von
  jsDelivr, Raum und Schlüssel aus `#room=…&key=…`, die UI im iframe auf `/`),
  `lia-share-sw.js` (fetch → MessageChannel → Seite, Antwort als `ReadableStream`;
  die Dateinamen tragen ein Präfix, alles andere geht in den Tunnel).
- `src/lib.ts`: `originOf(req)` für `/`, Listing und `.md`-Redirect; `/` führt im
  Agentenmodus ohne Kurs direkt auf `chat.html?/home`; `get_state.share` ist der Link.
- `src/index.ts`: `--share [URL der Seite]` lädt `share.ts` erst dann (an Parcel vorbei,
  das jedes `require(` an den Anfang zieht). `npm run lib` mit `--types node`: `werift`
  bringt über `mediabunny` WebCodecs-Typen mit, die mit `lib.dom` kollidieren.

Weggelassen im Spike: Live-Reload remote (Schüler editieren nicht; kommt mit entfernten
Autoren, dann als SSE-Nachricht), QR-Code (kommt mit der Admin-Seite, im Browser
gerendert), eigener parcel-Target.

**Ergebnis (2026-10-26, Chromium über Playwright, Seite auf `localhost:8080`):** Kurs
und Chat-Shell laden durch den Tunnel, `get_state` meldet `connected`/`chat`, eine
Nachricht des Agenten kommt über SSE an, die Antwort des Nutzers als `chat`-Event (die
Origin-Prüfung von `POST /agent` greift).

**Nachtrag (2026-10-26):** Raum und Schlüssel bleiben je Projektordner in
`~/.config/liascript/share.json`, bis `--share-new` einen neuen Link erzeugt; nach einem
Neustart des Hosts verbindet sich ein offener Tab von selbst wieder. Live-Reload geht
über den Event-Stream (`{reload: true}` an entfernte Clients). Web-Seiten (`--proxy read`)
laufen über eine zweite Origin der Share-Seite (`web=`, Relay-iframe), getestet mit
`goto({url})`, Link-Klick und `run_in_page`. Für GitHub Pages heißt das: **zwei** eigene
Origins (z. B. zwei Org-Seiten oder Domain + Subdomain). `--proxy full` und die
Browser-Erweiterung gehen nicht durch den Tunnel. Ungeprüft: Handy im Mobilfunknetz (TURN, `turn` in `share.json`), Firefox,
`pkg`-Binaries mit `werift`, Abbruch beim Schließen des Tabs.

**Veröffentlicht (2026-10-26):** `LiaScript/share` → https://liascript.github.io/share/
(Default von `--share`). Abweichend von oben liegt die Seite in einem Unterordner der
LiaScript-Origin: Server und UI arbeiten deshalb mit einem Präfix (`X-Lia-Origin` mit
Pfad, `BASE`/`base__` im Client, der Service Worker entfernt es). Kurscode lief auf
dieser Origin schon immer, das ist kein neues Risiko. Webseiten im Chat sind über diese
Seite aus, bis eine zweite Origin existiert. Getestet: Chromium über
liascript.github.io/share, Kurs, Chat, Zustand beim Agenten.

### Verifikation

1. `npm run build`, `node src/check.js` bleibt grün (lokaler Betrieb unverändert).
2. Lokal: `share/` von einem zweiten Origin ausliefern (z. B. `http://127.0.0.1:8080`,
   simuliert GitHub Pages), `liadev --mcp --share` starten, Link in einem zweiten
   Browserprofil öffnen (vorher ankündigen, Fenster danach schließen). Prüfen: Kurs
   rendert, Folienwechsel kommt in `get_state` an, Chat hin und zurück mit dem Agenten,
   Quiz als `activity`.
3. Echt: Handy im Mobilfunknetz über die GitHub-Pages-Seite (NAT, ggf. TURN).

## Meilenstein 1b: Agent im Server (`--agent`)

`liadev --agent claude` startet den Agenten per ACP selbst (`src/acp.ts`), die Werkzeuge
kommen über MCP per HTTP aus demselben Prozess (`serveHttp()` in `mcp.ts`). Getestet
(2026-10-26, Claude über `@agentclientprotocol/claude-agent-acp@0.96.0`): Antwort im
Chat mit eigener Persona („Kursassistent“), Gedächtnis über mehrere Nachrichten, Hinweis
nach dem dritten falschen Quizversuch (`help`), Fortsetzung nach Neustart per
`session/load`. Systemdateien und Shell-Befehle lehnt der Agent nach den Host-Regeln
selbst ab. Ungetestet: Codex und Gemini, das Freigabe-Formular im Chat.

## Meilenstein 2: Gateway (`--users`)

`liadev --users ./klasse --share` (`src/gateway.ts`): Login über den Share-Link, pro
Nutzer ein DevServer mit Agent in `./klasse/<name>`, Ende nach 15 min ohne offenen Tab,
Admin-Seite auf localhost mit Dashboard (online, Kurs/Folie, „Braucht Hilfe“, Chat
mitlesen). Getestet (2026-10-26, Chromium, Seite lokal unter `/share/`): falsches
Passwort, Login, Tutor in der Schülerrolle, Hilfe-Markierung im Dashboard, zwei Logins in
zwei Tabs eines Browsers sauber getrennt (vorher ein Fehler: der Service Worker gab alle
Anfragen an den ersten Share-Tab, jetzt `tab-<id>` im Pfad). `check.js` prüft Login,
Sperre und Weiterleitung. Abweichungen vom Plan: Kurs wird kopiert statt geklont (Updates
per Git kommen später), Kosten je Nutzer fehlen im Dashboard noch, Klassenkanal (3b) und
Sandbox (2) stehen aus. **Vor echten Schülern:** Die Agenten laufen mit dem Konto des
Lehrers; Freigaben lehnt das Gateway zwar ab, aber Erlaubnis-Regeln in
`~/.claude/settings.json` des Lehrers gelten auch für die Agenten der Schüler.

## Danach (je eigener Plan)

2. Sandbox-Spike: Claude Code und Codex per ACP in bubblewrap; `~/.ssh` unerreichbar,
   Agent arbeitet trotzdem. Danach die Windows-Variante.
3. Gateway: Login, `users.json`, Instanz je Nutzer mit Leerlauf-Ende, Routing,
   Admin-Seite mit Dashboard (online, Folie, Quizze, Hilfe, Chat mitlesen).
3b. Klassenkanal: Rundruf, Direktnachrichten mit Freischaltung, Stummschalten, Reiter
   „Klasse“ in `views/chat.js`, Banner.
4. ACP-Host ersetzt den Terminal-Agenten: Events → Prompts, Freigaben → Admin-Seite.
5. Schülerkopien per Git, Persona aus dem Kurskopf, Updates mit Merge.
6. Windows-Sandbox, Paketierung (`pkg`-Binaries, native Module).
