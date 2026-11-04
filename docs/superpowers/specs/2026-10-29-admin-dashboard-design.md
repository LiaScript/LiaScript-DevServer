# Admin-Dashboard für `--users`: Einstellungen, Zugang, Warnungen, Kosten

> Das Aussehen dieser Seite hat sich mit `2026-11-04-lialms-design.md` geändert (der HUD von LiaLMS); ihre Funktionen bleiben.

## Absicht

Der Admin ist eine Lehrkraft ohne viel Technikwissen, die froh ist, wenn das Tool startet. Sie
startet es auf dem eigenen Rechner, damit ihre Klasse die Kurse und die KI nutzen kann. Der zweite
Fall: jemand arbeitet unterwegs an den eigenen Kursen weiter, die auf seinem Desktop liegen. Heute
geht das nur mit einem langen Befehl
(`--users ../klasse --courses ../LiaBooks --kit ../teaching-agent --lan --share -p 3500`). Ziel:
Ein kurzer Befehl reicht, alles Weitere stellt die Lehrkraft auf der Admin-Seite ein, mit einer
Erklärung zu jeder Option. Sie sieht dort auch, wenn die KI etwas abgelehnt hat, und was die KI
kostet.

## Ziele

1. **Kurzer Start:** `liadev --users klasse` genügt. Die Einstellungen kommen aus der zuletzt
   gespeicherten Konfiguration im Klassenordner, beim ersten Start aus Standardwerten. Die heutigen
   Parameter wirken weiter: angegeben überschreiben sie die gespeicherte Einstellung und werden mit
   gespeichert.
2. **Nach dem Start** öffnet sich die Admin-Seite von selbst im Browser. Im Terminal steht nur die
   Adresse.
3. **Eine Seite, das Wichtigste oben** (Entwurf A, gewählt). Oben drei Kästen nebeneinander,
   auf dem Handy untereinander:
   - **Zugang:** Internet (Share) und Schulnetz (LAN), je ein Schalter mit einem Satz Erklärung,
     der Link als echter Link (öffnet einen neuen Tab), Kopieren-Knopf, großer QR-Code. Beim
     Einschalten von LAN eine Warnung, dass Passwörter im Schulnetz unverschlüsselt laufen.
     „Neuer Link“ für Share: alte Links hören auf zu gehen, mit Rückfrage.
   - **Warnungen:** nur sichtbar, wenn etwas war, dann rot. Je Warnung: Name, Uhrzeit, was
     versucht wurde, Grund; Knöpfe „Chat ansehen“ und „erledigt“.
   - **Kosten:** Summe heute und ein kleines Diagramm der letzten 7 Tage.
4. **Nutzer darunter** wie heute, zusätzlich je Nutzer ein kleiner QR-Code mit dem Namen schon
   eingetragen und „Link kopieren“; ein Klick auf den kleinen QR-Code zeigt ihn groß (Beamer,
   Ausdruck). Die Kosten je Nutzer bleiben eine Spalte, mit Balken. Ist LAN an, gibt es den
   Link und QR-Code je Nutzer auch für das Schulnetz.
5. **Einstellungen unten, eingeklappt,** je mit Erklärung: KI-Modell je Rolle (Schüler, Autor),
   Webseiten im Chat an/aus, Leerlauf-Ende in Minuten, Kursordner, Teaching-Agent (Ordner).
   Gespeichert wird sofort beim Ändern; was erst beim nächsten Start einer Nutzer-Instanz wirkt,
   steht daneben.
6. **Share und LAN schalten zur Laufzeit:** an startet sofort, aus stoppt sofort. Offene Tabs der
   Schüler verlieren dann die Verbindung, das steht am Schalter.
7. **Warnungen, wenn die KI etwas ablehnt,** auf zwei Wegen:
   - Der Server lehnt ab: der Agent eines Nutzers bittet um Erlaubnis für ein Werkzeug, und
     `permission()` in `src/acp.ts` lehnt ab (heute nur `console.error('🤖 refused: …')`).
   - Die KI lehnt selbst ab, der häufige Fall: die Regeln lassen sie Befehle, Dateien außerhalb
     des Kurses und Geheimnisse selbst verweigern, sie fragt dann gar nicht erst. Dafür ein neues
     Werkzeug `report_refusal` (ein Satz Grund, was versucht wurde), das die Regeln für Agenten
     unter `--users` aufrufen lassen, wenn sie so etwas ablehnen.
   Warnungen werden im Klassenordner gespeichert, überstehen einen Neustart und bleiben bis
   „erledigt“ sichtbar.
8. **Kosten je Tag:** zusätzlich zur Summe je Chat-Session (`.chats/.acp-costs.json`) die Kosten
   je Nutzer und Tag, für das Diagramm. Kosten von vor dieser Änderung fehlen im Diagramm.

## Nicht-Ziele

- Die Sandbox abschalten: eine Sicherheitsentscheidung, kein Klick. Bleibt nur `--no-sandbox`.
- Den Klassen-Chat oder Schülertexte auf Beleidigungen o. Ä. prüfen; Warnungen gibt es nur für
  das, was die KI ablehnt.
- Ein Login für die Admin-Seite: sie bleibt nur auf diesem Rechner erreichbar (loopback,
  `Host`- und `Origin`-Prüfung wie heute).
- Passwörter wieder anzeigen: sie liegen nur als scrypt-Hash vor. Kopieren geht nur direkt nach
  dem Anlegen oder Neusetzen.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch geht)

- Der Lehrer muss doch wieder Parameter oder Dateien kennen, um Share oder LAN an- und
  auszuschalten.
- Ein Passwort steht im QR-Code oder im Link: ein abfotografierter QR-Code am Beamer ließe jeden
  als diesen Schüler herein.
- Die Warnungen bleiben fast immer leer, weil nur die seltenen Server-Ablehnungen zählen.
- Ein Schalter, der nicht sagt, dass er gerade offene Tabs trennt.

## Vorgaben

- Alles in `src/gateway.ts` (Admin-Seite, Front, LAN) und `src/acp.ts` (Erlaubnis, Kosten),
  Share über `share()` von `src/share.ts`, das heute nur einen Start kennt: es braucht ein Stoppen
  (Signalling schließen, Verbindungen schließen, `claim()`-Datei freigeben).
- Die Admin-Seite wird heute auf dem Server als HTML-String gebaut, ohne Build; das bleibt so.
- Gespeicherte Einstellungen im Klassenordner, Datei `0600` wie `users.json`.
- `--proxy`: die Instanzen der Nutzer bekommen heute keinen; „Webseiten aus“ heißt `--proxy off`
  für jede neu gestartete Instanz.
- Der Name im Link: Share `#…&user=<name>` (das Fragment sieht kein Server), LAN `?user=<name>`;
  die Login-Seite (`/lia-login`) füllt das Namensfeld damit vor.
- QR-Codes auf dem Server als SVG. Es gibt im Projekt keine QR-Bibliothek. **Meine Wahl:**
  `qrcode-generator` (MIT, ohne Abhängigkeiten).
- Die Server-Anweisungen von `mcp.ts` stehen bei 2046 von 2048 Zeichen: die Regel zu
  `report_refusal` gehört in die Beschreibung des Werkzeugs und in `RULES` von `acp.ts` (nur für
  `--users`), nicht in die Anweisungen.
- `check.js` deckt das Gateway mit einem Stub-Agenten ab; neue Logik bekommt dort einen Test:
  Einstellungen speichern und wieder laden, Parameter überschreiben, eine abgelehnte Erlaubnis und
  ein `report_refusal` erscheinen als Warnung, Kosten je Tag.

## Entscheidungen nach der Prüfung

Von der Lehrkraft: **Autoren arbeiten wie Schüler auf ihrer eigenen Kopie** der Kurse im
Klassenordner, auch von unterwegs. Der zweite Fall aus der Absicht braucht also nichts Neues am
Start, an der Sandbox oder an den Kurs-Updates: ein Autor-Nutzer und Share genügen.

Meine Wahl, zum Gegenlesen:

- **Kurs eines Nutzers:** `users.json` merkt sich beim Zuweisen den absoluten Pfad des Kurses,
  nicht nur den Namen. Ein Wechsel des Kursordners lässt zugewiesene Kurse unberührt; ein
  Update läuft immer gegen den Kurs, den der Nutzer bekommen hat. Bestehende Einträge mit nur
  einem Namen werden beim Start einmal gegen den gespeicherten Kursordner aufgelöst. Sonst würde
  ein gleichnamiger Kurs im neuen Ordner beim Update die Dateien des Schülers ersetzen.
- **Ordner wählen** (Kursordner, Teaching-Agent): eine kleine Ordnerliste auf der Admin-Seite,
  beginnend im Home-Verzeichnis der Lehrkraft, nur Ordner, nur darunter. Die Seite ist nur auf
  diesem Rechner erreichbar; Kursordner zeigt daneben, wie viele Kurse er enthält.
- **Modelle:** eine Auswahl „Standard / Haiku (günstig) / Sonnet / Opus (teuer)“, als Alias in
  `ANTHROPIC_MODEL`. Nur bei `--agent claude` sichtbar; sonst steht dort, dass der Agent sein
  Modell selbst wählt.
- **Was vom Start gespeichert wird:** Kursordner, Teaching-Agent, Admin-Port, Agent, Modelle,
  Share an/aus mit Adresse der Share-Seite und `--share-web`, LAN an/aus mit Port. **Nie**
  gespeichert: `--no-sandbox` (gilt nur für diesen einen Start, sonst wäre ein Start ohne
  Sandbox für immer) und `--share-new` (eine einmalige Aktion; dafür gibt es „Neuer Link“).
- **Name im Share-Link:** `share/lia-share.js` reicht `user` aus dem Fragment an die
  Login-Seite im Frame weiter; die Seite wird danach neu nach LiaScript/share veröffentlicht. Ein
  Tab mit der alten Share-Seite geht weiter, nur ohne vorausgefüllten Namen.

## Standardwerte beim ersten Start

Share aus, LAN aus (Port 8000), Webseiten im Chat an, Leerlauf-Ende 15 Minuten, Modell: der
Standard des Agenten, Kursordner: der Ordner, in dem gestartet wurde, Teaching-Agent aus, bis ein
Ordner gewählt ist, Admin-Port 3000.

## Dem Bauenden überlassen

- Name und Form der Einstellungsdatei und der Warnungsdatei.
- Wie die Kosten je Tag entstehen (z. B. `acp.ts` legt die Differenz jedes `usage_update` auf
  den Tag), solange die Summe je Session gleich bleibt.
- Wie die Seite ohne Neuladen aktualisiert (heute: `fetch` alle 5 s für Tabelle und Log).
- Die genauen Texte der Erklärungen, deutsch, ein bis zwei Sätze, ohne Fachwörter.
- Wie das Diagramm gezeichnet wird (inline SVG genügt).
