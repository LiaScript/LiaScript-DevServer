# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LiaScript-DevServer (`@liascript/devserver`, CLI names `liascript-devserver` / `liadev`) is a small Express-based
local development server for previewing [LiaScript](https://LiaScript.github.io) Markdown courses in the browser,
with optional live-reload on file change.

## Build commands

```bash
npm run build    # parcel-bundles src/index.ts -> dist/index.js, adds shebang, then builds the lib
npm run lib      # tsc-compiles src/lib.ts -> dist/lib.js (+ .d.ts), commonjs module, for programmatic use
npm run shebang  # prepends #!/usr/bin/env node to dist/index.js and chmods it executable
node src/check.js  # end-to-end check of --mcp against the BUILT dist/index.js, so run `npm run build` first
```

`build` always runs `shebang` and `lib` afterward. There is no separate lint or test script. The only automated
check is `src/check.js`: it spawns `dist/index.js --mcp`, speaks JSON-RPC to it and treats every stdout line as
protocol, so it also fails on a stray `console.log`. Never call the `chat` or `goto` tool in it without a fake SSE
client connected, they open a real browser otherwise. There's no dedicated `tsconfig.json`; `lib` compiles
`src/lib.ts` directly via CLI flags (`--module commonjs -d --outDir dist`).

Two build outputs come from the same `lib.ts` code for different consumers:
- `dist/index.js` — parcel-bundled CLI executable (entry: `src/index.ts`, which parses argv and calls into `lib.ts`)
- `dist/lib.js` (+ `.d.ts`) — plain tsc output, importable as a library (`server.init(...)`, `server.start(...)`) by
  other Node programs that want to embed the dev server

When changing `src/lib.ts`, keep both build paths in mind — a change that works under parcel's bundling may need
checking under plain tsc output too (e.g. `require(...)` for untyped deps vs `import`). `src/mcp.ts` is imported by
`src/index.ts` only, so it goes through parcel alone and is never type-checked by the `lib` build. Parcel leaves
`node_modules` external; anything new under `views/` ships automatically (npm tarball and `pkg.assets`), a new
top-level folder would not.

### Releases

Pushing a git tag triggers two independent GitHub Actions workflows (`.github/workflows/`):
- Builds standalone binaries with `pkg` for win/linux/macos (`npm run release_*`) and attaches them to a GitHub Release
- Publishes the npm package (`npm run build` then `npm publish`)

Both the CLI version string (in `src/index.ts`'s `--version` output and `package.json`'s `version` field, formatted
`<devserver-version>--<liascript-version>`) and the version banner rendered in `views/main.hbs` need to stay in sync
when bumping versions.

## Architecture

The server lives in two files, the agent bridge (`--mcp`) adds a third and a chat page:

- **`src/index.ts`** — CLI entry point only. Parses argv with `minimist`, handles `--help`/`--version`, then calls
  `server.init()` and `server.start()` from `lib.ts`. With `--mcp` it first redirects `console.log` to stderr
  (stdout then belongs to the MCP protocol) and starts `mcp()` from `mcp.ts`.
- **`src/lib.ts`** — all server logic, exported so it can also be used as a library (see `init`, `start`, `stop`,
  `gotoLine`). Sets up an Express app that:
  - Serves the compiled LiaScript player from `node_modules/@liascript/editor/dist` (resolved as `liascriptPath`) at
    `/liascript/*`, injecting a small `gotoScript` snippet into `index.html` on the fly (string-replacing `</head>`)
    to wire up bidirectional "goto line" communication between the LiaScript editor and the served preview.
  - Serves the user's project files (the `--input` folder) at `/home/*` for a browsable file listing (rendered via
    `views/main.hbs` inside the `index` layout — note this route explicitly overrides handlebars' `defaultLayout:
    'main'` with `layout: 'index'`, so `views/layouts/index.hbs` is the actual page shell and `main.hbs` is the
    content partial), and as raw files/redirects everywhere else under `/*`.
  - When a `.md` file is requested under `/home/*`, redirects to the LiaScript player with the file as a query
    param (`/liascript/index.html?http://host:port/path/to/file.md`), or to the online LiaScript.github.io player
    if `--test` is set.
  - Optional live reload (`--live`): uses `chokidar` to watch the target file/folder and the `reload` npm package to
    push browser refreshes over its injected `/reload/reload.js` client script. `reload` 3.x runs its own `ws`
    WebSocket server on `port + 10000` (see `reloadPort`), not socket.io — the `/socket.io` skip in the catch-all
    route is a leftover that never matches. The client does a full `window.location.reload()` of the player page.
  - Optional `--responsiveVoice` support: injects the responsiveVoice script tag with a given/default key (also
    readable from `RESPONSIVE_VOICE_KEY` env var).
  - "Goto line" feature: `/gotoLine` (SSE endpoint, `eventsHandler`) streams line-goto events to connected browser
    clients; `POST /lineGoto` receives `{linenumber, filename}` from the browser and forwards to an optional
    `gotoCallback` passed into `start()` — this is the hook a library consumer uses to sync clicks in the rendered
    preview back to their own editor. The SSE stream is generic: `send(msg)` broadcasts any JSON to every client and
    `gotoLine` is one user of it; each browser script picks the messages it knows (`linenumber`, `goto`, `chat`).
  - Agent bridge primitives, active only when `start()` gets `agent = true` (the 9th positional parameter) and free
    of any MCP knowledge, so another adapter (e.g. an ACP host mode) can sit on the same three exports:
    `getState()` (what the browser last reported: file, 1-based slide, title, selection, `connected`, `chat`, plus
    `events` and `watched`, see below), `send()`, and `bus` (an `EventEmitter` with `'state'` and `'event'`). The
    browser reports through `POST /agent` with one envelope `{type: state|command|chat|answer, agent, cmd, params,
    context}`; the route validates and caps every field and attaches the cached state as `context`. A fifth type,
    `connection` with `params: {connected, chat}`, comes from the server itself: the SSE handler emits `'state'` on
    every open and close, and a change that lasts 2 s (`SETTLE_MS`, so F5 and live reloads do not count) becomes
    this event, so an agent notices a closed tab without polling. Every event
    also goes as one JSON line (`<` escaped) to the readers of `GET /agent/events/<token>` (`getState().events`,
    `watched` = someone reads it): a stream for agents that watch a command, i.e. Claude Code's Monitor tool running
    `curl -sN`. The random token keeps other local users and pages out, a request with an `Origin` is refused. `agentScript` (a second injected snippet next to
    `gotoScript`) reports slide/title/selection, handles `goto` messages and turns clicks on `agent:` links into
    `command` events. In agent mode the server binds to loopback, checks `Host` on every route and `Origin` on
    `POST /agent`, and `.md` redirects go to the chat shell instead of the bare player. It also moves to the next
    free port when the requested one (or its reload port) is busy: every MCP client spawns its own instance from
    the same config, and VS Code autostarts a workspace `.mcp.json` for Copilot next to Claude Code's spawn, so a
    fixed port meant `EADDRINUSE` and a bare "connection closed" in the client.
- **`src/mcp.ts`** — the MCP adapter: a dependency-free newline-delimited JSON-RPC server on stdio (deliberately
  not the MCP SDK, see the header comment) with the tools `get_state`, `goto`, `chat` and `wait_for_event`. Every
  `'event'` on the bus is also pushed as `notifications/claude/channel`, which Claude Code turns into a
  `<channel>` tag in the running session (research preview, needs
  `claude --dangerously-load-development-channels server:<name>`). It must never negotiate protocol revision
  `2026-07-28` and never declare `claude/channel/permission`. Channels only work in the terminal UI, not in the
  chat panel of the VS Code extension (checked), so the instructions name three ways in order: channel, Monitor on
  `get_state.events`, `wait_for_event`. While `watched`, a `chat` form returns at once with its `ask` id instead
  of blocking, otherwise the answer would arrive twice (tool result and stream line). `chat` with only `status`
  sets the progress line below the messages (the SSE message `{status}`, no browser is opened for it); a message
  keeps it only if it carries a `status` itself. Screenshots, console and clicks are deliberately no tools of the
  bridge: the instructions tell an agent with browser automation tools (Playwright, Chrome DevTools) to open
  `get_state.url` there before the first `goto` or `chat`, unless a tab is connected already. Those tools drive a
  browser of their own and cannot attach to the user's, and two connected tabs overwrite each other's state.
  Claude Code cuts the instructions and every tool description at 2048 characters
  (`CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH`; verified for the instructions in 2.1.285), `src/check.js` holds that
  limit: rules go first, details into the tool descriptions and tool results. Text-to-speech is such a detail:
  `agentScript` reports the number of `speechSynthesis` voices and `navigator.webdriver`, `getState()` returns
  `voices` and, only when there are none and the player has no `responsiveVoice` loaded, a `tts` hint
  (`ttsHint()` in `lib.ts`). `--responsiveVoice` without a key injects `key=true`, which the service rejects.
  Automation tools start Chrome with `--disable-component-extensions-with-background-pages`, which removes its
  online voices.
- **`views/chat.html` + `views/chat.js`** — the chat shell served at `/liascript/chat.html`: the player in a
  same-origin iframe with the chat on top, so a live reload only reloads the iframe. The script is a separate file
  because the page's CSP allows no inline scripts. Every message has a read-aloud button (`speaker()` in `chat.js`):
  `speechSynthesis` with a voice for the language the player puts on its `<html lang>`, split into pieces of at
  most 180 characters because Chrome drops an utterance of its online voices after about 15 seconds; without
  browser voices it uses the `responsiveVoice` object of the player if there is one, else the buttons stay hidden.
  The `chat` tool takes an optional `lang`, which becomes the `lang` attribute of the message; `runs()` splits a
  message into passages by the closest `lang` attribute inside the log (never the one of the page itself), so
  `<span lang="fr">` in the Markdown gets a French voice.

Things the player does that the bridge works around (verified against the minified bundle of `@liascript/editor`,
re-check after upgrading it): since 2.1.0 `agent` is in the scheme whitelist of the link parser, so the href
arrives as written, but still with `target="_blank"`, and the capturing click handler has to stop it (before
2.1.0 the href became `<base>/agent:…`); `agent://tutor/explain` is accepted as `agent:tutor/explain`, the handlers
in `agentScript` and `views/chat.js` drop the slashes because `new URL()` would read `tutor` as the host;
`window.LIA.goto(n)` (0-based)
ignores a repeated request for the same slide even if the user moved away, so navigation sets `location.hash`
(1-based) instead; slide changes use `history.pushState` and fire no event, so `agentScript` patches it; the
player's `message` listener has an `eval` command without an origin check, so `agentScript` registers a gate first.

`agentScript` and `gotoScript` are template literals: keep them free of backslashes, backticks and `${`.

Design and the research behind it: `docs/superpowers/specs/2026-09-18-agent-bridge-design.md`.

Apart from the chat shell there is no client-side JS source in this repo (the LiaScript player itself comes from
the `@liascript/editor` npm dependency), and no database — this repo is the Node/Express serving layer around it.
