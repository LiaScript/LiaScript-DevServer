# LiaScript-DevServer

This project is intended to support the development of interactive courses with
[LiaScript](https://LiaScript.github.io). This projects implements a development
server that can be used locally to preview courses within the browser.

## Installation

You can directly download the latest version for your system from the assets:

https://github.com/LiaScript/LiaScript-DevServer/releases/

or install it via the NodeJS package manager `npm` ...

### NodeJS

If you haven't installed it yet, you will have to install NodeJS for your
system. This is the actual runtime environment for your local server and also
contains the package manager that we will need for installing the
[LiaScript-DevServer](https://www.npmjs.com/package/@liascript/devserver).

https://nodejs.org/en/download/

### LiaScript-DevServer

Open the terminal on your system and type the following command.

```bash
npm install -g @liascript/devserver
```

This will automatically install all dependencies and the devServer as well ...

> **Note:** On Windows you open a terminal by typing `cmd` into the program
> search or you can also use the Powershell.

## Usage

You can run the devServer by typing `liascript-devserver` or the short-cut
`liadev` into your terminal. The following command will print out some help
information on command-line parameters that you can use:

```bash
liascript-devserver --help
```

```text
 _     _       ____            _       _
| |   (_) __ _/ ___|  ___ _ __(_)_ __ | |_
| |   | |/ _` \___ \ / __| '__| | '_ \| __|
| |___| | (_| |___) | (__| |  | | |_) | |_
|_____|_|\__,_|____/ \___|_|  |_| .__/ \__|
                                |_|

-h  --help       show this help
-v  --version    show version information
-i  --input      input README.md file or folder (default: .)
-p  --port       used port number (default: 3000)
-l  --live       do live reload on file change
-w  --watch      file types that trigger the live reload,
                 comma separated, * for all, implies --live,
                 hidden files and node_modules never count
                 (default: md,html,htm,js,css,png,jpg,jpeg,gif,svg,webp,avif,bmp,ico,mp4,webm,ogv,ogg,mov,m4v)
-o  --open       open in default browser
-t  --test       test online on https://LiaScript.github.io
    --mcp        serve as MCP server on stdio for AI agents,
                 to be started from the MCP config of the agent

-r  --responsiveVoice  add optional responsiveVoice support,
                       or pass your own responsiveVoice key.
                       Adding this feature might slow down
                       the reloading speed.
                       For more information visit:
```

> **Note:** `-h` or `--help` will only print out the help, all other parameters
> are ignored.

### `--version`

Use this to identify the current version, but you can alternatively also use the
shortcut `-v`:

```bash
liascript-devserver --version
```

At the moment this should give the following results. Since LiaScript gets
updated separately, we use two different version, one for the devServer and one
for LiaScript.

```text
DevServer: 1.2.17
LiaScript: 2.1.2
```

### `--input`

If you run the command `liascript-devserver` without any commands, the server
will run from your current directory and give you the following output.

```text
$ liascript-devserver

 _     _       ____            _       _
| |   (_) __ _/ ___|  ___ _ __(_)_ __ | |_
| |   | |/ _  \___ \ / __| '__| | '_ \| __|
| |___| | (_| |___) | (__| |  | | |_) | |_
|_____|_|\__,_|____/ \___|_|  |_| .__/ \__|
                                |_|

📡 starting server
   - local:           http://localhost:3000
   - on your network: http://192.168.2.114:3000
✨ hit Ctrl-c to close the server
```

The server starts locally on port 3000, thus, if you open your browser and type
in the URL http://localhost:3000 you should see a similar image

![navigation-preview](pics/navigation.gif)

However, if you add the `--input` parameter (shortcut `-i`) and pass it another
folder, this will be used as the root folder for the subsequent navigation.

```bash
liascript-devserver --input ../LiaBooks
```

But you can also refer to a specific Markdown file, in this case, the course
will be rendered immediately by the LiaScript interpreter, if you open the
following link in your browser.

```bash
liascript-devserver --input ../LiaBooks/docs/README.md

...
📡 starting server
   - local:           http://localhost:3000/liascript/index.html?http://localhost:3000/README.md
   - on your network: http://192.168.2.114:3000/liascript/index.html?http://192.168.2.114:3000/README.md
✨ hit Ctrl-c to close the server
```

![preview](pics/preview.gif)

### `--open`

**If you want to open the preview immediately, then use this parameter.** It
will open your default browser with the displayed URL automatically.

```bash
liascript-devserver --open -i ../LiaBooks
```

### `--live`

Use this parameter if you want to have live updates. The server will monitor
file changes within the defined folder. When you type and save your document, a
reload will be automatically triggered. If you prefer to reload your changes
manually via pressing `F5` do not use this option.

```bash
liascript-devserver --live -o -i ../LiaBooks/docs/README.md
```

![live-update](pics/live-update.gif)

The server watches the folder of the course, also if you pass a single file, so
a changed image or stylesheet reloads the course too. Hidden files and folders
(such as `.git`) and `node_modules` never trigger a reload, and only files of
these types count: Markdown, HTML, JavaScript, CSS, images and videos (`md`,
`html`, `htm`, `js`, `css`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`,
`avif`, `bmp`, `ico`, `mp4`, `webm`, `ogv`, `ogg`, `mov`, `m4v`).

### `--watch`

Sets the file types that trigger a live reload, as a comma separated list of
extensions, and turns on `--live`. It replaces the default list, `*` watches
every visible file.

```bash
liascript-devserver --watch md,css,png -i ../LiaBooks
```

### `--port`

It is only possible to run on devServer at a given port-number, thereby 3000 is
used as the default value. If you want to start multiple servers on different
folders or the port-number is already occupied by another process or server,
this will will be shown by the following error message:

```bash
liascript-devserver -o -i ../LiaBooks

...
📡 starting server
   - local:           http://localhost:3000/liascript/index.html?http://localhost:3000/README.md
   - on your network: http://192.168.2.114:3000/liascript/index.html?http://192.168.2.114:3000/README.md
✨ hit Ctrl-c to close the server
🚨 error => listen EADDRINUSE: address already in use :::3000
```

However, by using `--port 3001` or `-p 3001` you can redefine this number and
run different servers separately:

```bash
liascript-devserver --port 3001 -o -i ../LiaBooks

...
📡 starting server
   - local:           http://localhost:3001/liascript/index.html?http://localhost:3001/README.md
   - on your network: http://192.168.2.114:3001/liascript/index.html?http://192.168.2.114:3001/README.md
✨ hit Ctrl-c to close the server
```

### `--test`

Since we are using a local devServer, it is also possible to test your courses
online on the LiaScript project website: https://LiaScript.github.io

See how the URL changes by setting the parameter `--test`:

```bash
liascript-devserver --test -o -i ../LiaBooks/docs/README.md

...
📡 starting server
   - local:           https://LiaScript.github.io/course/?http://localhost:3000/README.md
   - on your network: https://LiaScript.github.io/course/?http://192.168.2.114:3000/README.md
✨ hit Ctrl-c to close the server
```

> **Note:** Live reload with `--live` will not work in this mode, since the
> server is only used to serve local data and not the LiaScript website.
> Additionally you will have to remove the courses manually from the index.

### `--responsiveVoice`

Automated Text2Speech is **Not** enabled by default, since it reduces the reload
speed. But you can add this support by add this parameter, in this case the
LiaScript project key is automatically injected. However, you can also pass your
own key from your own project/website like this:

```bash
$ liascript-devserver --responsiveVoice YOURKEY -i ../LiaBooks
```

### `--mcp`

Connects the preview to an AI agent such as Claude Code, Codex or Gemini CLI.
With this parameter the devServer is additionally an
[MCP](https://modelcontextprotocol.io) server on stdio. You do not start it
yourself, the agent does. For Claude Code put this `.mcp.json` next to your
course:

```json
{
  "mcpServers": {
    "liascript": {
      "command": "liadev",
      "args": ["--mcp", "--live", "-i", "README.md"]
    }
  }
}
```

For Codex add this to `~/.codex/config.toml`. Codex gives up on a tool call
after 60 seconds by default, which is too short for a question the user has to
answer:

```toml
[mcp_servers.liascript]
command = "liadev"
args = ["--mcp", "--live", "-i", "/path/to/README.md"]
tool_timeout_sec = 3600
```

Every agent starts a devServer of its own. If the port is taken, the next free
one is used, so several of them can run from the same config, and the agent
learns the address from `get_state`. This matters in VS Code, which starts the
servers of a `.mcp.json` in the workspace for Copilot as well, next to the one
Claude Code starts. Do not start `--mcp` yourself in a terminal: nothing can
connect to that instance.

The preview opens in your default browser. If the agent has browser automation
tools, such as the MCP servers of Playwright or Chrome DevTools, it is told to
open the preview in that browser instead, as long as no tab is connected yet.
You and the agent then look at the same tab, and the agent can take
screenshots, read the console and click in the course. Open the preview
yourself first if you prefer your own browser: the agent uses the tab that is
there and never opens a second one.

The agent gets these tools:

| Tool             | What it does                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `get_state`      | the open course, the slide (1-based, like `#3` in the URL), its title, the text you have selected, and whether the browser can read aloud |
| `goto`           | show a `slide`, the slide of a source `line`, or another course `file`; opens the browser if it is not open    |
| `chat`           | write into the chat on top of the course, optionally with buttons, radio buttons and checkboxes for you to answer |
| `read_chat`      | read the saved chat, so that an agent can continue a conversation it did not start                               |
| `wait_for_event` | fallback for agents that cannot be notified, see below                                                         |

#### Reading aloud

LiaScript reads a course aloud with the speech voices of the browser. The
devServer reports to the agent how many voices the browser has, and when there
are none, `get_state` carries a `tts` entry that says why and what helps. The
agent is told to change nothing without asking you.

The chat uses the same voices: every message has a small button that reads it
aloud in the language of the course, without code blocks, tables and diagrams.
A browser without voices shows no such button. The agent can say that a
message is in another language, and mark single passages, so that each part is
read with a matching voice.

| Browser                                   | Why it is silent                                                                  | What helps                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Chrome started by the Playwright MCP      | it starts Chrome with `--disable-component-extensions-with-background-pages`, which removes Chrome's online voices | a config file that drops the flag, see below (checked with Playwright MCP 0.0.83, Chrome 154) |
| Chrome started by another automation tool | the same flag                                                                     | start Chrome without it                                                    |
| Firefox on Linux                          | it takes its voices from `speech-dispatcher`                                      | install `speech-dispatcher` with a voice                                   |
| any browser                               |                                                                                   | start the devServer with `--responsiveVoice <key>` and a valid key, that service needs no browser voices |

For the Playwright MCP, write this into a file and pass it with `--config` or
the environment variable `PLAYWRIGHT_MCP_CONFIG`, then restart that server:

```json
{
  "browser": {
    "launchOptions": {
      "ignoreDefaultArgs": ["--disable-component-extensions-with-background-pages"]
    }
  }
}
```

The voices of Chrome are online voices of Google: the text that is read goes
to Google, and without a connection it stays silent.

#### Links that talk to the agent

A link with the scheme `agent:` sends a command to the agent when you click it.
The message is the link itself, `agent:<agent>/<command>?<parameters>`. Written
as `agent://<agent>/<command>?<parameters>` it means the same:

```markdown
[Explain this simpler](agent:tutor/explain?level=easy)

<button data-agent="agent:author/rewrite?tone=short">Shorten this section</button>

[Give me an exercise](#)<!-- data-agent="agent:tutor/exercise?n=3" -->
```

The agent receives the agent name, the command and the parameters together
with what you are looking at: file, slide, title and selected text. What
`tutor` or `explain` mean is up to you. Define them as sub-agents, skills or
simply in the instructions of your agent. The same links work in the chat, so
the agent can offer them to you as well.

Outside of the devServer such a link leads nowhere; the `data-agent` forms are
inert there.

Claude Code is told about a click at once, in one of two ways:

- Its [channels](https://code.claude.com/docs/en/channels) are a research
  preview and work only in the terminal, not in the chat panel of the VS Code
  extension. The session has to be started like this:

  ```bash
  claude --dangerously-load-development-channels server:liascript
  ```

- Otherwise it listens with its Monitor tool, in the terminal and in VS Code
  alike. `get_state` gives it the address of an event stream, the agent runs
  `curl -sN` on it in the background, and every click wakes it up. The agent is
  told to do so, there is nothing to set up. While it listens, forms in the
  chat do not keep it waiting; your answer arrives like a click.

For Codex, call `wait_for_event` with `{ "timeout_s": 0 }` between work steps:
it returns the next queued event immediately, or `{ "timeout": true }`.
Post forms with `chat({ markdown, inputs, wait: false })`; this returns
`{ sent: true, ask }` immediately and the answer arrives as an `answer` event.
Without these options, `wait_for_event` and forms retain their waiting behavior.
The fallback queue keeps only the latest 20 events, so poll regularly.

GitHub Copilot and other clients cannot be woken up by the server. Start the
prompt `chat` of the server instead (in VS Code: type `/mcp.liascript.chat` in
the Copilot chat): the agent then waits with `wait_for_event` (25 s per call),
answers in the browser and waits again, until you stop it or close the
preview. VS Code asks to continue after `chat.agent.maxRequests` requests
(default 50, each wait counts), raise it for long sessions.

#### Persistent Codex bridge

With Codex CLI installed and signed in (`codex login`), run the bridge from
the course project folder. After installing this package:

```bash
liascript-codex -- --live --open -i README.md -p 3001
```

From this repository, build first and run:

```bash
npm run build
npm run codex -- -- --live --open -i test.md -p 3001
```

Options before `--` belong to the bridge (`--model MODEL`, `--codex PATH`);
options after it belong to the devserver. Use a free port if another MCP
client already runs the devserver. The bridge owns one MCP subprocess and
one [Codex app-server](https://developers.openai.com/codex/app-server).
It consumes MCP event notifications directly, forwards browser input with
`turn/start` or `turn/steer`, and exposes the existing MCP tools to Codex as
dynamic tools with a `lia_` prefix. There is no polling turn or Monitor timeout.
This requires app-server's experimental dynamic tools API (tested with Codex
CLI 0.160.0); no additional runtime dependency or separate API key is needed
when Codex is already signed in.

MCP agents receive these startup instructions in the `get_state` tool
description. Its `codex_bridge` result supplies the installed program path,
argument array, working directory and availability. Codex can use them to
start a background PTY and open the URL printed after `Bridge ready:`. The
description explicitly distinguishes that new thread from an existing IDE
session and tells an agent already using `lia_` tools to keep its current bridge.

Type in the browser or in the bridge terminal: both reach the same thread.
Final replies appear in both, progress appears in the browser status line,
and forms always return immediately. `/stop` interrupts the current turn;
`/quit` stops both subprocesses. Closing the browser interrupts active work
after the usual disconnect delay, without opening it again.

Run one bridge per project. Each saved browser chat has its own Codex thread.
The local mapping lives in
`.chats/.codex-threads.json`; restart the bridge to resume it, or use the
browser chat menu to change conversations. This mapping belongs to the
local Codex login, so exclude it from version control even if you share the
chat transcripts. A resumed thread on another machine must be created there.
The bridge hosts its own conversation; it does not inject messages into an
already-running IDE chat.

Browser input remains untrusted page content. Command/file approvals appear
only in the bridge terminal: `/approve ID yes` or `/approve ID no`. Other
structured requests show their payload and accept `/reply ID JSON`. Browser
text never invokes these terminal commands. Codex runs with `workspace-write`
and `on-request`; managed Codex requirements continue to apply.

Checks after building:

```bash
npm run test:mcp
npm run test:codex
npm run test:codex -- --live
```

The normal bridge check uses the real MCP server and a deterministic
app-server peer. The live check uses the signed-in Codex and a visible
Playwright Chromium window; it verifies browser/terminal input, steering,
forms and resume after restart. It needs Playwright and its browser already
installed. Set `PLAYWRIGHT_MODULE_PATH` to an installed Playwright module
directory and optionally `PLAYWRIGHT_CHROMIUM_PATH` to an existing Chromium
binary. `HEADLESS=1` runs without a window. Test transcripts and screenshots
are written to a temporary folder printed at the end.

Closing the preview is an event as well: two seconds after the last browser
went away the agent is told that nobody is looking anymore, a form it was
waiting for ends, and it is asked not to reopen the page on its own. A reload
is too short to count.

#### The chat

In this mode a course opens inside a page with a chat on top of it. The course
lives in a frame of its own, so the chat stays when the course reloads. What
you type goes to the agent, and its answers are LiaScript, rendered by
[@liascript/chat](https://www.npmjs.com/package/@liascript/chat) like a course:
formulas, quizzes, surveys and tasks, executable code, ASCII art, and templates
imported in a header comment. Your answers to its quizzes reach the agent too, so
it can help when you are stuck. While the agent works on an answer, a line below
the messages tells what it is doing.

Every chat is saved as a file in `.chats/` of the folder the agent works in, one
file per conversation, together with your answers to its forms. A reload of the
page, a restart of the agent or the server continue the last chat; the menu at
the top of the chat starts a new one or reopens an older one, and the agent is
told which. Commit `.chats/` so that others can continue your conversations, or
add it to `.gitignore` to keep them to yourself. A message that does not reach
the server, e.g. while it restarts, is marked and can be sent again.

#### Teacher personas

An agent can teach as a historical person: Marie Curie, Socrates, Hypatia,
Paulo Freire and nearly 200 more, with a portrait, a voice and their way of
teaching. The agent suggests a few that fit the course, the learner picks one in
the chat. Then the chat switches to the learner view, which shows only that
teacher; ask the agent to go back to the author mode to see all agents again. A
course can fix its teacher in the header:

```markdown
<!--
author: …
teacher: maria-montessori
-->
```

The ids are those of the agent's `find_teacher` tool. The portraits are DiceBear
avatars of [virtual-speaker](https://github.com/LiaTemplates/virtual-speaker),
the licenses of their styles are named in the tooltip.

#### Security

What happens in the browser ends up as a prompt for your agent. Therefore, with
`--mcp` the server listens on this machine only and refuses requests from other
origins. The event stream answers only at a random address that the agent gets
from `get_state`, and never to a browser. Course content is still able to send
commands, that is the point of the links, and scripts of a course can do the
same. Open courses you do not trust without `--mcp`.
