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
check is `src/check.js`: it spawns `dist/index.js --mcp` in a temporary project folder (the chats land in its
`.chats/`, not in the repo), speaks JSON-RPC to it and treats every stdout line as protocol, so it also fails on a
stray `console.log`. It also runs `views/teachers.js` in a `vm` sandbox and renders every persona. `--share` it runs against a y-webrtc signalling server of
its own on loopback, with a werift tab that speaks `share/lia-rtc.mjs` (wrong key, restart of the signalling), and the
switch of `--mcp` with two instances and a `HOME` of its own. Never call the `chat` or `goto` tool in it without a fake SSE
client connected, they open a real browser otherwise. There's no dedicated `tsconfig.json`; `lib` compiles
`src/lib.ts` directly via CLI flags (`--module commonjs -d --outDir dist`).

Two build outputs come from the same `lib.ts` code for different consumers:
- `dist/index.js` — parcel-bundled CLI executable (entry: `src/index.ts`, which parses argv and calls into `lib.ts`)
- `dist/lib.js` (+ `.d.ts`) — plain tsc output, importable as a library (`server.init(...)`, `server.start(...)`) by
  other Node programs that want to embed the dev server

A third, `views/teachers.js`, is the parcel target `teachers` (browser, global, entry `src/teachers/teachers.ts`): the
catalog of the teacher personas and their DiceBear portraits for the chat. It is a build artefact (`.gitignore`) and
still ships, because npm reads `.npmignore`. DiceBear is ESM only and a devDependency: never import it outside
`src/teachers/render.ts`.

When changing `src/lib.ts`, keep both build paths in mind — a change that works under parcel's bundling may need
checking under plain tsc output too (e.g. `require(...)` for untyped deps vs `import`). `src/mcp.ts` is imported by
`src/index.ts` only, so it goes through parcel alone and is never type-checked by the `lib` build. Parcel leaves
`node_modules` external; anything new under `views/` ships automatically (npm tarball and `pkg.assets`), a new
top-level folder would not.

### Releases

Pushing a git tag triggers two independent GitHub Actions workflows (`.github/workflows/`):
- Builds standalone binaries with `@yao-pkg/pkg` (Node 22, `vercel/pkg` stops at 18, too old for hammerhead) for win/linux/macos (`npm run release_*`) and attaches them to a GitHub Release
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
  `gotoLine`, `readChat`). Sets up an Express app that:
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
  - Optional live reload (`--live`): uses `chokidar` to watch the target folder (also the folder of a single input
    file) and the `reload` npm package to push browser refreshes. chokidar 4 has no globs, so `ignored()` skips
    hidden files and folders and `node_modules` below the root, and every file whose extension is missing from
    the list of `--watch md,css` (default `WATCH`, the 10th parameter of `start()`, `*` for all, implies `--live`). Browser
    refreshes go out over reload's injected `/reload/reload.js` client script. `reload` 3.x runs its own `ws`
    WebSocket server on `port + 10000` (see `reloadPort`), not socket.io. The client does a full `window.location.reload()` of the player page.
    `changed()` bundles: one reload 300 ms after a burst (`BURST_MS`), and while an agent works (a progress line
    shows and it reacted, not `pending`) at most every 30 s (`HOLD_MS`) after the last reload, so its first write reloads at once; the end of the progress
    line reloads at once too.
    In agent mode a `.md` file reloads only if the preview shows it or the shown file names it (`shows()`, for
    `import:`), an agent writing `journal.md` reset the quizzes of a user in `README.md`.
  - Optional `--responsiveVoice` support: injects the responsiveVoice script tag with a given/default key (also
    readable from `RESPONSIVE_VOICE_KEY` env var).
  - "Goto line" feature: `/gotoLine` (SSE endpoint, `eventsHandler`) streams line-goto events to connected browser
    clients; `POST /lineGoto` receives `{linenumber, filename}` from the browser and forwards to an optional
    `gotoCallback` passed into `start()` — this is the hook a library consumer uses to sync clicks in the rendered
    preview back to their own editor. The SSE stream is generic: `send(msg)` broadcasts any JSON to every client and
    `gotoLine` is one user of it; each browser script picks the messages it knows (`linenumber`, `goto`, `chat`). A `?chat` stream gets
    `{ping: true}` every 20 s (`PING_MS`): the shell opens a stream anew that stayed silent for 50 s (a dead
    one without error was seen in Firefox) and shows a hint while it reconnects.
  - Agent bridge primitives, active only when `start()` gets `agent = true` (the 9th positional parameter) and free
    of any MCP knowledge, so another adapter (e.g. an ACP host mode) can sit on the same three exports:
    `getState()` (what the browser last reported: file, 1-based slide, title, selection, `connected`, `chat`, plus
    `events`, `watched` and `session`, see below), `send()`, and `bus` (an `EventEmitter` with `'state'` and
    `'event'`). The browser reports through `POST /agent` with one envelope `{type: state|command|chat|answer|session|activity|store,
    agent, cmd, params, context}`; the route validates and caps every field and attaches the cached state as `context`. A fifth type,
    `connection` with `params: {connected, chat}`, comes from the server itself: the SSE handler emits `'state'` on
    every open and close, and a change that lasts 2 s (`SETTLE_MS`, so F5 and live reloads do not count) becomes
    this event, so an agent notices a closed tab without polling. Only F5 of the shell (the last `?chat` stream
    closed and a new one came within that time) is an event despite the same state, `reloaded: true`. Every event
    also goes as one JSON line (`<` escaped) to the readers of `GET /agent/events/<token>` (`getState().events`,
    `watched` = someone reads it): a stream for agents that watch a command, i.e. Claude Code's Monitor tool running
    `curl -sN`. Events while nobody reads it (at most 20, 60 minutes back, `missed`) go to the next reader first, so
    restarting an expired Monitor loses nothing. The random token keeps other local users and pages out, a request with an `Origin` is refused. `agentScript` (two script tags injected after
    `gotoScript`: `views/activity.js` and `views/agent.js`, which reuses its `filename__` and `events`) reports slide/title/selection, handles `goto` messages and turns clicks on `agent:` links into
    `command` events. In agent mode the server binds to loopback, checks `Host` on every route and `Origin` on
    `POST /agent`, and `.md` redirects go to the chat shell instead of the bare player. A folder under `/home` opened
    as a page (`Sec-Fetch-Dest: document`) becomes `chat.html?/home/…`, the listing in the shell's frame; there its
    `.md` links go to the bare player (`Sec-Fetch-Dest: iframe`), `chat.js` reports a listing as `file: ''` with the
    folder as `title` and turns a `goto` with `file` into a player itself. Web pages (`src/web.ts`): the shell can
    show any web page and keep the chat, to read it together with the agent. A proxy on a server and origin of its
    own (`webPort()` = port + 20000, same `Host` check, no `/agent`, cookies never passed on) fetches only the HTML
    document, without cookies. It inserts `<base href>` of the real address and `views/web.js`, which reports
    `{web, title, selection}` by `postMessage` to the shell and keeps links and GET forms in the proxy. Styles,
    images and the page's scripts load from the site itself. The proxy answers with a whitelist of headers
    (`frame-ancestors` = the shell), and a non-HTML answer becomes a redirect to the site. `allowed()` lets through
    public addresses only (SSRF: the page's scripts could otherwise read the LAN through the proxy). It checks the
    `lookup` of every hop and an IP in the URL itself, which asks no DNS. Ways in: `GET /web?url=` of the main app
    (redirect to the proxy, used by all of them), external links of a course in the shell (`agent.js`), the 🌐
    address field of `chat.js` and `goto({url})`. The state gets `web`, `getState().url` becomes
    `chat.html?web=…`, and the event context carries `web` only while it is set (`eventContext()`). Limit: a
    relative `pushState` resolves against the `<base>` and throws, so single page apps break. `views/web.js` polls
    address and title every second, `pushState` and a replaced `<title>` fire no event. `--proxy off|read|full` (11th
    parameter of `start()`, `getState().proxy`, replayed as `{proxy}` to every `?chat` stream after the chat, which sets
    `data-proxy` on the shell's `<html>`) picks the level: `off` starts no proxy, `/web` answers 404, the 🌐 button
    hides, `agent.js` leaves external links to a new tab and `goto({url})` fails. `read` is the proxy above. `full`
    is experimental (`src/full.ts`, runs under the other loopback name than the shell: x.com in a frame of the same
    site hung Firefox, see its header; `testcafe-hammerhead`, required only then, Node ≥ 20, its `lib/client` in
    `pkg.assets`) rewrites every request of the page through its two servers (`webPort()` and `webPort2()` =
    port + 30000) under
    `/<session id>/<url>`: cookies (one jar per server, in memory), POST, WebSockets, single page apps. hammerhead
    listens on every interface and checks no `Host`, so `startFull()` wraps its `createServer` (bind + `Host`
    check) and replaces the 9-character session id by 32 hex characters, the token of the proxy. A request hook
    blocks an IP in the URL and sets `requestOptions.lookup` to `web.lookup` (http2 off, it would ignore it), and
    drops `x-frame-options`; hammerhead drops every CSP itself and cannot add `frame-ancestors`. It injects
    `views/web.js` unprocessed: there `document.baseURI` is the real address and `parent.postMessage` native, the
    link and form handling is skipped (`%hammerhead%`). The browser extension (`extension/`, MV3, not in the npm
    package, loaded unpacked) is the way to pages with the user's own logins: `shell.js` marks the shell
    (`data-lia-extension` `pending`, then `ready` and the event `lia-extension` once `background.js` has added a
    session rule for that tab: `x-frame-options` and CSP removed for its `sub_frame`s, not those of localhost).
    `chat.js` `webPage()` then loads the real URL (the first `?web=` waits up to 1 s, `whenExtension()`), `agent.js`
    uses the shell's `webPage()`. `page.js` in the direct child frame of a shell tab reports like `web.js`, to the
    shell's origin only (asked from `background.js`, which reads `sender.tab.url`, no state of its own). It also moves to the next
    free port when the requested one (or its reload port) is busy: every MCP client spawns its own instance from
    the same config, and VS Code autostarts a workspace `.mcp.json` for Copilot next to Claude Code's spawn, so a
    fixed port meant `EADDRINUSE` and a bare "connection closed" in the client.
  - Who the user talks to: `setAgent()` / `currentAgent()` hold a roster of `{name, emoji}` and the current name
    (`getState().agent` and `.agents`, kept out of `state` so the event context stays the same). Every change goes
    out as `{agents: {current, list}}` and is replayed to each new `?chat` stream, so a reloaded shell knows it.
    `chat` and `answer` events carry the current agent in `agent`. A `command` with `cmd: 'switch'` and a roster
    name (the agent menu of the chat, or a course link `agent:<name>/switch`) switches at once, before the event
    goes out; an unknown name stays a plain command. Every `chat`, `answer` and `command` (except a switch the
    server handled) sets the progress line to `Waiting for the assistant…` before the event goes out, so the user
    sees at once that it arrived. A quiz `activity` carries `view`; a hit at the first try (`activity.js` sends it) goes out only in the learner
    view, a companion could not tell solved from untouched; after `resolved` `input` is LiaScript's solution and
    `answer` what the learner gave. An `activity` gets `params.help = 'true'` from the server alone (`needsHelp()`: the
    3rd wrong check of a quiz, `resolved`, the 3rd failed code run; once per task until it is solved) and, if no
    progress line shows, `Looking at your answer…`; the agent then has to answer or clear the line. Both turn into
    `Thinking…` with the first sign of an agent: `activity()`, which
    `mcp.ts` calls on every tool call and when it hands an event to a waiting call, and which a watcher of the event
    stream counts as too. While a progress line shows, a timer (`watchQuiet()`) puts a `{hint}` below it: after 30 s
    without any sign since the event (`NO_REACTION`, maybe no agent is connected: the server cannot know whether a
    channel would wake an idle one), or after 60 s of silence from an agent that did react (`QUIET`, e.g. a
    permission prompt in the terminal, which the text does not mention: it worried users while the agent worked).
    A change of a watched file counts as a sign too. The agent's next status or message replaces both.
  - Chat sessions (`src/chats.ts`, a file store without Express): every chat is one `.chats/<id>.json` in
    `process.cwd()`, the project the MCP client opened, so it can be committed and continued by someone else. The id
    is UTC time plus random hex (no merge conflicts, no clash between twin instances), the file is valid JSON with
    one entry per line, rewritten on every entry: `ai {markdown, ask, inputs, agent, lang}` (recorded in `send()`
    from a `chat` message, `ask`/`inputs` only for a form), `user {text}`, `answer {ask, values}` and `command {agent, cmd, label, params}` (recorded in
    `POST /agent`, a command only with the link text as `label`, which `agentScript` and `chat.js` send along).
    Answers and commands also go to every shell as `{entry}`, which shows them as a compact bubble of the user.
    After the entries the file holds `db` (`chats.store()`): the states of the quizzes, surveys and tasks of the
    chat messages, and of their code with every version and its output, as `@liascript/chat` stores them, per table
    (`STORED`) and entry number. `POST /agent`
    type `store` `{table, n, data}` replaces one, only for an `ai` entry and up to 90000 characters (`STORE_MAX`, else it is not saved), and emits no
    event (the `activity` does). Every `{chat}` carries `n`, its entry number. A session gets its file with the first entry. On start the server continues the session that
    changed last. The progress line and the roster are kept in memory only (quiet diffs, the agent sends them again
    after a restart). Every `?chat` stream first gets `{sessions: list}`, `{session: {id, entries}}`, the agents and
    `{status}`, so F5, a restart and messages sent while no tab was open are covered. `POST /agent` type `session`
    with `params.id` (or none: a new chat, unless the current one is still empty) switches, broadcasts both
    messages and emits a `session` event with `{id, title, resumed}`. The title is the first user message, see
    `chats.title()`.
- **`src/mcp.ts`** — the MCP adapter: a dependency-free newline-delimited JSON-RPC server on stdio (deliberately
  not the MCP SDK, see the header comment) with the tools `get_state`, `goto`, `chat`, `set_agent`, `find_teacher`, `read_chat`,
  `wait_for_event`, `outline`, `read_section`, `write_section`, `run_in_page`, `share` (see `--share`) and the `git_` tools (`src/git.ts`). `read_chat` returns the saved chat (default the
  last 50 entries, agents by name) so that a fresh agent can pick up a resumed session; ask ids are random
  (`ask-<hex>`) because a resumed chat holds the forms of earlier processes, and a `session` event
  ends a waiting `chat` form with `{switched: true}`. Only one form is open (`openAsk` in `lib.ts`): the newest of
  this process. A new form or `chat({close: true})` closes it (SSE `{closed: id}`, a waiting call returns
  `{closed: true}`), an answer too; `POST /agent` answers a closed one with 409. `read_chat` and the session
  message carry it as `open`. The last three (logic in `src/sections.ts`, pure functions) let an
  agent work on one section of a long `journal.md` instead of reading the whole file: every ATX heading outside code
  fences and HTML comments is a section and a slide, addressed by heading path in the notation of the teaching-agent
  specs (`## Agents → ### Teaching-Agent`, a part matches a heading that starts with it as a whole word, its `#`s fix the level), by slide,
  by line (from grep), or by default the slide the user looks at. `goto` turns `line` and `section` into a slide the
  same way (`section()`), also with `file`: LiaScript's `gotoLine` knows only the open file. `write_section` replaces only with the `hash` that
  `read_section` returned, so an edit the user made in between is never overwritten; `append` needs none. `courseFile()`
  is the path check they share with `goto`. `set_agent` declares the roster and the current agent and opens no browser; `chat.agent` signs one message as a
  roster agent and makes it current; every `chat` payload carries `agent: {name, emoji, label}`, `label` being what the user reads
  instead of the name. Every
  `'event'` on the bus is also pushed as `notifications/claude/channel`, which Claude Code turns into a
  `<channel>` tag in the running session (research preview, needs
  `claude --dangerously-load-development-channels server:<name>`). It must never negotiate protocol revision
  `2026-07-28` and never declare `claude/channel/permission`. Channels only work in the terminal UI, not in the
  chat panel of the VS Code extension (checked), so the instructions name four ways in order: channel, Monitor on
  `get_state.events`, the Codex bridge, a loop of blocking `wait_for_event` (default 25 s, Copilot CLI ends tool
  calls after 30 s). Nothing wakes an idle Copilot, so the MCP prompt `chat` (`/mcp.liascript.chat` in VS Code)
  starts that loop. While `watched`, a `chat` form returns at once with its `ask` id instead
  of blocking, otherwise the answer would arrive twice (tool result and stream line). `send()` puts `language:` of the course header into the header comment of a message (`withLanguage()`) unless
  the chat says it already: `@liascript/chat` takes the language of a header in any message for all of them, quiz
  buttons and feedback were English in a German course. `chat`, `answer` and `command` events carry `entry`, their number in the chat: `chat({reply_to})` answers
  with `newer_user_messages` when the user wrote, answered or clicked since (`newerThan()`), and `answered` with the
  ask ids of the forms answered since (`answeredSince()`), a message formulated
  before a newer one came is then no longer silently out of place. `close` takes a `reason`, shown under the form
  (live only, not saved). `chat` with only `status`
  sets the progress line below the messages (the SSE message `{status}`, no browser is opened for it); a message
  keeps it only if it carries a `status` itself. `run_in_page` runs code of the agent in the web page behind the
  proxy (`runInPage()` in `lib.ts`: SSE `{page: {id, code}}`, `chat.js` hands it to the frame, `views/web.js` evals
  it and answers by `postMessage`, `chat.js` sends that as `POST /agent` type `page`, no event), to read or mark a
  whole page; not for pages the extension loads directly. Screenshots, console and clicks of the course are
  deliberately no tools of the bridge: the instructions tell an agent with browser automation tools (Playwright, Chrome DevTools) to open
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
- **`src/init.ts`** — `liadev init` / `liadev update` (positional commands in `index.ts`, no server starts): shallow
  clones of `LiaScript/teaching-agent` and `LiaScript/skills` with `isomorphic-git` into a temp folder, then copies of a
  whitelist (`AGENT`, never README.md or journal.md) and of every skill into `.claude/skills/` and `.agents/skills/`
  (copies, Windows symlinks need rights). `init` keeps what exists, `update` replaces, a single file that does not
  start with `# Teaching-Agent` is the user's own and kept by both. `.mcp.json` gets the `liascript` server if it has
  none (`-i journal.md`; `start()` accepts a missing `.md` input, the agent writes it later), and
  `.claude/settings.json` `enabledMcpjsonServers` gets `liascript`, so Claude Code starts it without asking.
- **`src/share.ts` + `share/`** — `--share`: the server for a phone or another browser elsewhere over WebRTC,
  without a library: `share/lia-rtc.mjs` is the one module both ends use (the share page, `share.ts` through
  parcel, `check.js`). The page is published as `LiaScript/share` (https://liascript.github.io/share/, the default;
  copy `share/` there after a change, its workflow writes `ice.json` and `signaling.json` from the organization
  secrets `WEBRTC_ICE_SERVERS` and `WEBRTC_SIGNALING_SERVERS`). Signalling goes over the y-webrtc protocol to those
  servers, each message sealed with AES-GCM under the key of the link (room and key in the fragment, kept per
  project in `~/.config/liascript/share.json`, `0600`, until `--share-new`). `werift` is the `RTCPeerConnection` of
  the host, `ws` its WebSocket under Node 20; `share.ts` loads them through `createRequire`, because parcel hoists
  every `require(`. One host per room (a pid lock next to `share.json`). On the channel: JSON heads
  (`req|res|abort|ping|pong`), binary pieces of 16 KB. A lost link (15 s silent) is dialed anew without
  reloading the shell: requests wait up to 20 s for it (`WAIT_MS`), a GET without an answer yet goes again, the
  event stream reconnects (`chat.js` reopens one the browser gave up on). The host replays a request with `fetch` against the local
  server, `Origin` set to it, `X-Lia-Origin` the page (with its folder and the `tab-<id>` of the tab) and reads
  every answer but an event stream at once (gzip when the page can unpack). `originOf()` in `lib.ts` puts
  `X-Lia-Origin` in front of every address it hands out (redirects, the listing), the scripts compute the same
  prefix (`BASE` in `chat.js`, `base__` in `gotoScript`, used by `agent.js`) and the service worker strips it.
  Live reload: the `reload` WebSocket does not pass, so `reloadNow()` also writes `{reload: true}` to every stream
  of a remote client (`response.remote`), and its player gets no `reload.js`. A browser sends no `Sec-Fetch-Dest`
  through the tunnel: `views/nested.js` (first script of the shell's `<head>`) stops a shell in the frame
  `#course` and loads the bare player, the listing or `/web` instead. Web pages only with `--proxy read` and a
  second origin of the page (`--share-web`, default the other one of `localhost`/`127.0.0.1`, none for
  liascript.github.io): `/web` is 404 and the replay says `{proxy: 'off'}` otherwise; `--proxy full` and the
  extension do not pass. `share.ts` also passes `x-lia-token`/`x-lia-web` of the page, which only the LMS of
  `feat/lms` uses. In `--mcp` it is a switch at runtime: `index.ts` hands `server.onShare({on, off, remembered})` in
  (`lib.ts` never loads WebRTC, the tsc build would pull it in; `--types node` keeps werift's DOM types out of it),
  `setShare(on, take, show)` turns it on or off. Ways in: the 📱 `#phone` of the chat bar (`POST /share {on}`, same
  `Origin`, never with `x-lia-origin`) and the MCP tool `share`. Only local `?chat` streams get `{share: {on, link,
  qr}}` (replayed, `qr()` of `src/qr.ts`, an SVG of attributes only): the phone must not switch off its own link.
  `share.json` keeps `on` per room; a remembered share starts when the instance is used (`wake()`: the first tool
  call or local `?chat` stream), without `take`, so the idle twin of Copilot never gets the room. `take` (a click,
  the tool) writes its pid into the lock of a living holder, which checks its lock every 3 s and steps aside
  (`lost`, `on` stays). `get_state.share` is the link.
- **`src/git.ts`** — git for users who cannot install it (no admin rights): the tools `git_login`, `git_status`,
  `git_clone`, `git_sync`, `git_publish` and `git_tag` on `isomorphic-git` (pure JS, `main` and `http/node` resolve
  without the exports map, so `pkg` finds them) and the GitHub REST API by `fetch`. The user pastes a personal
  access token into `GET /git/<token>` of `lib.ts` (`gitLogin()`, the random token of the event stream, so course
  scripts cannot set it; `POST` checks `Origin`), it lands in `~/.config/liascript/github.json` with the login and
  the noreply address for commits, never in a tool result, and `onAuth` hands it to `github.com` only. Every `dir`
  is below root, `repo()` refuses a repository above it. `git_sync` is add -A, commit, pull, push; a
  `MergeConflictError` aborts before anything is written. `git_publish` creates the repository (`owner` for an
  organization), pushes and fills the about section: `description`, `topics`, `homepage` (default the LiaScript
  link to `README.md`, public only). `src/check.js` covers it offline with a `HOME` of its own and a fake login.
- **`src/teachers/`** — teacher personas: historical people a teaching agent can take on. `looks.ts` is a verbatim
  copy of `src/famous.ts` of `LiaTemplates/virtual-speaker` (copy it again to take over new people, only header and
  last line differ), `traits.ts` holds gender, region, lived, fields and teaching (an English instruction, never a
  quote) per id, typed against the ids of `looks.ts`, `catalog.ts` joins them (`TEACHERS`, `find`, `line`) without
  DiceBear, so `mcp.ts` imports it. `render.ts` (copy of virtual-speaker's `avatar.ts`/`faces.ts`, six styles) makes
  the resting face and the open mouths. The MCP side: `find_teacher` lists them, `set_agent.persona` puts one on a
  roster agent (it brings the person's name as label unless the same call gives one, `null` removes it, the result
  carries `gender`, `teaching` and `rules`), `set_agent.voice` names a speech voice of the browser for one agent:
  `agentScript` reports the names of the voices in the course language (`voiceNames`, at most 50), `get_state` shows
  them as `voice_names`, `set_agent` warns about a name that is not among them (and sets it anyway, another browser may have it), `voiceFor()` in `chat.js` takes that voice if the browser has it for the language of the
  passage. Firefox on Linux gets its voices from speech-dispatcher (piper: `de_DE-thorsten-high`), whose names tell
  no gender, so `MALE`/`FEMALE` list the common piper names too,
  the chat form `type: "teacher"` shows 1 to 6 as portraits (the answer bubble shows the name), `get_state.teacher`
  is `teacher: <id>` of the course header (`sections.header()`). Two views (`view`, in memory next to the roster,
  part of `{agents}`): `author` shows every agent, `learner` only the current one with a 96 px stage
  (`body.learner`); a `persona` for the agent that talks now (top-level or in `agents`) switches to `learner` unless `view` is given, the agent
  switches back when the user asks in the chat. `Avatar.bot()` in `views/avatar.js` returns a `span.bot.persona`
  with the same `data-mouth`/`data-state` classes as the robot (below 40 px only the resting face, only the stage
  speaks and works) and falls back to the robot if `window.Teachers` does not know the id or throws; `Avatar.voice()` takes the gender of the person. The server instructions are at 2046 of
  2048 characters, so the personas live in the tool descriptions only.
- **`views/chat.html` + `views/chat.js` + `views/chat.css` + `views/avatar.js`** — the chat shell served at `/liascript/chat.html`: the player in a
  same-origin iframe with the chat on top, so a live reload only reloads the iframe. The messages are LiaScript,
  rendered by `<lia-chat>` of `@liascript/chat` (served from its `dist/` at `/liascript/lia-chat/`, `liachatPath`) in a
  second same-origin iframe: one `add()` is one `.lia-chat__msg` there, in order, and `place()` hangs the part of the
  shell (`.msg`: form, read-aloud button, robot, time) into the n-th one; `chat.css` is loaded on both sides, its rules
  inside the iframe are scoped to `.msg` and hide LiaScript's own footer. Elm reuses the nodes of old messages and
  renders `clear()` with the `add()`s after it in one frame, so `clear()` drops the old parts at once and places new
  ones only after `export()` and one animation frame of the iframe. The iframe's sandbox gets `allow-forms`, else the
  forms of the shell never fire `submit`. A link to `#3` or `#anchor` in a message moves the course frame. LiaScript's `agent` event (href only, the label comes from the click) becomes
  a `command`, its `store` events of quizzes, surveys, tasks and code become `activity` like those of the course, with
  `chat` (number of the message) instead of `slide` (a code run is a `store` of its result; the start of a new version,
  browsing the versions and the same failure twice within 1 s are none, so the 3rd failed run gets `help`); each, and those of code, also goes to the server as `store` with the entry number
  of its message (`msg.entry`, the iframe numbers its messages differently once the outbox shows one). The CSP of `chat.html` does not reach
  that iframe: like a course it runs the scripts of a message, so a message of the AI is as trusted as the course.
  The scripts are separate files
  because the page's CSP allows no inline scripts. The look: floating, the chat is glass over the course
  (`backdrop-filter`; the messages' iframe gets `lia-chat-frame`, which makes it transparent with the shell's
  `color-scheme`, else the browser paints it opaque), docked a solid column. Colors are tokens on `:root` of
  `chat.html`, `--hl` is the `--color-highlight` of the course (`accent()`). Font and icons are the player's:
  `lib.ts` serves its hashed files as `/liascript/font/{icon,sans,sans-600}.woff2`, read aloud is `icon-play`/`icon-stop`
  (``/``), the speaker of the bar is the hidden `#autoread` box; globe, folder, home and dock are inline
  Lucide SVGs. A green dot marks the current agent. Light or dark is LiaScript's, not the system's: `theme()` reads
  `light` of `localStorage.settings` (player and chat app share it) and sets `lia-variant-dark/light` on the shell
  and the messages, again on every `storage` event. Every agent is a pixel robot (`avatar.js`, inline SVG, no
  library): the 12 x 12 LED matrix of DiceBear's CC0 style Pixelbot, its eyes and mouths copied as cell numbers.
  `Avatar.role()` takes the role from the name (`teaching`, `artist`, `learner`, `development`, `reviewer`,
  `translator`, `research`, or a word of the name in `ALIASES`), else from the emoji (`EMOJI`), else LED colour,
  case and eyes come from a hash of the name; a role adds its symbol in the three rows above the eyes. The
  button shows robot and name of the current agent, a row of robots in the bar (`#agents`) appears with two or
  more agents, and every message ends in a footer with the read-aloud button and `robot label HH:MM` (arrival time, the label
  visible because a tooltip is out of reach on a tablet).
  The stage (`#stage`) below the log shows the robot of the current agent next to the progress line: a running
  light in its bottom row while a progress line shows, a pulse while the newest form is open (`stageState()`).
  After 20 s the progress line counts the seconds (`data-since`, `#status::after`). `#jump` next to it leads to the
  open form when it is out of sight (`Open question ↑/↓`), else to messages below the anchor (`New ↓`), `jumpState()`.
  The anchor (`anchor` in `chat.js`) is the bubble of the first live message of the AI since the user last wrote,
  clicked, scrolled or typed in the messages: `bottom()` keeps its top in view instead of the end, and the scroll
  handler pulls it back when `@liascript/chat` scrolls to its newest message by itself. An answer and a form right
  after it had pushed the answer out of sight. `lia-rise` moves without `opacity`: a covered window stopped the
  animation at its start and messages stayed pale for up to 80 s. An hour without a message or a new day puts a
  label above the next one (`gapBefore()`, a `time.gap` in its part, with the day if it changed, `localize()`
  keeps that). In a message a table has no switch to a chart (`.lia-plot__switch` hidden).
  While a message is read aloud the stage shows the robot of its agent and moves its mouth (`data-mouth`): with
  the words where the voice fires `boundary` events, else in a beat estimated from the text (`Avatar.babble`,
  also for `responsiveVoice`). Every robot has a voice profile (`Avatar.voice()`: gender, pitch, rate, spread so
  that each stands out): `voiceFor()` takes a voice of that gender where the browser has one (the gender comes
  from the voice name, `MALE`/`FEMALE` in `chat.js`; the gender counts more than the region, a British male
  voice for `en-US` rather than an American female one made lower), else it shifts the one it has (male: pitch × 0.75, rate ×
  0.94). Chrome on Linux has a single German voice, so there the profiles differ by pitch and rate alone.
  A click on a message reads nothing (it turned 3D models), only its button and the box below do; `SILENT` lists what is never read, inline code too; `readable()` adds the questions and options of an open form.
  `runs()` reads the visible text block by block (`BLOCK`): LiaScript puts no space between two blocks, so a pause
  goes in, a comma between two cells of a row. Tables and the options of quizzes, surveys and tasks are read, never
  a solution; an image by its alt text, a formula by `speech(lang)` of `<lia-formula>` in the language of its
  passage (LiaScript knows `en` and `de`, else an `en` passage, `formula()`); a closed `<details>` and the numbers
  of effects not. `<lia-formula>` renders its `aria-label` in the `<html lang>` of the chat iframe, which the chat
  app sets once to `en`, so `chatLang()` sets it to the course language (on load, in `localize()` and whenever the
  app changes it) and re-renders the formulas. What LiaScript itself should change is in `todo-liascript.md`.
  The box `Read everything aloud` (`localStorage`) queues new messages and the progress lines of the agent; of
  those of the server only `Thinking…` and `Looking at your answer…` (`SPOKEN`), one of them once per request. A waiting progress line
  is dropped when something newer comes, nothing is read during the replay of the first 1.5 s of a stream, and
  Chrome speaks only after a click or key on the page (`navigator.userActivation`). The chat is docked or floats, the button `#dock` in the bar switches (`applyDock()`, first
  visit: docked if the window is at least `WIDE` = 768 px, below that it always floats). Docked (`body.docked`,
  only while open) it is a column at the right edge of width `--dock`, the course iframe ends left of it, and
  the grip on its left edge moves the border (16rem chat to 20rem course at least, `dockWidth()`). Floating it
  stays anchored bottom-right: the button moves it (pointer capture, a drag swallows the click that follows), the
  grip in the top-left corner resizes `#panel`; `clamp()` keeps both on screen. `localStorage` remembers mode,
  width, place and size. On a phone (below `WIDE`, `views/phone.js`, `body.phone`) course and chat take turns
  on the whole screen instead: a bar `#switch` (`Course` with the slide `#n`, `Chat` with the unread badge),
  `#peek` over the course with the first line of the newest message of the agent or the progress line, `#where`
  in the chat with the slide and title and the way back. `chat.js` tells it with the DOM event `lia:shell`
  (`{kind: ai|goto|status|history, replay}`, `shell()`): a form shows the chat, a `goto` the course, a replay counts
  nothing. The view is kept as `liascript-chat-view`; `applyDock()` and the drag of the head stand aside in phone
  mode. `window.Phone` (pure) is tested in a vm. Every message has a read-aloud button (`speaker()` in `chat.js`):
  `speechSynthesis` with a voice for the language the player puts on its `<html lang>`, split into pieces of at
  most 180 characters because Chrome drops an utterance of its online voices after about 15 seconds; without
  browser voices it uses the `responsiveVoice` object of the player if there is one, else the buttons stay hidden
  and a muted speaker in the bar explains why on a click (so the agent need not say it in every greeting).
  The chat speaks the language of the course (`localize()`, re-run when the player changes its `<html lang>`):
  `TEXTS` maps English texts to translations (only `de` so far), `tr()` sets a text and keeps the English key in
  `data-t`/`data-t-<attr>`, so the progress lines of the server translate as well; times are `<time>` elements
  formatted in that language.
  The `chat` tool takes an optional `lang`, which becomes the `lang` attribute of the message; `runs()` splits a
  message into passages by the closest `lang` attribute inside the log (never the one of the page itself), so
  `<span lang="fr">` in the Markdown gets a French voice. While the frame shows another course than `--input` (or a listing or web page), `⌂ Start` in the bar leads
  back to it (`{home}` in the replay of every `?chat` stream, `showHome()`). 📁 next to it opens the listing of the folder of
  the course or file in the frame (`courseFolder()`, only for this server, hidden in a listing, `data-listing` of
  `views/layouts/index.hbs`, or a web page). The listing shows a file of another text type (a `LICENSE`, `.py`, `.ts`)
  as `text/plain` without ETag (`SHOWN`, `isText()`), it was a download before. `.avif` and `.opus` are added to the
  mime 1 table of express (`mime.define`), it had neither. The bar above the log holds the session menu
  (`+ New chat` and the saved chats; the current one counts as new until it has a file) and the robots of the agents.
  `showSession()` clears the log, hands `session.db` to the iframe with `lia.load({messages: [], db})` before the
  entries (there the n-th entry is the n-th message, so the states land in their quizzes; `report(…, true)` only
  remembers them, F5 reports nothing again) and replays the entries: `answered()` locks a form of the history and shows the
  choice, `closed()` locks every other form but `session.open` with a note. Both fold the form: a closed one shows
  only its note (a click unfolds it), an answered one only what was chosen. A message whose `POST` fails goes into a `localStorage` outbox and
  gets a `Send again` button; after a replay it shows up in its chat, or in the current one if its chat was never
  saved. 📎 (`#attach`) and a file dropped on the chat (shell or messages iframe) go to `POST /upload?name=` (agent
  mode, same `Origin`, also through `--share`, 25 MB): `uploadName()` keeps letters, digits and `._-`, the file lands in
  `uploads/` of root and never over another one, then the chat sends `![name](uploads/name)` (`!?[…]` a video, `?[…]`
  audio, `[…]` the rest) as an ordinary chat message. `base` of `<lia-chat>` is the folder of the course: the app appends relative
  links to it. The files of the shell are served with `Cache-Control: no-cache`, a heuristically cached `chat.js` from an older
  version would not understand the messages of a newer server.

Things the player does that the bridge works around (verified against the minified bundle of `@liascript/editor`,
re-check after upgrading it): since 2.1.0 `agent` is in the scheme whitelist of the link parser, so the href
arrives as written, but still with `target="_blank"`, and the capturing click handler has to stop it (before
2.1.0 the href became `<base>/agent:…`); `agent://tutor/explain` is accepted as `agent:tutor/explain`, `Activity.link()`
in `views/activity.js` (used by `agent.js` and `chat.js`, like `Activity.store()` for quizzes, surveys and tasks)
drops the slashes because `new URL()` would read `tutor` as the host;
`window.LIA.goto(n)` (0-based)
ignores a repeated request for the same slide even if the user moved away, so navigation sets `location.hash`
(1-based) instead; slide changes use `history.pushState` and fire no event, so `agentScript` patches it; the
player's `message` listener has an `eval` command without an origin check, so `agentScript` registers a gate first.
A deep link (`#n` on load) shows the right slide but leaves `document.title` at the course title, so `title` in
the state is stale until the next slide change. `goto` to another file loads a new page: the old one still
reports while it closes, so `goto` waits (`nextState(ms, arrived)`) for a report of the new file and slide and
adds a `warning` if none comes within 10 s.

`gotoScript` is a template literal: keep it free of backslashes, backticks and `${`.

Design and the research behind it: `docs/superpowers/specs/2026-09-18-agent-bridge-design.md`.

Apart from the chat shell there is no client-side JS source in this repo (the LiaScript player itself comes from
the `@liascript/editor` npm dependency), and no database — this repo is the Node/Express serving layer around it.
