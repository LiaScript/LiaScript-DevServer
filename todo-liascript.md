# LiaScript-MCP-Chat (liadev 1.2.18): Status alter Punkte und neue Befunde

Punkte aus dem ersten Tandem-Test (`../test/MCP-CHAT-VERBESSERUNGEN.md`) mit Status im neuen DevServer. „Laut Doku“ heißt: Die Tool-Beschreibung des neuen MCP nennt die Funktion, im Test ist sie aber noch nicht beobachtet.

Status: ✅ im Test bestätigt · 🟡 laut Doku behoben, zu prüfen · ❌ besteht weiter · ❔ unklar

## Stand im DevServer (16.10., nach dem Test)

Abgleich aller Punkte mit dem Code, danach behoben. Commits auf `feat/agent-chat`.

**Behoben**

| Punkte | Was | Commit |
|---|---|---|
| N73 | `read_section`/`write_section`: `##` im Pfad legt die Ebene fest, mehrdeutig → Fehler mit Kandidaten | 98d0d3f |
| N36, N39, #17 | F5 des Chats ist ein `connection`-Event mit `reloaded: true` | 8647e6e |
| N10, N24, N28, N29, N60, N75 (Knopf) | Vorlesen hing nach fremdem `cancel()` (Knopf blieb ■, Autoread tot, Bühne blieb stehen); Agentwechsel stoppt das Vorlesen | ade007a |
| N11, N19, N35, N52, #4 | Nach F5 blieben Formulartexte und Uhrzeiten englisch („Send answer“, „PM“) | ade007a |
| N51 (N46 teilweise) | Änderung einer nicht angezeigten `.md` lädt die Vorschau nicht mehr neu | 988ce6c |
| N1, N2 | Chat-Stream mit Ping, stiller Stream wird neu geöffnet, Hinweis „Verbindung unterbrochen“; Eingabefeld leert sich erst, wenn die Blase steht | 79e4cc3 |
| N25, N26, N49, N50, N32 (teilweise) | Hinweise ohne „Freigabe“-Vermutung und ohne Duzen; nach 30 s „vielleicht nicht verbunden“; Dateiänderungen zählen als Lebenszeichen | 6e5db21 |
| N27 | Wechsel im Agentenmenü als Blase und in `.chats` | 0c1980c |
| N48 | Nachlieferung 60 min, `command`-Einträge mit `params` | 17cddc1 |
| N37, N42 | Eventzeile mit `params` am Ende, der Monitor schneidet nur noch den Text ab | b5c4218 |
| N33, N43, N30 | Events tragen `entry`, `chat({reply_to})` meldet `newer_user_messages`; `close` mit `reason` unter dem Formular | e65f2b0 |
| N3 | `/` öffnet den Kurs von `-i` | d16c3fa |
| N56 | „⌂ Start“ in der Chatleiste zurück zur Startdatei | c32cecb |
| N77, N16 | Richtige Folie nach Ankersprung; `get_state.reload_pending` | 9688a8a |
| N15, N18, N22, N47, N57, N62 (Text), N66, N69 (Text), N74 | MCP-Texte: Tutor-Zeile in den Instruktionen, Beispiel-Label, Stimmenregel bedingt, `null` in `agents[]`, `browser_lang`, Quiz im Chat ausprobieren, Antworten nicht echoen | 7042a73 |
| N44, N70, N63 (teilweise) | Quiz-Event: `answer` = letzte Eingabe nach Auflösung, Erstlösung in der Lernansicht, `view` | d7a6020 |
| #16, N40 (teilweise), N41, N53 | `goto` mit `section`, `line` auch mit `file` (serverseitig wie `outline` gezählt); `#anker`-Links im Chat bewegen den Kurs | dc2c012 |
| N68, L14 | Der Server setzt `language:` des Kurskopfs in den Kopfkommentar einer Nachricht; `@liascript/chat` übernimmt ihn für alle Nachrichten (im Browser geprüft: keine zusätzliche Nachricht, F5 behält es) | siehe Log |
| N5, N6, N8, N9, N20, N21, N23, N34, N54, N55 | Formular mit mehreren Fragen, „Frage: Antwort“, sichtbare Namen, Tabellen, Befehle gedämpft, Vorlesen (kein Inline-Code, Formularfragen, Abkürzungen, Status in der Sprache der Nachricht) | 65e2120 |

**Schon vorher erledigt:** #1, #2, #5, #8, #10, #11, #13, #14, #15, N13, N17, N12 (`lock()` sperrt alles, im Browser nicht erneut geprüft). #6 betrifft nur Bibliotheksnutzer, N4 hat keinen Codepfad (eher Live-Reload, jetzt N51).

**Offen (größer oder bewusst zurückgestellt)**

- N45 `try_quiz`, N58 eigene Figuren mit Bild, N61 eigene Lernsitzung, N59/N71 Verlauf schrittweise rendern (erst messen)
- N62 dauerhaftes KI-Kennzeichen in der Lernansicht, N65 Ausstieg aus der Lernansicht, N64 Tonhöhe spreizen / `pitch` in `set_agent`
- N63 `max_trials` und `help: last-try`, N72 `goto`-Warnung bei nur gemeldetem Kurstitel, N76 Event bei Navigation, N40 Anker-Slug in `outline`
- N32 `expect_seconds`, #9 Ankündigung des Reloads im Chat, N31 Chat-Titel setzbar, N69 Namen je Sprache, N38 Backoff für `reload.js`, N7 (nur Automatisierung, Ursache unklar), N67 Roadmap
- Upstream: L1–L13, L15, N46/L11 (L14 bleibt als Wunsch: Sprache für `<lia-chat>` von außen, ohne Kopfkommentar)

## Alte Punkte

| # | Kurzfassung (test/) | Prio alt | Neuer MCP laut Doku | Status | Beleg (Runde) |
|---|---|---|---|---|---|
| 1 | Chatwechsel wird dem Agenten nicht gemeldet | P2 | `session`-Event, `chat.session` lehnt verspätete Nachrichten ab | 🟡 | |
| 2 | Beantwortete Formulare nach Reload unklar | P3 | `read_chat` zeigt Antworten; Darstellung im Browser? | ❔ | |
| 3 | „Thinking…“ ohne Abonnenten | P1 | `get_state.watched`; Anzeige im Chat? | ❔ | |
| 4 | Chat-UI englisch | P2 | Chat in Kurssprache (R9-Beobachtung) | 🟡 | |
| 5 | Chat überdeckt Inhalt | P2 | angedockter Chat (R9) | 🟡 | |
| 6 | `gotoLine failed` | P3 | – | ❔ | |
| 7 | Klicks ohne Nutzerblase | P2 | Klicks als Blasen (R9), `read_chat` mit `command`-Einträgen | 🟡 | |
| 8 | Technische Agentennamen | P2 | `set_agent label`, Pixel-Roboter | 🟡 | |
| 9 | Stilles Neuladen | P3 | gebündelte Reloads | ❔ | |
| 10 | „Send“-Knopf englisch | P3 | Kurssprache | 🟡 | |
| 11 | Altes Formular nach Neustart aktiv | P2 | „every other form is closed, also those asked before a restart“ | 🟡 | |
| 12 | Blockade durch Terminal-Freigabe sieht aus wie „Thinking…“ | P1 | `chat status`-Zeile; Erkennung einer Blockade? | ❔ | |
| 13 | Überholte Formulare klickbar | P2 | nur neuestes Formular offen, `close: true` | 🟡 | |
| 14 | Viele Reloads bei mehreren Edits | P2 | gebündelte Reloads (R9) | 🟡 | |
| 15 | TTS-Warnung bei jedem `get_state` | P3 | `tts` nur bei fehlender Vorlesefähigkeit, „mention it only if asked“ | 🟡 | |
| 16 | `goto` nach Dateiwechsel falsch | P2 | `goto` über Dateien, Warnung bei unfertigem Laden | 🟡 | |
| 17 | Kein Event beim Neuladen, Monitor-Lücke | P2 | `connection`-/`session`-Events, Nachlieferung bis 10 min | 🟡 | |

## Interpreter (alt)

| # | Kurzfassung | Prio alt | Status | Beleg |
|---|---|---|---|---|
| L1 | Quiz-Rückmeldetexte nicht überschreibbar | P2 | ❌ | R6: „Die richtige Antwort wurde noch nicht gegeben“, „Aufgelöste Antwort“ fest in `Translations.elm` |
| L2 | „Lösung anzeigen“ nicht je Quiz abschaltbar | P2 | ✅ | R6: `data-solution-button="false"` wirkt (undokumentiert; ohne Attribut Knopf ab Start sichtbar) |
| L3 | `window.LIA.fetchError is not a function` | P3 | ❔ | |
| L4 | Quiz-Optionen werden nicht vorgelesen | P2 | ❔ | |

## Neue Befunde (Test 2)

N1–N7 stammen aus dem abgebrochenen Firefox-Lauf (14.10., Playwright-Firefox, `_archiv/2026-10-14-firefox/`). Sie gelten als **Verdacht**, bis der Chrome-Lauf sie bestätigt; Spalte „Chrome“ wird dann ergänzt.

Prioritäten: **P1** blockiert die Arbeit · **P2** verwirrt oder bremst deutlich · **P3** wünschenswert

| # | Runde / Persona | Beobachtung | Auswirkung | Vorschlag | Prio | Chrome |
|---|---|---|---|---|---|---|
| N1 | R0 / Sabine, Entwickler | Der Kanal Server→Browser fällt still aus. Der Agent schickte um 22:39:05 einen Status und um 22:39:19 ein Formular; beides erschien nicht. „Thinking…“ verschwand ohne Antwort. Nach dem Neuladen (22:45) war das Formular da. Firefox (Playwright), DevServer 1.2.18. | Die Lehrkraft wartet minutenlang ins Leere und hält das System für kaputt (SUS 22,5). | Push-Kanal mit Heartbeat und automatischer Wiederverbindung. Nach dem Reconnect fehlende Nachrichten aus `.chats` nachladen. Sichtbare Anzeige „Verbindung unterbrochen – verbinde neu …“. | P1 | ❌ nicht aufgetreten |
| N2 | R0 / Sabine, Entwickler | Getippte Nachrichten (22:30:29, 22:40:24) leeren das Eingabefeld, werden aber **nie gesendet**: kein `POST /agent` im Netzwerkprotokoll, keine Nutzerblase. | Die Nachricht ist weg, der Agent weiß nichts davon. | Feld erst nach erfolgreichem Senden leeren. Nutzerblase sofort zeigen, bei Fehlschlag mit „nicht gesendet – erneut senden“. Möglicherweise dieselbe Ursache wie N1. | P1 | ❌ nicht aufgetreten |
| N3 | R0 / Sabine | `/` leitet auf `/home` (Dateiliste mit `personas/`, `feedback/`, `TESTLAUF.md`) statt auf die Vorschau mit Chat, obwohl `-i journal.md` gesetzt ist. Im ersten Test führte `/` direkt zur Vorschau. | Die Lehrkraft sieht technische Dateien und muss raten, was „ihr Kurs“ ist. | Mit `-i <datei>` (bzw. mit `--mcp`) `/` direkt auf `get_state.url` weiterleiten. Die Dateiliste höchstens über einen Link „Alle Dateien“ zeigen. | P2 | ❔ (direkte URL genutzt) |
| N4 | R0 / Sabine | Stopp und erneutes ▶ beim Vorlesen einer Chat-Nachricht lösten ein Neuladen der Seite aus (Dashboard springt nach oben, aufgeklappte Bereiche schließen sich). | Verlust von Position und Zustand; wahrscheinlich Auslöser für N1. | Ursache prüfen (alter Punkt #9). Vorlesen darf nie neu laden. | P2 | ❌ nicht aufgetreten |
| N5 | R0 / Sabine | Vorlesestimmen und Chat-Bedienelemente richten sich nur nach `language:` im Header. Deutscher Chattext ohne `lang` wird mit englischer Stimme gelesen, auch Codeschrift (`:init-course`). | Unbrauchbar für DaZ-Kinder und Lehrkraft. | Sprache je Nachricht automatisch erkennen, wenn `lang` fehlt. Inline-Code beim Vorlesen überspringen. Workaround in den Specs: Header-Sprache früh setzen, `lang` übergeben. | P2 | ✅ teilweise: Inline-Code mitgelesen, Satzgrenzen zusammengezogen; mit `lang: de` deutsche Stimme |
| N6 | R0 / Sabine | Die Roboter-Avatare sind nur per `title`-Tooltip beschriftet. | Auf dem iPad nicht erreichbar. Rollen unklar, bis man fragt. | Label sichtbar unter dem Avatar oder im Menü. Beim ersten Öffnen kurz erklären. | P3 | ✅ |
| N7 | R0 / Testaufbau | Links und Knöpfe im Chat sind für Playwright „not stable“ (Dauer-Animation, Mund des Roboters?). | Nur für Automatisierung relevant; deutet aber auf ständiges Neu-Rendern hin. | Animation nur beim Sprechen, Elemente nicht neu rendern. | P3 | ✅ |
| N8 | R0 Chrome / Sabine, Jonas | Formular mit `radio`-Fragen und einem `buttons`-Feld: kein Absende-Knopf sichtbar („Send answer“ erscheint nur ohne `buttons`); ein Klick auf du/ihr schickt das ganze Formular ab. | Lehrkraft beantwortet unbemerkt nur einen Teil. | Absende-Knopf immer zeigen, sobald mehr als eine Frage im Formular steht; `buttons` nur als Einzelfrage abschicken lassen. Spec-Workaround in `agent-links.md` → Forms. | P2 | ✅ |
| N9 | R0 Chrome / Sabine | Statusansage „One moment, I am thinking.“ wird bei „Read everything aloud“ in Header-Sprache gesprochen, obwohl der Chat deutsch läuft. | Sprachbruch. | Status in der Sprache der letzten Agent-Nachricht (`lang`) sprechen. | P3 | ✅ |
| N10 | R0 Chrome / Betreiber, Sabine | „Read everything aloud“ angehakt: Die Statusansage wird gesprochen, neue Agent-Nachrichten aber nicht automatisch vorgelesen. | Funktion wirkt kaputt; für Leseanfänger wäre Autoread wichtig. | Prüfen, ob Autoread neue `chat`-Nachrichten erfasst (auch mit `lang`). In R2 gezielt testen. | P2 | ✅ (R1a: nach Reload erst nach einmal ▶; ab 13:07 aus; Warteschlange bis 2,5 min hinterher; keine Absatzpausen; R2: 0 von 7 neuen Nachrichten automatisch gelesen, auch nach Aus/Ein) |
| N11 | R1a / Sabine | Nach dem Neuladen (vom Agenten empfohlen) sind die Chat-Bedienelemente wieder englisch („Send answer“, „PM“), obwohl der Header inzwischen `language: de` hat. | Sprachbruch mitten im Gespräch. | Chat-UI-Sprache bei jedem Laden aus dem aktuellen Header bestimmen, nicht aus einem Zwischenspeicher. | P2 | ✅ |
| N12 | R1a / Sabine | Nach dem Neuladen sind Radios/Checkboxen geschlossener Formulare wieder anklickbar; nur der Absende-Knopf bleibt gesperrt. | Wirkt, als könne man noch antworten. | Geschlossene Formulare komplett deaktiviert darstellen, gewählte Antwort anzeigen. | P3 | ✅ |
| N13 | R1a / Sabine | Chatfenster wird ohne Zutun deutlich breiter; Kursseite schrumpft (vermutlich weite Tabelle in einer Nachricht). | Inhalt verschwindet, Orientierung geht verloren. | Feste Breite; Tabellen nur innerhalb der Blase horizontal scrollbar. | P3 | ✅ |
| N15 | R1a / Jonas | Die Tool-Beschreibung von `set_agent` nennt „Unterrichtsplanung“ als Beispiel-Label (Themenwort statt Rolle); der Agent übernahm es wörtlich. | „Ich bin Ihre Unterrichtsplanung“ – schiefe Selbstbezeichnung. | Beispiel in der Tool-Beschreibung: „Planungsassistent“. | P3 | ✅ |
| N16 | R1a, R1b / Jonas | `get_state.title` bleibt nach einer Dateiänderung veraltet, bis ein Folienwechsel stattfindet; `goto` auf die aktuelle Folie aktualisiert ihn nicht. | Agent rät unnötig zum Neuladen („bitte F5“) und widerruft es dann. | `get_state` nach jedem Live-Reload aktualisieren oder „reload pending“ melden. Spec-Workaround: „No reload advice“. | P2 | ✅ |
| N17 | R1b / Jonas | Chat-iframe behält nach dem Sprachwechsel `<html lang="en">`. | Screenreader, Silbentrennung, Stimmenwahl ohne `lang`. | `lang` des iframes mit der Kurssprache setzen. | P3 | ✅ |
| N18 | R1b / Jonas | `set_agent` lehnt `voice: null` ab; `voice_names` zeigt bis zum Neuladen die alte Sprache. | Stimme lässt sich nicht auf automatisch zurücksetzen; nach Sprachwechsel keine passende Stimme wählbar. | `null` = automatische Wahl; `voice_names` nach Header-Wechsel sofort neu melden. | P3 | ✅ |
| N19 | R1b / Jonas | Gemischte Zeitformate im Verlauf („14:01“ / „02:03 PM“). | Wirkt unfertig. | Zeitstempel beim Sprachwechsel neu rendern. | P3 | ✅ |
| N20 | R1b / Sabine | Tabellen in Chatnachrichten bekommen einen eigenen Scrollkasten (doppeltes Scrollen). | Zusammenfassungen schwer lesbar. | Tabellen in voller Höhe, nur horizontal scrollbar. | P3 | ✅ |
| N21 | R1b / Jonas | Die Antwortblase eines Formulars zeigt nur die Werte ohne die Fragen. | Bei ähnlichen Fragen (zwei Anredefragen) unklar, was wozu gehört. | „Frage: Antwort“ je Zeile. | P3 | ✅ |
| N22 | R1b / Jonas | `get_state` kennt die Browsersprache nicht; im Leerzustand begrüßt der Agent in der Template-Sprache. | Erster Eindruck englisch mit `{{…}}`-Titel. | `get_state.browser_lang` (aus `navigator.language`) ergänzen. | P3 | ✅ |
| N23 | R2 / Sabine, Jonas | ▶-Vorlesen überspringt Tabellen und Formularfragen komplett, macht keine Absatzpausen („festschreibe:Jahreslauf:“) und liest „✓“/„×“ roh. | Zusammenfassungen und Lernziel-Tabellen sind nicht hörbar – gerade das Wichtigste. | Tabellen zeilenweise vorlesen („Spalte: Wert“), Formularfragen + Optionen mitlesen, Absatz = Pause, Symbole überspringen oder als Wort. | P2 | ✅ |
| N24 | R2 / Jonas | Der `status`-Text des Agenten erscheint nicht als Status bzw. wird nicht gesprochen; gesprochen wird nur die feste Ansage „Moment, ich denke nach“ (2 von 9 Malen). | Lehrkraft erfährt nicht, was gerade passiert. | `status` sichtbar und – bei „Alles vorlesen“ – gesprochen; feste Ansage nur ohne Status. | P3 | ✅ |
| N25 | R2 / Jonas | Platzhalter im Eingabefeld „Frag die KI …“ duzt, Agent siezt (Instructor Address). | Stilbruch. | Platzhalter neutral („Frage zum Kurs …“) oder per `set_agent`/Header einstellbar. | P3 | ✅ |
| N26 | R3 / Sabine, Jonas | Der 60-s-Hinweis „… oder er wartet am Rechner auf eine Freigabe“ erscheint auch ohne Freigabe (Auto-Modus, nur `Read`-Aufrufe). Die Lehrkraft wird verunsichert und schreibt nach. | – | Neutral formulieren („Der Assistent arbeitet noch an einer längeren Antwort …“). „Freigabe“ nur erwähnen, wenn der Agent einen Wartegrund meldet (z. B. `status` mit Kennzeichen `waiting: permission`). | P2 | ✅ |
| N27 | R3 / Sabine, Jonas | Der Wechsel über das Roboter-Menü erzeugt keine Klickblase, keinen Eintrag in `.chats` (der Link-Wechsel schon: `type:"command"`, 16:10:38) und kein „Denkt nach …“. | – | Den Menü-Wechsel wie einen Link-Klick behandeln: Blase „▶ {Label}“, Eintrag in `read_chat`, Denk-Anzeige bis zur ersten Nachricht. | P2 | ✅ |
| N28 | R3 / Sabine, Jonas | Das große Avatarbild unten links hinkt einen Wechsel hinterher: nach Wechsel zu Artist blau, nach Rückwechsel lila (`r03-29`). | – | Das Avatarbild beim `switch` sofort mit dem Kopfzeilen-Roboter aktualisieren. | P3 | ✅ |
| N29 | R3 / Sabine, Jonas | Beim Agentenwechsel liest die alte Nachricht weiter vor. | – | Beim `switch` das Vorlesen stoppen oder zu Ende lesen lassen, aber keine Überlagerung. | P3 | ✅ |
| N30 | R3 / Sabine, Jonas | Ersetzte, unbeantwortete Formulare (und „Speichern“-Knöpfe) sehen offen aus. Beantwortete werden ausgegraut (`r03-14`). | – | Geschlossene Formulare immer ausgrauen, mit Hinweis „ersetzt“. Gilt für `close: true` und für automatisches Schließen. | P2 | ✅ |
| N31 | R3 / Sabine, Jonas | Der Chat-Titel bleibt „Hallo, geht das auch auf Deutsch? Mein Englis…“ aus R1. | – | Titel aus dem Kurstitel bzw. Header oder per `set_agent`/`chat` setzbar. | P3 | ✅ |
| N32 | R4 / Sabine, Jonas | Der 60-s-Hinweis kennt keinen erwarteten Zeitbedarf. Beim Speichern arbeitet der Agent hörbar (9 Edits, Validierung, `goto`/`get_state` um 16:50:20/26 als MCP-Aufrufe), der Hinweis meldet trotzdem „wartet am Rechner auf eine Freigabe“. Sabine wünscht sich „Ich speichere noch, das dauert etwa zwei Minuten“. | – | `status` mit optionaler Dauer (`expect_seconds`), die UI zeigt „dauert etwa …“ und warnt erst danach. Jeder MCP-Aufruf des Agenten (`goto`, `get_state`, `read_section`, `write_section`) setzt den Zeitgeber zurück. Den Text neutral halten (N26). | P2 | ✅ |
| N33 | R4 / Sabine, Jonas | Wettlauf: Eine Agent-Nachricht, die vor dem Lesen einer neuen Nutzernachricht formuliert wurde, erscheint danach („✓ Anders … ich warte“ 0,9 s nach Sabines Text). | – | `chat` gibt `newer_user_messages: n` zurück (oder kennt die Option `unless_newer_input: true`, die das Senden verwirft). Die UI kann eine solche Nachricht als „vor Ihrer Nachricht geschrieben“ kennzeichnen. | P2 | ✅ |
| N34 | R4 / Sabine, Jonas | Vorlesen: Die Häppchen brechen an Abkürzungen („ca. \| 30 Min.“) und vor schließenden Anführungszeichen. Listenpunkte laufen ohne Pause ineinander („…öffnet**Station 1**“). Formularfragen und Optionen werden nicht gelesen. Erweitert N23. | – | Satzgrenzen abkürzungsfest erkennen (Sprachliste mit „ca.“, „z. B.“, „Min.“ …), Satzzeichen einschließlich schließender Anführungszeichen beim Satz lassen, jeder Listenpunkt und Absatz = Pause, Formular als „Frage: Optionen“ anhängen. | P2 | ✅ |
| N35 | R4 / Sabine, Jonas | Geschlossene Formulare im Verlauf zeigen englisch „No longer open“, ein älteres Formular zeigt „Send answer“. | – | Texte geschlossener und alter Formulare in der Header-Sprache rendern, auch nach dem Neuladen. | P3 | ✅ |
| N36 | R4 / Sabine, Jonas | Das Neuladen um 16:23:23 erzeugte **kein** `connection`-Event, obwohl der Monitor bis 16:25:46 lief (letztes Event 16:10:38, Ablauf „13 events delivered“). Diesmal war nichts offen, deshalb ohne Folgen. | – | Bei jedem Seitenaufbau `connection` bzw. `session: resumed` senden, damit der Agent offene Formulare oder Nachrichten nachholen kann. | P3 | ✅ |
| N37 | R4 / Sabine, Jonas | Lange Chat-Texte kommen im Event abgeschnitten an („…jed...(truncated)“). Der Agent musste `read_chat` aufrufen (+3 s). Ursache ❔: Server oder Zeilenlimit des Claude-Code-Monitors. | – | Im Event `params.text` auf eine Vorschau begrenzen und `truncated: true` plus Eintrags-ID mitgeben, oder die SSE-Zeile nie kürzen. | P3 | ✅ |
| N38 | R4 / Sabine, Jonas | In der Konsole wiederholt `WebSocket ws://127.0.0.1:13028/ … ERR_CONNECTION_REFUSED` (`reload.js:100`), dazu ältere `gotoLine … ERR_INCOMPLETE_CHUNKED_ENCODING`. In R4 nach dem Neuladen 0 neue Fehler. | – | Klären, ob `reload.js` einen veralteten Port nutzt. Erneute Verbindungsversuche begrenzen (Backoff), keine Fehlerflut. | P3 | ✅ |
| N39 | R5 / Jonas | **Ursache für #17/N36 gefunden:** Sabines Neuladen um 17:06:02 erzeugte kein `connection`-Event. Der Monitor lief bis 17:25:53 und endete mit „expired after 30m with no events delivered“. In `dist/index.js` → `connectionChanged` vergleicht ein 2-s-Timer den Zustand mit dem zuletzt gemeldeten (`connected`, `chat`). Ein schnelles Neuladen stellt denselben Zustand wieder her, und das Event wird unterdrückt. | – | Bei jedem neuen Seiten- bzw. Chat-Client ein `connection`-Event mit `reloaded: true` senden, unabhängig vom Zustandsvergleich (oder `session` mit `resumed`). | P2 | ✅ |
| N40 | R5 / Jonas | Der Agent kann Anker nicht verifizieren. `goto line` liefert nur `slide: 10`, und daraus wurde der fragile Link `#10`. | – | `outline` (oder `get_state`) liefert pro Folie `{slide, line, title, anchor}`, wobei `anchor` der vom Interpreter gebildete Slug ist. `goto` nimmt zusätzlich `anchor` oder `title` an. | P2 | ✅ |
| N41 | R5 / Jonas | Im Chat gibt es keinen Link, der die **Kursseite** zu einer Stelle führt. „Hier ist Ihre Station“ geht nur über `goto` durch den Agenten. | – | Markdown-Links im Chat mit `#anchor` (oder `lia:goto?line=…`) navigieren das Kursfenster, nicht das Chat-iframe. Dann kann jede Abschlussmeldung „▶ Station ansehen“ als Knopf enthalten. | P3 | ✅ |
| N42 | R5 / Jonas | **N37 eingegrenzt:** Abgeschnitten wird nicht vom Server. Der Claude-Code-Monitor kürzt jede Eventzeile bei ≈ 500 Zeichen („…Prof...(truncated)“, 17:34:20). Der Agent holte den Text per `read_chat` (+2,2 s) ✅. | – | Chat-Events mit Eintrags-ID ausliefern (`params.id`), damit `read_chat` gezielt lesen kann. `params.text` an das Ende der Zeile, `context` kurz halten, optional `text_length`. Betrieb: Workaround in den Specs ist vorhanden und wirkt. | P3 | ✅ |
| N43 | R6 / Jonas | `chat {close: true}` schließt ein offenes Formular ohne sichtbaren Grund. Hier hat der Agent eine **ältere** Nachricht als Antwort gedeutet; Sabine sah nur „Nicht mehr offen“ (`r06-12`: „gefragt hat er nicht“). Der Server weiß, dass die letzte Nutzernachricht (16:34:49Z) älter ist als das Formular (16:35:20Z). | – | (1) `close` mit `reason` (wird unter dem Formular angezeigt, z. B. „als Ja gewertet: Ihre Nachricht 18:34“). (2) `chat` mit `inputs` gibt `newer_user_messages: n` zurück oder lehnt mit `unless_newer_input: true` ab (Fortsetzung N33). (3) Nutzernachrichten im Event mit `open_ask` (ID des Formulars, das beim Tippen offen war). | P2 | ✅ |
| N44 | R6 / Jonas | `activity` bei `solved: "resolved"` meldet als `input` die vom Interpreter eingesetzte **Lösung** (Frage 2: Sabine „viele tausend“, Event `[true,false,false]` = „eine“). Die Tool-Doku nennt `resolved` „gave up“, bei `data-max-trials` ist es aber eine automatische Auflösung. `help: "true"` kam auch in der Autorenansicht beim absichtlichen Test. Es gibt keinen Fragetext. | – | Event-Felder: `answer` (letzte Eingabe des Lernenden vor der Auflösung), `resolved_by: "max-trials" \| "button"`, `label` (erste ≈ 60 Zeichen der Frage), `view: author \| learner`. Doku: „after resolution `input` is the solution“. In der Autorenansicht `help` nur als Information, nicht als Aufforderung zum Tipp. | P2 | ✅ |
| N45 | R6 / Jonas | Der Agent kann das Verhalten der Kinderseite (Knöpfe, Rückmeldetexte, Auflösung) nicht selbst ausprobieren und muss es der Lehrkraft überlassen („Ihr Eindruck ist hier die eigentliche Prüfung“). | – | Ein MCP-Werkzeug `try_quiz {file, slide, block, answers[]}` beantwortet ein Quiz in einer unsichtbaren Instanz und gibt je Versuch Rückmeldetext, sichtbare Knöpfe und `solved` zurück. Alternativ S12 im Prüfskript. | P2 | ✅ |
| N46 | R6 / Jonas | Ein Neuladen nach einer Dateiänderung leert die Quiz-Zustände der Testerin (18:41:31). Fällt die aktuelle Folie weg, springt die Vorschau auf die letzte Folie (`#16` → `#9`). | – | Quiz-Zustand über den Reload erhalten, solange der Quiz-Block unverändert ist (Hash des Blocks statt Position). Fällt die Folie weg, auf die Folie mit dem nächsten passenden Titel gehen und `goto`/Event `reloaded` mit dem neuen Ziel melden. | P3 | ✅ |
| N47 | R6 / Jonas | Die Server-Anleitung nennt „quiz“ als Einsatz im Chat, der Agent kam aber nicht auf die Idee, einen Material-Entwurf (Quiz mit Attributen) **im Chat** zum Ausprobieren zu zeigen. | – | In der Tool-Beschreibung von `chat`: „To let the user try a quiz before it is written to a file, send it as LiaScript in `markdown`; results arrive as `activity` with `chat` index.“ | P3 | ✅ |
| N48 | R7 / Sabine, Jonas | Die Nachlieferung endet nach 10 min. Der Klick (19:50:38) fehlte beim ersten Monitor (20:00:44), die Chat-Nachricht (19:51:59) kam. In `.chats`/`read_chat` stehen `command`-Einträge ohne `params` (nur `cmd`, `label`, `agent`). | – | (1) Unbeantwortete `command`/`chat`/`answer`-Events bis zur nächsten Agent-Nachricht nachliefern, nicht zeitbasiert, oder mindestens 60 min. (2) `params` und `context` im `.chats`-Eintrag speichern und in `read_chat` ausgeben. (3) Beim ersten Leser nach einer Lücke ein Event `session {resumed: true, missed: n, dropped: n}`. | P2 | ✅ |
| N50 | R7 / Sabine, Jonas | Der 60-s-Ruhe-Hinweis kennt nur `status`/`chat` als Lebenszeichen. Der Watcher meldet Dateiänderungen („📝 journal.md changed“), setzt den Zeitgeber aber nicht zurück. 20:08:26 erschien der Hinweis neben „Trage … ein“. | – | Jede Dateiänderung unter `root` und jeder MCP-Aufruf (auch `read_chat`, `goto`) setzt den Zeitgeber zurück. Der Hinweis **ersetzt** die Statuszeile statt neben ihr zu stehen. Text neutral (N26). Fortsetzung N26/N32. | P2 | ✅ |
| N51 | R7 / Sabine, Jonas | Jede Änderung im Projektordner lädt die Vorschau neu, auch wenn eine andere Datei angezeigt wird (`chokidar.watch(root)` → `reload`). Ein Journal-Edit setzte Sabines Quiz auf `README.md` zurück. | – | Nur neu laden, wenn sich die angezeigte Datei oder eine ihrer Imports geändert hat. Sonst nur Inhaltsverzeichnis/Titel aktualisieren oder ein Event `file_changed` an den Agenten senden. Ein Reload nach Änderung der angezeigten Datei wird im Chat angekündigt („Die Seite lädt neu, Antworten im Test werden zurückgesetzt“). | P2 | ✅ |
| N52 | R7 / Sabine, Jonas | Ohne verbundenen Agenten (R7a) rendert die Chat-UI englisch („No longer open“, „06:46 PM“), nach `set_agent` deutsch („19:50“). | – | Sprache der UI beim Laden aus dem `language:`-Header der angezeigten bzw. Startdatei, unabhängig vom Agenten (Fortsetzung N11/N35). | P3 | ✅ |
| N54 | R7 / Sabine, Jonas | Die eigene Klick-Blase übernimmt Symbole aus dem Linktext („▶ Station 1 prüfen →“) und wirkt dadurch wie ein Knopf. | – | Führende und abschließende Symbole und Pfeile entfernen, Blase als Aussage gestalten („✓ Station 1 prüfen“ wie bei Formularantworten). | P3 | ✅ |
| N55 | R7 / Sabine, Jonas | Inline-Code nach Links im Chat (`:create-session 2 erklaeren`, `:agent artist → :create-visuals`) erscheint als auffällig umrandete Kästen in Grün und Monospace (`r07b-12`, `r07b-19`). Sabine ignoriert sie, für sie sind sie Rauschen. | – | Code direkt nach einem `agent:`-Link gedämpft und klein rendern oder per Schalter „Befehle zeigen“ ausblenden (Autorenansicht an, Lehrkraftansicht aus). Spec-Seite: S26. | P3 | ✅ |
| N56 | R7 / Sabine, Jonas | Nach einem Dateiwechsel (`goto README.md`) zeigt das Inhaltsverzeichnis nur noch die Kinderseiten. Es gibt keinen sichtbaren Weg zurück zur Übersicht (`journal.md`), Sabine musste fragen. | – | Im Chat-Kopf oder Inhaltsverzeichnis ein fester Knopf „← Übersicht“ zur Startdatei des DevServers (`-i`), solange eine andere Datei angezeigt wird. | P2 | ✅ |
| N57 | R8 / Sabine, Jonas | Die Server-Anleitung (immer im Kontext) erwähnt weder `find_teacher` noch `persona`, `view: learner` oder Lernbegleitung. Claude Code lud `find_teacher` aufgeschoben, also nur mit Namen. Der Agent bot deshalb nur die Kursfigur an und lud das Werkzeug erst 22:31:27 auf Nachfrage. | – | In die Server-Anleitung eine Zeile: „When the user asks for a tutor, companion, learning partner or to try the course as a learner: call `find_teacher`, offer 3–4 with a `teacher` form (plus the course's own figure if any), then `set_agent` with `persona` and `view: learner`.“ So erreicht die Regel auch Clients, die Werkzeuge aufgeschoben laden. | P2 | ✅ |
| N58 | R8 / Sabine, Jonas | `chat inputs type: "teacher"` und `set_agent persona` nehmen nur `find_teacher`-IDs. Eine Kursfigur (Frida) kann nicht mit Bild neben historischen Personen stehen und bekommt einen Pixel-Roboter. | – | `teacher`-Optionen zusätzlich als Objekt `{id, name, image, description}` (Bild relativ zu `root`). `set_agent persona` nimmt ein solches Objekt (Name, Bild, Stilsatz). Optional Header-Feld `companion:` im Kurs, das `get_state.teacher` analog liefert. | P2 | ✅ |
| N59 | R8 / Sabine, Jonas | Ansichtswechsel per `goto` auf eine andere Datei: Die Adresse wechselt sofort, die Mitte erst nach 20–35 s. Keine Ladeanzeige, die alte Seite bleibt stehen. `goto` meldet keine Warnung. Verdacht: Chat und Verlauf (187 Einträge, 140 KB, alle als LiaScript gerendert) werden mit neu geladen. | – | Sofort eine Ladeanzeige („Seite wird geladen …“) im Kursbereich. Chat-iframe beim Dateiwechsel nicht neu laden. Verlauf schrittweise rendern (letzte 20, Rest beim Hochscrollen). `goto` mit `wait: true` liefert die Zeit bis „rendered“. | P2 | ✅ |
| N60 | R8 / Sabine, Jonas | Das große Avatarbild zeigt den Agenten, dessen Nachricht gerade vorgelesen wird, und springt danach nicht zurück. Nach ▶ an einer alten Nachricht des Planungsassistenten blieb es bis zum Ende der Kindersicht auf ihm, obwohl die Kopfzeile „Frida“ zeigte (`r08-10` … `r08-17`). Variante von N28. | – | Nach dem Vorlesen auf den aktuellen Agenten zurückspringen. In der Kinderansicht ▶ nur an Nachrichten des aktuellen Agenten zeigen, ältere Nachrichten anderer Agenten ausblenden (N61). | P3 | ✅ |
| N61 | R8 / Sabine, Jonas | `view: learner` zeigt den ganzen bisherigen Verlauf, also die Planungsunterhaltung mit Datenschutzhinweis direkt über der Begrüßung der Figur (`r08-04`), dazu den alten Chat-Titel. Ein Kind sähe die Lehrkraftunterhaltung. | – | Die Kinderansicht startet eine eigene Chat-Sitzung (oder filtert auf Nachrichten seit dem Wechsel) mit Titel = Name der Begleitung. Beim Wechsel zurück auf `author` den Planungsverlauf wiederherstellen. `read_chat` liefert beide getrennt. | P2 | ✅ |
| N62 | R8 / Sabine, Jonas | In der Kinderansicht gibt es kein KI-Kennzeichen. Mit einer Porträt-Persona entfiele auch der Roboter als Hinweis. Die Pflicht zur KI-Vorstellung steht nur in der Beschreibung von `find_teacher`, nicht bei `set_agent`, und gilt dort nur für historische Personen. | – | In der Kinderansicht ein dauerhaftes Kennzeichen unter dem Avatar („KI“ bzw. „Computerprogramm“, in der Kurssprache). In `set_agent` bei `persona` oder `view: learner`: „The first message says in one sentence of the learner's language that this is an AI playing the role“, auch für eigene Figuren. | P2 | ✅ |
| N63 | R8 / Sabine, Jonas | `help: "true"` kommt erst beim 3. Fehler oder bei der Auflösung. Bei `data-max-trials="2"` (in der Didaktik gewollt) also immer erst nach der Lösung. Die Begleitung kann nur nachträglich erklären. Das Event nennt weder `max_trials` noch, ob der Tipp-Knopf sichtbar war. | – | Event-Felder `max_trials`, `hint_available`, `view`. Ein `help` (z. B. `help: "last-try"`) **vor dem letzten Versuch**, wenn noch kein Tipp genutzt wurde, zusätzlich zum bisherigen `help` bei Auflösung. In der Tool-Beschreibung zwischen Autorentest (Information) und Kinderansicht (Anstoß erlaubt) unterscheiden (Fortsetzung N44). | P2 | ✅ |
| N64 | R8 / Sabine, Jonas | Im Browser gibt es eine einzige deutsche Stimme (`voice_names: ["Google Deutsch"]`). Frida und der Planungsassistent klingen gleich (Tonhöhe 0,9 gegenüber 1,0, Tempo 0,96 gegenüber 0,95). Ein Kind hört keinen Rollenwechsel. | – | `set_agent` mit `pitch` und `rate` je Agent. Bei geteilter Stimme automatisch spreizen (z. B. ±0,2 Tonhöhe). In `view: learner` Standardtempo etwas langsamer (einstellbar). `get_state` meldet, wie viele Stimmen es pro Sprache gibt. | P3 | ✅ |
| N65 | R8 / Sabine, Jonas | In der Kinderansicht gibt es keinen Ausstieg für die Lehrkraft. Der Agent schrieb deshalb „Für Sie, Frau Krüger: Schreiben Sie ‚Ende‘ …“ in den Kinderchat, und Sabine überlas es. | – | Ein kleines, nur für Autoren gedachtes Element (z. B. im Menü der Kopfzeile: „Zurück zur Planung“), das ein `command switch` zum vorigen Agenten und `view: author` sendet. Ergänzt N56. | P3 | ✅ |
| N66 | R8 / Sabine, Jonas | Ein Formular mit `buttons` zeigt nach dem Klick die eigene Blase „✓ Frida“ (gut). Die Spec-Regel „Echo decisions … because the chat does not show clicked buttons“ ist damit überholt, und der Agent echote doppelt („✓ Die Fehler waren Absicht …“ nach „Ja, alles Absicht“ in der Blase). | – | In der Tool-Beschreibung von `chat` erwähnen, dass Antworten als Blase erscheinen. Spec-Seite: Echo nur bei mehreren Fragen oder getippten Antworten (S36). | P3 | ✅ |
| N68 | R8b / Sabine, Jonas | Ein LiaScript-Quiz in einer Chat-Nachricht zeigt die Bedienelemente auf Englisch: „Check“, „Check 2“, „Congratulations, that was the right answer“, „The correct answer has not yet been given“, Tooltips „show hint“/„show solution“ (`r08b-16`). Kurs (`language: de`) und Vorlesen im Chat sind deutsch, das Quiz in der Station ebenfalls. Für DaZ-Kinder in der Kinderansicht besonders ungünstig. | – | Der Chat übernimmt `language` aus dem Kopf der angezeigten Kursdatei für die Übersetzungen (wie schon fürs Vorlesen). `chat lang` gilt auch für die Bedienelemente. In der Tool-Beschreibung festhalten, ob ein Kopfkommentar `<!-- language: de -->` in der Nachricht wirkt. Zusammen mit L1/L10 kursweite Quiz-Texte auch im Chat. | P2 | ✅ |
| N69 | R8b / Sabine, Jonas | `set_agent` mit `persona` überschreibt das übergebene `label` („Lernbegleiter Comenius“) durch den englischen `find_teacher`-Namen („John Amos Comenius“, Ergebnis 09:36:18). Kopfzeile, Nachrichten und Karten zeigen „John“, der Agent schreibt im deutschen Text „Johann“. | – | Ein übergebenes `label` hat Vorrang. `find_teacher` liefert Namen je Sprache (`names: {de: "Johann Amos Comenius"}`) oder eine Liste von `aliases`, und die `teacher`-Karte zeigt den Namen in der Kurssprache. | P3 | ✅ |
| N70 | R8b / Sabine, Jonas | Für eine richtige Erstlösung und für eine unbearbeitete Aufgabe kommt **kein** `activity`-Event. Die Begleitung kann „gelöst“ und „nicht gemacht“ nicht unterscheiden und behauptete in der Nachbesprechung „Frage 1 stimmte gleich“, obwohl Frage 1 leer war (`r08b-13`). | – | In der Kinderansicht auch `solved: "first"` melden (einmal je Aufgabe). Alternativ beim Verlassen einer Folie ein Event `slide_summary` mit dem Zustand je Block (offen/gelöst/aufgelöst), oder `read_section` mit dem aktuellen Quiz-Zustand je Block. | P2 | ✅ |
| N72 | R8b / Sabine, Jonas | `goto {file, slide}` auf eine andere Datei kehrt sofort zurück. `get_state.title` meldete danach nur den Kurstitel („Wie Bienen leben“) statt des Folientitels, ohne die angekündigte Warnung „another file has not finished loading“. Der Agent rief `goto` vorsichtshalber ein zweites Mal auf. | – | `goto` liefert `loading: true` mit Warnung, bis die Zielfolie gerendert ist. Optional `wait: true` mit der Zeit bis „rendered“ (N59). | P3 | ✅ |
| N73 | R8b / Sabine, Jonas | `read_section {section: "## Dashboard"}` lieferte `### Dashboard` unter `## Templates – Vorlagen` (Folie 8) statt `## Dashboard – Übersicht` (Folie 2). Das `##` im Pfad wurde ignoriert, der Agent musste über `slide: 2` ausweichen. | – | Steht `#` im Pfad, muss die Überschriftenebene passen. Ohne Ebene hat der flachste Treffer Vorrang. Bei mehreren Treffern einen Fehler mit der Liste der Kandidaten liefern statt still den ersten zu nehmen. Das gilt auch für `write_section`, wo ein falscher Treffer Daten überschreiben würde. | P2 | ✅ |
| N74 | R8b / Sabine, Jonas | Die Persona-Regel im `set_agent`-Ergebnis verlangt „Pick a voice … that fits the gender of the person and pass it to set_agent as voice“, auch wenn `voice_names` nur eine Stimme hat (hier vermutlich eine Frauenstimme). Die Regel widerspricht damit der Spec („promise nothing“). Die automatische Tonhöhe 0,71 wird nirgends gemeldet. | – | Regeltext bedingt formulieren: „if voice_names has one that fits; otherwise the chat lowers or raises the pitch“. Im Ergebnis `pitch`/`rate` zurückgeben, damit der Agent sie kennt und nichts Falsches sagt. | P3 | ✅ |
| N75 | R8b / Sabine, Jonas | Vorlesen: Nach `speechSynthesis.cancel()` (Folienwechsel oder Stopp) zeigt der Knopf der Nachricht weiter „■“, und der erste Klick bewirkt nichts. Dazu kommt 1 × `SpeechSynthesisErrorEvent` in der Konsole. Die Porträt-Karte war für Playwright „not stable“ (Animation bzw. Übergang beim Hover). | – | Beim `end`/`error`-Event der Sprachausgabe den Knopfzustand zurücksetzen. Karten ohne Bewegung beim Hover (auch besser für Menschen mit Bewegungsempfindlichkeit, `prefers-reduced-motion`). | P3 | ✅ |

| N49 | R7a / Sabine, Jonas | Bei `watched: false` zeigt der Chat dieselben Hinweise wie bei einem arbeitenden Agenten („Wartet auf den Assistenten …“, nach 30 s „Der Assistent hat noch nicht reagiert. Deine Nachricht ist gespeichert …“). Kein Hinweis, dass niemand verbunden ist; der Text duzt. | Lehrkraft bricht nach 3 min ab (R7a). | Ohne Leser sofort: „Der Assistent ist gerade nicht verbunden. Ihre Nachricht ist gespeichert; sobald er startet, antwortet er.“ Anrede aus Header/`set_agent`. Optional Terminal-Hinweis des DevServers „browser waiting, no agent“. | P1 | ✅ |
| N53 | R7 / Jonas | `goto {line}` landete eine Folie zu weit; Verdacht: Überschrift in einem HTML-Kommentar wird als Folie mitgezählt. | Agent zeigt die falsche Seite. | Zeile → Folie über den Abschnittsindex des Interpreters (Kommentare/Codeblöcke ausgenommen); `outline` mit `line_start`/`line_end`. | P3 | ❔ |
| N67 | R8 / Sabine, Jonas | Vom Ausprobieren zur echten Nutzung gibt es keinen Weg: veröffentlichte Seiten haben keinen Chat. | „Würde ich meinen Kindern geben: 2“. | Langfristig ein Laufzeit-Baustein für veröffentlichte Kurse mit schulisch freigegebenem KI-Dienst (ohne Anmeldung/Speicherung, Begleitregeln aus dem Kurskopf); kurzfristig Export „Begleit-Hilfen als statisches Material“. | P3 (Roadmap) | ✅ |
| N71 | R8b / Sabine | Antworten mit pünktlichem Zeitstempel erschienen im Browser erst 45–75 s später (210 Verlaufseinträge; evtl. gedrosseltes Hintergrundfenster). | Kind fragt „bist du noch da?“. | Messen im Vordergrund; Verlauf schrittweise rendern; Hinweis „Neue Nachricht ↓“; eigener Kinderverlauf (N61). | P2 | ❔ |
| N76 | R9 / Jonas | Ankerlinks auf der Kursseite (Übersicht, TOC) erzeugen kein Event; der Agent rät und schob den „Fehlklick“ der Lehrkraft zu. | Falsche Schuldzuweisung, Agent weiß nicht, wo die Lehrkraft ist. | Leichtes `navigate`-Event `{from, to, via}` oder `context.previous` im nächsten Event. | P2 | ✅ |
| N77 | R9 / Jonas | `context.slide: 1` bei passendem `context.title` nach einem Ankersprung – Foliennummer veraltet (verwandt N16). | Agent deutet den Ort falsch. | Foliennummer nach Hash-Sprung aktualisieren. | P3 | ❔ |

## Interpreter (neu, Test 2)

| # | Runde / Persona | Beobachtung | Auswirkung | Vorschlag | Prio | bestätigt |
|---|---|---|---|---|---|---|
| L5 | R5 / Sabine, Jonas | Ein unbekannter Anker springt **stillschweigend auf Folie 1**: `Update.elm` → `UrlChanged`: `getSectionNumberFrom … \|> Maybe.withDefault 0`. Sabine dachte: „Jetzt bin ich wieder ganz am Anfang.“ | – | Bei `Nothing` auf der aktuellen Folie bleiben und eine Konsolenwarnung ausgeben (optional einen kurzen Hinweis „Abschnitt nicht gefunden“), statt auf Folie 1 zu springen. | P2 | ✅ |
| L6 | R5 / Sabine, Jonas | Die Titel-Slugs (`generateIndex`) behalten Satzzeichen und Gedankenstriche (`#1.-wer-wohnt-im-bienenstock?`, `#course-context-–-kurskontext`). Das ist anders als bei üblichen Markdown-Slugs (GitHub: `#1-wer-wohnt-im-bienenstock`) und nirgends dokumentiert. Agenten und Menschen bilden den falschen Anker. | – | In `searchIndex` einen zweiten, toleranten Vergleich ergänzen: auf beiden Seiten alles außer Buchstaben, Ziffern, Leerzeichen und `-` entfernen und Mehrfach-Bindestriche zusammenfassen. Die Regel in der LiaScript-Doku (Abschnitt Links/Anker) nennen. Zahlen-Fragmente (`#10`) bleiben wie gehabt Foliennummern. | P2 | ✅ |
| L7 | R6 / Sabine, Jonas | Bei Erreichen von `data-max-trials` ersetzt `Update.elm` → `isSolved` (Zweig `ReSolved`) den Zustand durch die Lösung. Die letzte Antwort des Lernenden geht verloren und ist für Ereignisse und Lehrkraft nicht mehr sichtbar. | – | Letzte Eingabe als `lastInput` im Element behalten und im Ereignis mitsenden. Die Lösung im View markieren, statt die Auswahl des Lernenden zu überschreiben (z. B. falsche Wahl rot, richtige grün umrandet). | P2 | ✅ |
| L8 | R6 / Sabine, Jonas | `showResolveAt` ist ohne `data-solution-button` immer 0 (`Parser.elm` → `getOptions`, `Maybe.withDefault 0`), auch wenn `data-max-trials` gesetzt ist. Der Knopf „Lösung zeigen“ steht dann ab dem ersten Moment da und umgeht die Versuchsgrenze. Die Attribute stehen nur im CHANGELOG, nicht in der Doku und nicht im Skill. | – | Default: Ist `data-max-trials` gesetzt, gilt `showResolveAt = maxTrials` (oder Knopf aus). Die Attribute `data-max-trials`, `data-solution-button`, `data-hint-button`, `data-show-partial-solution`, `data-randomize`, `data-score` in der Doku (Quiz → Tweaks) mit Beispielen. | P2 | ✅ |
| L9 | R6 / Sabine, Jonas | Freitext-Quiz mit Prüfskript (`@input.length > 5`) zeigt bei jeder Eingabe „Herzlichen Glückwunsch, das war die richtige Antwort“. Für offene Schreibaufgaben ist das falsches Lob. „Prüfen 2“ zeigt Kindern die Versuchszahl. | – | Ein Modus „abgeben und vergleichen“ (z. B. `data-feedback="none"` oder Skript-Rückgabe `"submitted"`) ohne Richtig/Falsch-Text, der danach den Lösungsblock zeigt. Die Versuchszahl auf dem Knopf per Attribut abschaltbar (`data-show-trials="false"`). Zusammen mit L1 kursweite Texte: `@quiz.text.correct/wrong/resolved`. | P2 | ✅ |
| L10 | R6 / Sabine, Jonas | „Aufgelöste Antwort“ (Translations Z. 5803) ist ein weiterer fester Erwachsenentext. Er erscheint jetzt bei **jeder** Auto-Auflösung, also im Normalfall eines schwachen Kindes. | – | In L1 aufnehmen: alle drei Texte (richtig, falsch, aufgelöst) kurs- und quizweise überschreibbar. | P2 | ✅ |
| L11 | R7 / Sabine, Jonas | Nach einem Reload ist der Quiz-Zustand weg, auch wenn sich die angezeigte Datei **nicht** geändert hat (20:14: nur `journal.md` geändert, `README.md#8` zurückgesetzt). Die Ursache ist ❔: keine Persistenz im Dev-Modus oder ein Schlüssel über eine veränderliche Größe. | – | Quiz-Zustände im Dev-Modus in `sessionStorage` halten, Schlüssel = Datei + Hash des Quiz-Blocks. Nach einem Reload wiederherstellen, wenn der Block unverändert ist (ergänzt N46/N51). | P3 | ✅ |
| L12 | R8 / Sabine, Jonas | Matrix-Quiz in einer schmalen Spalte (≈ 550 px): Die Kopfzeilen brechen nicht um, die Tabelle wird breiter als die Spalte (horizontale Leiste), und die Zeilenbeschriftung überdeckt die letzte Kopfzelle („ist ei / Männch“, `r08-10`). Die dritte Antwortmöglichkeit ist für Kinder unsichtbar. | – | Kopfzellen umbrechen (`white-space: normal`, Mindestbreite je Spalte). Die Zeilenbeschriftung darf keine Kopfzelle überdecken. Unter einer Breitenschwelle eine gestapelte Darstellung (je Zeile die Optionen als beschriftete Radios). Testfall mit drei Köpfen à 15–25 Zeichen. | P2 | ✅ |
| L13 | R8 / Sabine, Jonas | Der Tipp-Knopf ist nur ein Glühbirnen-Symbol ohne Text. In zwei Aufgaben übersehen (`hints: 0` in allen Events), obwohl Frida darauf hinwies. | – | Optionale Beschriftung („Tipp“, übersetzt) per Attribut (`data-hint-label`) oder kursweit. Einmaliges Hervorheben beim ersten Erscheinen. `aria-label` in der Kurssprache. | P3 | ✅ |
| L14 | R8b / Sabine, Jonas | Die Übersetzungen der Quiz-Bedienelemente hängen am `language` des Dokumentkopfs. Ein eingebettetes Stück LiaScript ohne Kopf (Chat-Nachricht) fällt auf Englisch zurück („Check“, „Congratulations …“, „show hint“), obwohl die einbettende Seite deutsch ist. Die Versuchszahl („Check 2“) erscheint auch hier (L9). | – | Eine Sprache für Fragmente von außen setzbar machen (Parameter beim Einbetten bzw. eine Nachricht des Hosts), Standard = Sprache der Elternseite. Kurzfristig dokumentieren, ob ein Kopfkommentar `language:` in einem Fragment wirkt. | P2 | ✅ |
| L15 | R8b / Sabine, Jonas | Beim Klick auf den Tipp-Knopf springt die Seite nach unten (Sabine 09:45, Test Frage 2). Bei langen Testfolien verliert ein Kind die Frage aus dem Blick. | – | Beim Aufklappen des Tipps nicht scrollen, oder den Tipp so einblenden, dass die Frage sichtbar bleibt (`scrollIntoView({block: "nearest"})`). | P3 | ✅ |

## @liascript/chat und Formeln (Vorlese-Test 15.10.)

Gefunden beim Test des Vorlesens im Chat des DevServers (2026-10-15, `@liascript/chat` 0.1.2--2.2.2,
`@liascript/editor` 1.2.0--2.2.2, Chrome). Was der DevServer selbst umgehen kann, macht `runs()` in
`views/chat.js`; das hier gehört in LiaScript.

### Fehler

- **`<summary>` landet in einem `<p>`.** Aus

  ```html
  <details><summary>Mehr anzeigen</summary>
  Versteckter Text.
  </details>
  ```

  wird `<details><p class="lia-paragraph"><summary>Mehr anzeigen</summary> Versteckter Text.</p></details>`.
  `<summary>` ist damit nicht mehr das erste Kind von `<details>`, der Browser zeigt seine eigene
  Beschriftung „▶ Details“, und „Mehr anzeigen“ verschwindet im zugeklappten Teil. Im Chat gesehen, im
  Kurs nicht geprüft (vermutlich derselbe Parser).

### Sprache im Chat

- *(Umgangen 16.10.: ein Kopfkommentar `language:` in einer Nachricht mit Inhalt gilt für den ganzen Chat und
  verschiebt die Nummern nicht, nur ein reiner Kopf über `define()` tut das. Der DevServer setzt ihn selbst.)*
  **`<lia-chat>` lässt sich keine Sprache geben.** Die Chat-App setzt `<html lang>` ihres iframes einmal
  beim Start aus `definition.language` (`index_store`), also `en`, solange kein Header etwas anderes sagt.
  Ein Header geht nur über `define()` bzw. eine Nachricht `<!-- language: de -->`, und die zählt als
  Nachricht mit (die Nummern der Nachrichten verschieben sich). Davon hängt ab, in welcher Sprache
  `<lia-formula>` ihre Beschreibung (`aria-label` im Shadow DOM, Text im Light DOM) rendert. Vorschlag:
  ein Attribut `<lia-chat lang="de">` oder `lia.load({language})`. Der DevServer setzt heute selbst
  `iframe.contentDocument.documentElement.lang` und ruft `render()` jeder Formel auf (`chatLang()` in
  `views/chat.js`).

- **`<lia-formula>` nimmt die Sprache des Dokuments, nicht die des Elements.** `speech()` verwendet
  `document.documentElement.lang`. Eine Formel in `<span lang="en">` in einem deutschen Kurs wird deutsch
  beschrieben. Besser: `this.closest('[lang]')?.lang || document.documentElement.lang`.

- **Ändert sich die Sprache, bleiben die Formeln in der alten.** `render()` läuft nur beim Einhängen und
  bei neuer `formula`/`macros`. Ein Beobachter auf `<html lang>` (oder `attributeChangedCallback` mit
  `lang`) würde das lösen.

- **Beschreibungen gibt es nur für `en` und `de`** (`LANGUAGES` in der eigenen Fassung von
  `render-a11y-string`); jede andere Sprache bekommt die englische.

### Unterscheidbarkeit

- **Umfragen und Aufgaben haben keine eigene Klasse.** Eine Umfrage mit `[(1)]` (Radiobuttons) wird
  `lia-quiz lia-quiz-multiple-choice`, eine Aufgabenliste `- [ ]` ebenso. Von außen lassen sie sich nicht
  von einem Quiz unterscheiden. Vorschlag: `lia-survey`, `lia-survey--single`/`--multiple`, `lia-task`;
  die Umfrage mit Radiobuttons nicht `multiple-choice` nennen.

- **Umfragen und Aufgaben haben kein ARIA**, anders als das Quiz (`role="radiogroup"`/`"list"`,
  `aria-labelledby`, `role="listitem"`). Dasselbe dort ergänzen.

### Wunsch

- **Ein Text zum Vorlesen pro Nachricht** in `@liascript/chat`, z. B. `lia.speech(n)` mit
  `[{lang, text}]`. Der DevServer liest den Text heute selbst aus dem DOM und hängt an Klassen wie
  `.lia-quiz`, `.lia-effect__circle` oder `.lia-code--inline`, die sich mit jeder Version ändern können.
  LiaScript kennt die Bedeutung (Lösung eines Quiz nicht verraten, Formeln, Tabellen, Effekte) und
  könnte das auch für das eigene Vorlesen der Folien nutzen.

### Kein Fehler

- Eingerückter Code (4 Leerzeichen) wird ein normaler Absatz: LiaScript kennt keine eingerückten
  Code-Blöcke. Er wird so angezeigt und daher auch vorgelesen.
