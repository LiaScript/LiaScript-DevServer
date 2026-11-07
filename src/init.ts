// `liadev init` and `liadev update`: the teaching agent, the LiaScript skills and
// a .mcp.json in the current folder. isomorphic-git fetches them, so it works
// where git cannot be installed, like git.ts.
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')

// only these: the repository may hold a README.md or journal.md of its own,
// which must never overwrite the course
const AGENT = [
  'CLAUDE.md',
  'AGENTS.md',
  '.windsurfrules',
  '.cursor/rules/agent.md',
  '.codex/AGENTS.md',
  '.github/copilot-instructions.md',
  'specs',
]
// Claude Code reads .claude/skills, Codex, Copilot and others .agents/skills;
// copies, not symlinks, which Windows allows without admin rights only in developer mode
const SKILLS = ['.claude/skills', '.agents/skills']

// update replaces, init keeps what is there. A file of the user's own (CLAUDE.md
// of another project) stays in both: every generated one starts with this
function foreign(file: string) {
  return fs.statSync(file).isFile() && !fs.readFileSync(file, 'utf8').startsWith('# Teaching-Agent')
}

function put(from: string, root: string, rel: string, update: boolean) {
  const to = path.join(root, rel)
  if (fs.existsSync(to) && foreign(to)) return console.log('kept    (your own)', rel)
  if (!update && fs.existsSync(to)) return console.log('kept   ', rel)
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, { recursive: true })
  console.log('wrote  ', rel)
}

async function fetchRepo(url: string, tmp: string) {
  const dir = path.join(tmp, path.basename(url))
  console.log('fetch  ', url)
  await git.clone({ fs, http, dir, url, depth: 1, singleBranch: true })
  return dir
}

// adds the liascript server, never changes one that is there
function mcpJson(root: string) {
  const file = path.join(root, '.mcp.json')
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  config.mcpServers = config.mcpServers || {}
  if (config.mcpServers.liascript) return console.log('kept   ', '.mcp.json')
  config.mcpServers.liascript = {
    // a standalone binary is not on the PATH as liadev
    command: (process as any).pkg ? process.execPath : 'liadev',
    args: ['--mcp', '--live', '-i', 'journal.md'],
  }
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
  console.log('wrote  ', '.mcp.json')
}

// Claude Code starts the server without asking (after the folder's trust prompt)
function claudeSettings(root: string) {
  const file = path.join(root, '.claude', 'settings.json')
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  const enabled: string[] = (settings.enabledMcpjsonServers = settings.enabledMcpjsonServers || [])
  if (enabled.includes('liascript')) return console.log('kept   ', '.claude/settings.json')
  enabled.push('liascript')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
  console.log('wrote  ', '.claude/settings.json')
}

export async function init(update: boolean, root = process.cwd()) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liadev-'))
  try {
    const agent = await fetchRepo('https://github.com/LiaScript/teaching-agent', tmp)
    const skills = path.join(await fetchRepo('https://github.com/LiaScript/skills', tmp), 'skills')

    for (const rel of AGENT) {
      if (fs.existsSync(path.join(agent, rel))) put(path.join(agent, rel), root, rel, update)
    }
    for (const name of fs.readdirSync(skills)) {
      if (!fs.existsSync(path.join(skills, name, 'SKILL.md'))) continue
      for (const dir of SKILLS) put(path.join(skills, name), root, path.join(dir, name), update)
    }
    mcpJson(root)
    claudeSettings(root)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
