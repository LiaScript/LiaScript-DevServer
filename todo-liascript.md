# Todo LiaScript

Gefunden beim Test des Vorlesens im Chat des DevServers (2026-10-15, `@liascript/chat` 0.1.2--2.2.2,
`@liascript/editor` 1.2.0--2.2.2, Chrome). Was der DevServer selbst umgehen kann, macht `runs()` in
`views/chat.js`; das hier gehört in LiaScript.

## Fehler

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

## Sprache im Chat

- **`<lia-chat>` lässt sich keine Sprache geben.** Die Chat-App setzt `<html lang>` ihres iframes einmal
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

## Unterscheidbarkeit

- **Umfragen und Aufgaben haben keine eigene Klasse.** Eine Umfrage mit `[(1)]` (Radiobuttons) wird
  `lia-quiz lia-quiz-multiple-choice`, eine Aufgabenliste `- [ ]` ebenso. Von außen lassen sie sich nicht
  von einem Quiz unterscheiden. Vorschlag: `lia-survey`, `lia-survey--single`/`--multiple`, `lia-task`;
  die Umfrage mit Radiobuttons nicht `multiple-choice` nennen.

- **Umfragen und Aufgaben haben kein ARIA**, anders als das Quiz (`role="radiogroup"`/`"list"`,
  `aria-labelledby`, `role="listitem"`). Dasselbe dort ergänzen.

## Wunsch

- **Ein Text zum Vorlesen pro Nachricht** in `@liascript/chat`, z. B. `lia.speech(n)` mit
  `[{lang, text}]`. Der DevServer liest den Text heute selbst aus dem DOM und hängt an Klassen wie
  `.lia-quiz`, `.lia-effect__circle` oder `.lia-code--inline`, die sich mit jeder Version ändern können.
  LiaScript kennt die Bedeutung (Lösung eines Quiz nicht verraten, Formeln, Tabellen, Effekte) und
  könnte das auch für das eigene Vorlesen der Folien nutzen.

## Kein Fehler

- Eingerückter Code (4 Leerzeichen) wird ein normaler Absatz: LiaScript kennt keine eingerückten
  Code-Blöcke. Er wird so angezeigt und daher auch vorgelesen.
