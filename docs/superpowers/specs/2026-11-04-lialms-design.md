# LiaLMS: chat on phones, HUD dashboard, personal login

Date: 2026-11-04. Mockups: the Design canvas "LiaLMS"
(https://claude.ai/artifact/2EKTZjhDuFoo1Mfix3F3GB, private), artboards named below.

The product is called **LiaLMS** from now on, in every title a user or teacher sees (admin page, login, share
page, chat shell). The npm package, the CLI names, the file listing of the plain DevServer and the code keep
their names.

## 1. The chat on a phone (artboards "A · Umschalten — Kurs", "A · Umschalten — Chat")

Chosen: variant A, switching. Variant B ("Übereinander") stays on the canvas for comparison only and is not built.

- Applies below `WIDE` (768 px), where the chat already always floats. Above it nothing changes.
- The chat and the course each fill the whole screen; one shows at a time.
- A bottom bar with a segmented control of two segments, `Kurs` and `Chat`, at least 48 px high, thumb reach.
  - `Kurs` shows the slide number in mono (`#3`) while the chat is shown (the shell knows no slide count).
  - `Chat` carries a badge with the number of agent messages that arrived while the course was shown
    (unread). Opening the chat resets it to 0.
- Course view: above the bar a "peek" card with the robot and name of the agent and the first line of the
  newest agent message (one line, ellipsis), shown when an agent message arrived unread. A tap opens the chat.
  It also shows while a progress line (`status`) runs, with that text instead.
- Chat view: a strip at the top, `Du bist auf Folie 3 · <title>`, with `Zum Kurs` (switches back). For a web
  page or listing it names that instead.
- A `goto` of the agent switches to the course view (the user should see where it moved them); a chat form
  (`ask`) of the agent switches to the chat.
- The input field uses 16 px text (iOS zooms below that) and the bar respects `env(safe-area-inset-bottom)`.
- The choice survives F5 (`localStorage`), the first visit on a phone opens the course.
- Texts in English keys with German in `TEXTS` like every other text of the shell.

## 2. The dashboard (artboard "Dashboard")

The admin page of the gateway, same functions as today, new look: a HUD.

- Look: light or dark as today: the system's, unless the sun/moon switch (cookie `lia-theme`) chose. Dark:
  ground `#070b0d` with a 32 px grid of `rgba(94,234,212,0.035)` lines, panels `rgba(13,19,22,0.92)`, lines
  `#16262a`/`#1e3a3a`, text `#e3eef0`/`#b7c8cb`/`#8aa0a5`, accent `#2dd4bf` (on it `#04201d`), labels
  `#5eead4`, help amber `#fbbf24`, warnings red `#f87171`/`#fca5a5`, authors violet `#c4b5fd`. Light: ground
  `#f3f6f6`, grid `rgba(15,118,110,0.07)`, panels `#ffffff`, lines `#dce5e5`/`#c6d4d4`, text
  `#0f1a1c`/`#34474a`/`#56686b`, accent `#0f766e` (on it `#ffffff`), help `#b45309`/`#92400e`, warnings
  `#dc2626`/`#b42318`, authors `#6d28d9`. QR codes stay black on white and get a 1 px border in light.
- Type: Geist (already shipped) for text, Geist Mono for labels, numbers, links and the section numbers.
  Labels upper case with letter spacing 0.12–0.16em, 11 px.
- Sections numbered in mono: `00 · ZUGANG`, `01 Nutzer`, `02 Signale`, `03 Klassenchat`, `04 Neuer Nutzer`,
  `05 Einstellungen`, `06 Häufige Fragen`. The sticky top bar: logo (outlined pixel robot) + `LiaLMS`, the
  nav, `● n ONLINE` (pulsing dot), language DE/EN, theme switch.
- 00 Zugang keeps everything of today: the share switch, the big QR code (button, opens the large view) with
  four corner brackets in the accent, the link, `Link kopieren`, `Öffnen`, `Neuer Link`; the LAN switch, the
  unencrypted warning, each address with a small QR, `Kopieren`, `Öffnen`, the port form.
- The stats row: online, need help (names as links), costs today with the 7 day bars, recent notices. Each
  card a 2 px stripe of its colour on the top edge.
- 01 Nutzer: per user the QR code (name filled in) and the copy buttons per address, role badge, muted
  badge, status, course column (update, assign, job progress), where (with the help badge), chat (entries,
  read along), cost with bar, manage (password, mute, delete). Rows of users who need help get an amber tint
  and a 2 px amber edge. Filter chips `Alle`, `Online`, `Brauchen Hilfe`, `Autoren` (client side) and a name
  search (client side).
- 02 Signale: the open warnings (red edge, `Chat ansehen`, `Erledigt`) and the users who need help (amber
  edge, `Chat ansehen`), newest first, with time in mono. Replaces the red warning card.
- 03 Klassenchat, 04 Neuer Nutzer, 05 Einstellungen, 06 Hilfe: same forms and texts as today.
- No inline style or script (the CSP stays), everything in `views/admin/`.

## 3. The login (artboards "Login · Lernende", "Login · Autor")

- Before the password the page knows only the name from the link (`&user=` / `?user=`) and shows no role:
  `Hallo, <name>.`, the robot companion with `Schön, dass du da bist!`, the lead text, the newest message of
  the teacher to `@all` (sender, time, text; none: the block is left out), the card with initial, name,
  `Nicht du?` (empties the name field and shows it), password with show/hide, `7 Tage angemeldet bleiben`,
  `Weiter`, `Passwort vergessen? Frag deine Lehrkraft, sie kann dir ein neues geben.`, the footer
  `Verschlüsselte Verbindung direkt zum Rechner deiner Schule` (share) or nothing (LAN, it is plain HTTP).
- Without a name in the link: a name field as today.
- After a correct password the page shows for about 1.2 s the version of the role, then continues as today:
  - learner: teal `#147375`, `Weiterlernen …`, the companion robot.
  - author: indigo `#4c3bb8`, ground `#f5f4fb` with a 28 px grid, `Willkommen zurück, <name>.`,
    `Werkstatt für Autoren`, the Teaching-Agent robot (glasses, pencil), `Weiterschreiben …`.
- A wrong password, the lock after five tries: the messages of today, in the new card.
- German and English like the admin page (`Accept-Language`, none = German).

## Out of scope

Variant B, a dark login, any change of what the gateway can do.
