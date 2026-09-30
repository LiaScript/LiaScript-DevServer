# Agent-Bridge: MCP-Tools, Push-Events und Chat-Overlay für den LiaScript-DevServer

Stand: 2026-09-18 · Branch `feature/agent-bridge`

## 1. Ziel

Der DevServer wird zur Brücke zwischen der Kurs-Vorschau im Browser und einem KI-Agenten auf demselben Rechner
(Claude Code, Codex, Gemini CLI …):

1. **MCP-Tools** — welcher Kurs ist offen, welche Folie, was ist markiert; Folie wechseln; anderen Kurs laden.
2. **Push-Events** — ein Klick auf einen speziellen Link im Kurs löst ein Kommando beim Agenten aus, ohne Polling.
   Die Nachricht steckt im Link. Das Protokoll ist klein und erweiterbar (später eigene Agenten mit Kommandos).
3. **Chat-Overlay** — Chat über dem Kurs; der Kurs läuft im iframe, damit ein Hard-Reload den Chat nicht zerstört.
   Markdown + Mermaid, dazu Buttons, Radio-Buttons und Checkboxen, deren Auswahl an die KI zurückgeht.

Aktiviert wird alles über das CLI-Flag `--mcp`. Ohne das Flag verhält sich der Server wie bisher.
Zielgruppe sind Autoren (Agent ändert Kursdateien) und Lernende (Agent als Tutor).

## 2. Recherche: Wie erreicht ein Browser-Klick den Agenten ohne Polling?

### 2.1 Kernaussage

**Ein MCP-Server kann das Modell nicht von sich aus handeln lassen.** Alle Notifications der Spezifikation
(`tools/list_changed`, `resources/updated`, `progress`, `message`) sind an den *Client* adressiert; kein verbreiteter
Client macht daraus einen Modell-Turn. Codex belegt das im Quelltext: jeder Notification-Handler ist ein Log-Aufruf
([logging_client_handler.rs](https://github.com/openai/codex/blob/main/codex-rs/rmcp-client/src/logging_client_handler.rs)).
Die MCP-Revision 2026-07-28 verschärft das: stateless, server-initiierte Requests entfallen zugunsten von
Multi-Round-Trip-Requests, Sampling ist deprecated
([Changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)).

Push gibt es also nur über eine Hersteller-Erweiterung oder indem man selbst der Client/Host des Agenten ist.

### 2.2 Claude Code

| Mechanismus | Push | in interaktiver Session | bidirektional | Status | Einschränkung |
|---|---|---|---|---|---|
| **Channels** | ja | ja | ja (normale MCP-Tools als Reply) | Research Preview ab 2.1.80 | nur stdio; Start mit `--dangerously-load-development-channels server:<name>`; claude.ai-Login oder Console-Key; Team/Enterprise: Owner muss freischalten |
| Blockierendes Tool (`wait_for_event`) | Long-Poll | ja | Tool-Call | GA | 30 min Idle-Limit (stdio), nach 2 min Auto-Background |
| MCP-Notifications | erreichen nur den Client | – | nein | GA | – |
| MCP-Elicitation | nur während eines Tool-Calls | ja | Server → Nutzer → Server | GA | Dialog erscheint im Terminal, nicht im Browser |
| Hooks (`http`, `additionalContext`, `asyncRewake`) | nein, feuern nur auf Claude-Code-Ereignisse | ja | nur Kontext hinein | GA | von außen nicht auslösbar |
| Monitor-Tool | ja, jede Zeile = neuer Turn | ja | nur hinein | GA | Deadline 5 min Standard / 30 min max, danach neu starten |
| **Agent SDK**, Streaming-Input | ja | Host *ist* die Session | voll, inkl. AskUserQuestion im eigenen UI | GA | nur Claude; für Weitergabe an Dritte API-Key nötig |
| MCP Apps (`ui://`) | – | wird von Claude Code nicht gerendert | – | Extension stabil | falsche Oberfläche |

Quellen: [channels](https://code.claude.com/docs/en/channels) ·
[channels-reference](https://code.claude.com/docs/en/channels-reference) ·
[mcp](https://code.claude.com/docs/en/mcp) · [hooks](https://code.claude.com/docs/en/hooks) ·
[tools-reference](https://code.claude.com/docs/en/tools-reference) ·
[agent-sdk/streaming-vs-single-mode](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) ·
[agent-sdk/user-input](https://code.claude.com/docs/en/agent-sdk/user-input) ·
[agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview)

**Channel-Vertrag** (vollständig, mehr braucht es nicht):

- Capability `experimental: { 'claude/channel': {} }`; optional ein `instructions`-String, den Claude beim
  Verbinden als Kontext erhält.
- Event: Notification `notifications/claude/channel` mit `params: { content: string, meta: Record<string,string> }`.
  Das Modell sieht `<channel source="<servername>" key="value" …>content</channel>`.
  **Meta-Keys nur `[A-Za-z0-9_]`** — Keys mit Bindestrich werden still verworfen.
- Ist Claude beschäftigt, werden Events gequeued und im nächsten Turn gemeinsam geliefert. Ohne registrierte
  Session werden sie still verworfen, ohne Fehler an den Server.
- Ein Channel-Server, der die Protokoll-Revision 2026-07-28 aushandelt, wird nicht als Channel registriert.
- `experimental['claude/channel/permission']` würde Tool-Freigaben über den Channel erlauben — **nie deklarieren**,
  sonst kann Browser-Inhalt Tool-Nutzung genehmigen.
- Nicht dokumentiert: ob Channels in der VS-Code-Extension funktionieren. Alle Beispiele sind Terminal-CLI.
  **Nachtrag (geprüft mit Extension 2.1.276):** in der Chat-Oberfläche der Extension nicht. Die mitgelieferte Binary
  im stream-json-Modus der Extension plus Flag registriert keinen Channel (weder „registered" noch „gate says skip"
  im Debug-Log), Channel-Code und Bestätigungsdialog gehören zur Terminal-Oberfläche.

Vorbild: das offizielle Plugin
[fakechat](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat) —
localhost-Chat-UI ↔ Session über Channel + `reply`-Tool in einer Datei.

### 2.3 Codex CLI

- MCP-Client über stdio und Streamable HTTP; Konfiguration in `~/.codex/config.toml` unter `[mcp_servers.<name>]`
  ([Doku](https://learn.chatgpt.com/docs/extend/mcp),
  [Config-Referenz](https://learn.chatgpt.com/docs/config-file/config-reference)).
- **`tool_timeout_sec` Standard 60 s**, `startup_timeout_sec` 10 s → für blockierende Tools pro Server hochsetzen.
- Elicitation im Formular-Modus wird unterstützt; URL-Modus teilweise.
- Kein Push in eine laufende TUI-Session. Als Subprozess steuerbar über `codex exec --json`,
  [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) (`runStreamed`, `resumeThread`) und
  [`codex app-server`](https://learn.chatgpt.com/docs/app-server) (JSON-RPC; `turn/start`, `turn/steer` in einen
  laufenden Turn, Approval-Requests). `codex mcp-server` wurde entfernt
  ([PR #42993](https://github.com/openai/codex/pull/42993)).

### 2.4 Agent Client Protocol (ACP)

Herstellerneutraler Standard ([agentclientprotocol.com](https://agentclientprotocol.com/), v1 stabil, TypeScript-SDK
[`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk)). JSON-RPC über stdio; der
**Client** startet den Agenten und

- übergibt MCP-Server in `session/new.mcpServers[]`,
- schickt Nutzereingaben als `session/prompt`,
- erhält Streaming über `session/update` (`agent_message_chunk`, `tool_call`, `plan` …),
- beantwortet `session/request_permission` und
  [`elicitation/create`](https://agentclientprotocol.com/protocol/v1/elicitation) — flaches JSON-Schema:
  `enum` → Radio, `boolean` → Checkbox, Array-of-enum → Checkbox-Gruppe.

Agenten: `gemini --acp`, `@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`,
`copilot --acp`, `cursor-agent acp`, OpenCode, Goose, Cline u. v. m.
([Liste](https://agentclientprotocol.com/get-started/agents)). Einschränkung v1: keine Injektion mitten im Turn —
ein Klick während der Agent arbeitet wird gequeued oder verlangt `session/cancel`.

### 2.5 Weitere

- **OpenCode** `opencode serve`: HTTP + SSE, `POST /session/:id/prompt_async` ist echtes Push
  ([Doku](https://opencode.ai/docs/server/)). Ein Hersteller.
- **Blockierendes Tool**: verbreitete Notlösung (z. B. `interactive-mcp`, `ask-user-questions-mcp`), wird mit der
  [Tasks-Extension](https://modelcontextprotocol.io/extensions/tasks/overview) aus MCP herausdesignt. Fallstricke:
  Client-Timeouts, der Agent muss selbst in der Schleife bleiben, doppelte Waiter nach Cancel
  ([Waiting Is Not a Tool Call](https://dev.to/donk8r/waiting-is-not-a-tool-call-making-an-mcp-servers-shell-event-driven-3nag)).
- **MCP Apps** (`ui://`): gerendert von Claude web/Desktop, VS Code Copilot, Goose, Cursor, ChatGPT — von keinem
  Terminal-Agenten ([Client-Matrix](https://modelcontextprotocol.io/extensions/client-matrix)). Löst „Server liefert
  UI in fremdes Chatfenster", nicht „meine Seite spricht mit dem Agenten".
- Vorbilder für einen späteren Host-Modus: [acp-to-agui](https://github.com/namanrajpal/acp-to-agui),
  [agent-bridge](https://github.com/xiaohuzai/agent-bridge), [acp-components](https://github.com/zvzuola/acp-components).

### 2.6 Entscheidung

Zuerst `--mcp`: Tools für alle Agenten, Push und Chat über Claude-Code-Channels, `wait_for_event` als Fallback für
Agenten ohne Channels. Der ACP-Host-Modus folgt später (Abschnitt 8) und nutzt dasselbe Browser-Protokoll.

**Nachtrag:** Weil Channels in der Chat-Oberfläche der VS-Code-Extension nicht ankommen, ist das Monitor-Tool der
zweite Push-Weg für Claude Code. `GET /agent/events/<token>` liefert jedes Event als JSON-Zeile, der Agent startet
`curl -sN <get_state.events>` im Monitor. Geprüft in der Extension: Events kommen mitten im Turn an und wecken eine
ruhende Session. Solange jemand zuhört (`get_state.watched`), blockieren Formulare nicht, die Antwort kommt als
`answer`-Event. Grenzen: ein Monitor läuft höchstens 30 min und muss dann neu gestartet werden; nur Claude Code.

## 3. Befunde aus Code und Player-Bundle

- Der Transport existiert bereits: SSE-Fan-out (`clients[]`, `eventsHandler`, `gotoLine()`), `POST /lineGoto`,
  globales `bodyParser.json()`. Client-Code gelangt ausschließlich über `gotoScript` in den Player (`</head>`-Replace
  in `GET /liascript/index.html`). `filename__` darin ist der projekt-relative Kurspfad.
- **`agent:`-hrefs werden vom Player umgeschrieben.** Der Link-Parser hat eine Schema-Whitelist (`https http data
  file hyper dat ipfs ipns blob mailto tel sms geo webcal sip sips ftp ftps magnet bitcoin matrix`, dazu `#…`);
  alles andere wird `base + url`. Aus `agent:tutor/explain` wird `http://localhost:3000/agent:tutor/explain`, mit
  `target="_blank"` und ggf. `<preview-link>`-Wrapper. `data-*`-Attribute aus Inline-HTML oder Attribut-Kommentaren
  kommen unverändert im DOM an. → Der Klick-Handler sucht `agent:` im Attributwert.
  **Nachtrag 2026-09-30:** Seit LiaScript 2.1.0 steht `agent` in der Whitelist, der href bleibt wie geschrieben
  (weiterhin mit `target="_blank"`). Der Handler prüft nur noch, ob der Wert mit `agent:` beginnt.
- **`LIA.goto(n)` (0-basiert) hat einen veralteten Dedup-Guard**: `let p=-1; goto = e => { e!==p && (p=e, …) }`
  vergleicht mit dem zuletzt *angeforderten* Index, nicht mit der aktuellen Folie. `goto(3)`, Nutzer blättert weg,
  `goto(3)` = stiller No-op. → Navigation über `location.hash = '#'+n` (1-basiert wie die URL).
- Folienwechsel laufen über `history.pushState`, es feuert also kein `hashchange`; `document.title` wird erst
  danach gesetzt. → Vier Trigger für ein entprelltes `report()`: pushState-Patch, `hashchange`, `selectionchange`,
  `MutationObserver` auf `<title>`.
- Der Player installiert seine `window.LIA.*`-Stubs nur mit `if (!window.LIA[e])` — vorab gesetzte Hooks gewinnen.
- Kein Frame-Busting im Bundle, keine CSP/X-Frame-Options im Server → same-origin iframe funktioniert.
- `reload@3.4.2` nutzt `ws` auf `port+10000` (nicht socket.io) und macht `window.location.reload()` der Player-Seite;
  im iframe bleibt die äußere Seite erhalten.
- **MCP-SDK lohnt nicht**: 17 Dependencies inkl. zweitem Express (v5); das in der CI global installierte `pkg`
  ignoriert die `exports`-Map; `engines` müsste auf Node 18; ein SDK-Update könnte 2026-07-28 aushandeln und damit
  Channels still abschalten. → Zero-Dependency-JSON-RPC über `readline`; das genutzte Subset ist seit 2024-11-05
  stabil. Parcel lässt `node_modules` extern, `src/mcp.ts` wird einfach mitgebündelt.

## 4. Architektur

```
Kurs (Player, im iframe ab Phase 3)          Shell /liascript/chat.html (Phase 3)
   │ injiziertes agentScript                     │ Chat-UI
   │  POST /agent  {type,agent,cmd,params,context}   ▲ SSE /gotoLine  {goto:…} | {chat:…}
   ▼                                             │
src/lib.ts  ── bus (EventEmitter), getState(), send() ──  MCP-agnostisch, auch für Library-Nutzer
   ▲
src/mcp.ts  ── stdio JSON-RPC: Tools + notifications/claude/channel   (nur von src/index.ts bei --mcp geladen)
   ▲
Claude Code / Codex / Gemini …  starten  `liadev --mcp -l -i README.md`  aus ihrer MCP-Konfiguration
```

Ein Prozess ist Express **und** MCP-Server über stdio (Channels verlangen stdio). Im `--mcp`-Modus gehört stdout
dem Protokoll; `console.log` wird auf stderr umgelenkt.

## 5. Protokoll

### 5.1 Envelope (Browser → Server → Agent)

```json
{ "type": "command" | "chat" | "answer" | "state",
  "agent": "tutor", "cmd": "explain", "params": { "level": "easy" },
  "context": { "file": "README.md", "slide": 3, "title": "…", "selection": "…" } }
```

- `state` aktualisiert nur den gecachten Zustand und wird nicht an den Agenten weitergereicht.
- Der Server hängt den gecachten Zustand als `context` an jedes weitergereichte Event.
- `connection` (`params: {connected, chat}`) erzeugt der Server selbst, wenn sich `connected` oder `chat` ändert
  und die Änderung 2 s Bestand hat (F5 und Live-Reload zählen nicht). Ein wartendes `chat`-Formular endet dann mit
  `{disconnected:true}`; der Agent soll darauf nicht mit `goto`/`chat` den Browser neu öffnen.
- Erweitern heißt: neuer `type` oder neues `cmd`. Unbekannte Typen beantwortet der Server mit 400.

### 5.2 Kurs-Syntax

`agent:<agent>/<cmd>?<params>` — geparst mit `new URL()`. Leerer `agent` = der Haupt-Agent.
`agent://<agent>/<cmd>?<params>` wird genauso gelesen: die Handler streichen die Schrägstriche vor dem Parsen.

```markdown
[Erkläre das einfacher](agent:tutor/explain?level=easy)

<button data-agent="agent:author/rewrite?tone=kurz">Abschnitt kürzen</button>

[Übung](#)<!-- data-agent="agent:tutor/exercise?n=3" -->
```

Außerhalb des DevServers ist der reine Link ein toter Link (der Browser kennt das Schema nicht); die
`data-agent`-Form bleibt wirkungslos. LiaScript führt `agent` seit 2.1.0 in seiner Schema-Whitelist, die hrefs
bleiben also unverändert.

**Kein Standard, ein Namensvetter.** Für Links in einem Dokument, die einen lokalen Agenten anstoßen, gibt es
keinen Standard (Stand September 2026). MCP Apps (`ui://`) und A2UI/AG-UI sprechen per JSON-RPC bzw.
deklarativem JSON mit dem Host, kein Link-Schema, kein Markdown. Der IETF-Entwurf
[draft-narvaneni-agent-uri](https://datatracker.ietf.org/doc/draft-narvaneni-agent-uri/) (individuell, ohne
IETF-Status) benutzt denselben Schema-Namen mit `agent://<authority>/<agent>/<skill>?<params>` zur Adressierung
entfernter Agenten; Authority ist ein DNS-Name oder eine DID. Unsere Form ohne `//` ist strukturell sein Vorbild
(Pfad = Agent/Kommando, Query = Parameter), aber `agent://tutor/explain` hieße dort etwas anderes, und `new URL()`
läse `tutor` als Host. Entscheidung: `agent:<agent>/<cmd>?<params>` bleibt die dokumentierte Form. Seit 2026-09-30
nehmen die Handler auch `agent://tutor/explain` an und lesen `tutor` als Agentennamen, vorher ging der Name dabei
still verloren. Sollte der Entwurf `agent` bei der IANA registrieren, ist der Ausweg ein eigenes Schema (etwa
`lia:`).

### 5.3 Tools (Folien 1-basiert wie `#n` in der URL)

| Tool | Argumente | Ergebnis |
|---|---|---|
| `get_state` | – | `{url, root, file, slide, title, selection, connected}` |
| `goto` | `{file?, slide?, line?}` | Zustand nach der Navigation; öffnet den Browser, wenn keiner verbunden ist |
| `wait_for_event` | `{timeout_s?}` (Standard 50) | nächstes Event oder `{timeout:true}` — nur für Agenten ohne Channels |
| `chat` | `{markdown, inputs?}` | ohne `inputs` sofort `{sent:true}`; mit `inputs` blockiert bis zur Antwort: `{values}`, `{dismissed:true, text}` oder `{disconnected:true}` |

`inputs`: `[{id, type: 'buttons'|'radio'|'checkbox', label?, options: string[]}]`.

**Nachtrag 2026-09-30, Screenshots und Konsole:** bewusst keine Tools der Bridge. Seiten-JavaScript hat keine
saubere Screenshot-API, und Playwright-MCP wie Chrome-DevTools-MCP können das bereits. Beide steuern aber einen
eigenen Browser und können sich nicht an den des Nutzers hängen. Deshalb legen die `instructions` fest, wo die
Vorschau aufgeht: (1) ist ein Tab verbunden, wird er benutzt, nie ein zweiter geöffnet, zwei Tabs überschreiben
sich den Zustand; (2) ist nichts verbunden und der Agent hat Browser-Werkzeuge mit sichtbarem Fenster, öffnet er
`get_state.url` dort vor dem ersten `goto` oder `chat`; (3) sonst öffnet `goto` den Standardbrowser. Eine Option,
die `goto` das Öffnen verbietet, wird erst gebaut, wenn Agenten den Hinweis ignorieren.

**Nachtrag 2026-09-30, Längengrenze und Sprachausgabe:** Claude Code kürzt `instructions` auf 2048 Zeichen
(`CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`, im Client 2.1.285 nachgesehen) und misst jede Tool-Beschreibung gegen
dieselbe Grenze. Der Text war auf 3193 Zeichen gewachsen, Sicherheitsabsatz und Ereigniswege kamen nicht mehr an.
Jetzt: Regeln zuerst, Details in Tool-Beschreibungen und Tool-Ergebnisse, `src/check.js` prüft beide Längen.
Sprachausgabe ist so ein Detail: Das injizierte Skript meldet die Zahl der `speechSynthesis`-Stimmen und
`navigator.webdriver`; `get_state` liefert `voices` und nur bei null Stimmen ohne `--responsiveVoice` einen Eintrag
`tts` mit Ursache und Abhilfe für den erkannten Browser. Ferngesteuertes Chrome ist stumm, weil Playwright und
Puppeteer es mit `--disable-component-extensions-with-background-pages` starten. Der Agent ändert nichts ohne
Zustimmung des Nutzers.

### 5.4 Channel-Abbildung

`content` = Envelope als JSON, `<` als `<` escaped (Seitentext kann das `<channel>`-Tag nicht schließen);
`meta` = `{type, agent, cmd}` ohne leere Werte. Der `instructions`-Text erklärt dem Modell Envelope, Rollen-Delegation
über `agent` und die Vertrauensgrenze (Abschnitt 7).

## 6. Phasen

1. **`--mcp`, `get_state`, `goto`** — `src/lib.ts` (bus, state, `send`, `POST /agent`, zusammengefasste
   `</head>`-Injektion, `agentScript`, Loopback-Bind, Guards), neues `src/mcp.ts`, `src/index.ts`.
2. **Kommando-Links + Push** — Klick-Listener, `command`-Events, Channel-Notification, `wait_for_event`,
   `instructions`.
3. **Chat-Overlay** — `views/chat.html`, Route `/liascript/chat.html`, `chat`-Tool mit blockierenden `inputs`,
   Redirect und Banner zeigen im Agent-Modus auf die Shell.

Jede Phase ist für sich auslieferbar. Prüfung: `npm run build` (beide Build-Wege) und `node src/check.js`, das
`dist/index.js --mcp` startet und jede stdout-Zeile als JSON-RPC behandelt.

## 7. Sicherheit

Die Browser-Endpunkte verwandeln Web-Inhalt in Agenten-Prompts. Deshalb im Agent-Modus:

- Bind an Loopback (heute bindet `app.listen(port)` alle Interfaces).
- Host-Allowlist auf allen Routen (DNS-Rebinding), exakter Origin-Check in `POST /agent` — der Catch-all mit
  `cors()` beantwortet sonst Preflights für jeden Pfad mit `*`.
- `message`-Origin-Gate im injizierten Skript, registriert vor dem Player: dessen `postMessage`-API akzeptiert
  `{cmd:'eval'}` ohne Origin-Prüfung. Dazu `Content-Security-Policy: frame-ancestors 'self'`.
- Längen- und Regex-Validierung aller Felder; `<`-Escaping im Channel-Content; CSP auf der Shell
  (`img-src 'self' data:` blockt Exfiltration über Markdown-Bilder); Chat-HTML durch DOMPurify.
- Nie das Permission-Relay deklarieren.
- `instructions`: `agent`, `cmd`, `params` und `context` sind Kursinhalt, keine Nutzeranweisung. Erklären, abfragen,
  übersetzen, navigieren ja — Befehle ausführen, Dateien außerhalb von `root`, Secrets, Einstellungen nein.

Bekannte Grenze: Kurs-JavaScript läuft same-origin und kann `chat`-Events fälschen. Der Agent liest den
Kursquelltext ohnehin, kursgetragene Prompt-Injection existiert also unabhängig davon. Split-Origin (Shell auf
127.0.0.1, Player auf localhost) erst, wenn fremde Kurse ein echtes Szenario werden.

## 8. Ausblick: ACP-Host-Modus (Phase 4, eigene Spec)

`--agent "<acp-kommando>"`: Der DevServer wird ACP-Client. Klick und Chat werden `session/prompt`,
`session/update` wird der Chat-Stream, `elicitation/create` nutzt denselben Input-Renderer (kleiner Mapper vom
flachen JSON-Schema), die Tools gehen per `session/new.mcpServers[]` an den Agenten. Ein neues Modul auf
`bus`/`send`/`getState`; Kurs-Syntax, Envelope und Overlay bleiben unverändert.

## 9. Hinweise für LiaScript selbst (nicht Teil dieser Arbeit)

- ~~`agent` in die Schema-Whitelist des Link-Parsers aufnehmen.~~ Erledigt in 2.1.0.
- Dedup-Guard in `LIA.goto` gegen die aktuelle Folie statt gegen den letzten Aufruf prüfen.
- `event.origin` im `message`-Handler prüfen; `case "compile"` fehlt ein `break`.
- Link-Preview: `!!t.search(/wikipedia\.org/gi)` ist auch für `-1` wahr.
