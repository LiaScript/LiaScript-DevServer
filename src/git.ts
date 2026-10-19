// Git and GitHub for --mcp on machines without git (teachers without admin
// rights): isomorphic-git does the repository, the REST API of GitHub the
// rest. The token is a personal access token the user pastes into the page of
// page(), so it never passes the agent, and it is only sent to github.com.
// Every dir is below root, like the files of the course tools.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const git = require('isomorphic-git')
const http = require('isomorphic-git/http/node')

const FILE = path.join(os.homedir(), '.config', 'liascript', 'github.json')
const NEW_TOKEN = 'https://github.com/settings/tokens/new?scopes=repo&description=LiaScript%20DevServer'

type Account = { token: string; login: string; name: string; email: string }

function account(): Account | undefined {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch (e) {}
}

export function user(): string | null {
  return account()?.login || null
}

function need(): Account {
  const a = account()
  if (!a) throw new Error('not logged in to GitHub: call git_login')
  return a
}

function author(a: Account) {
  return { name: a.name, email: a.email }
}

// the token only for github.com, a clone of another host goes without
function onAuth(url: string) {
  const a = account()
  return a && new URL(url).hostname === 'github.com' ? { username: a.token, password: 'x-oauth-basic' } : { cancel: true }
}

async function api(token: string, method: string, url: string, body?: object) {
  const res = await fetch('https://api.github.com' + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'liascript-devserver',
    },
    body: body && JSON.stringify(body),
  })
  const data: any = res.status === 204 ? {} : await res.json()
  if (!res.ok) throw new Error('GitHub: ' + (data.message || res.status) + (data.errors ? ' ' + JSON.stringify(data.errors) : ''))
  return data
}

// checks the token and keeps it with the identity for the commits
export async function login(token: any): Promise<string> {
  token = String(token || '').trim()
  if (!/^[\w-]{20,255}$/.test(token)) throw new Error('This is not a GitHub token.')
  const user = await api(token, 'GET', '/user')
  const a: Account = {
    token,
    login: user.login,
    name: user.name || user.login,
    email: user.id + '+' + user.login + '@users.noreply.github.com',
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(a), { mode: 0o600 })
  return a.login
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';')

// the login page, served by lib.ts under a path with its random token
export function page(user?: string, error?: string) {
  const body = user
    ? `<p>Logged in to GitHub as <b>${escape(user)}</b>. You can close this tab.</p>`
    : `<p>1. <a href="${NEW_TOKEN}" target="_blank">Create a token on GitHub</a> (scope <code>repo</code> is preselected), copy it.</p>
<form method="post"><p>2. Paste it here: <input type="password" name="token" size="44" autofocus required> <button>Log in</button></p></form>
${error ? `<p style="color:#c00">${escape(error)}</p>` : ''}`
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>GitHub login</title><body style="font:16px sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem">
<h1>GitHub for the LiaScript DevServer</h1>${body}`
}

// a folder below root, '' is root itself
function inside(root: string, dir: any = ''): string {
  if (typeof dir !== 'string' || path.isAbsolute(dir) || dir.split(/[\\/]/).includes('..')) {
    throw new Error('dir must be a relative path below root')
  }
  return path.join(root, dir)
}

// the repository that holds dir, never one above root
async function repo(root: string, dir: any): Promise<string> {
  const found = await git.findRoot({ fs, filepath: inside(root, dir) }).catch(() => '')
  if (!found || path.relative(root, found).startsWith('..')) {
    throw new Error('no git repository at ' + (dir || 'root') + ': git_clone or git_publish first')
  }
  return found
}

async function remote(dir: string): Promise<string | undefined> {
  return git.getConfig({ fs, dir, path: 'remote.origin.url' })
}

// git add -A && git commit, null if nothing changed
async function commitAll(dir: string, message: string, a: Account): Promise<string | null> {
  const changed = (await git.statusMatrix({ fs, dir })).filter(([, h, w, s]: number[]) => !(h === 1 && w === 1 && s === 1))
  if (!changed.length) return null
  const gone = changed.filter(([, , w]: number[]) => w === 0).map(([f]: string[]) => f)
  const kept = changed.filter(([, , w]: number[]) => w !== 0).map(([f]: string[]) => f)
  if (kept.length) await git.add({ fs, dir, filepath: kept })
  for (const filepath of gone) await git.remove({ fs, dir, filepath })
  return (await git.commit({ fs, dir, message, author: author(a) })).slice(0, 7)
}

export async function status(root: string, args: any) {
  const dir = await repo(root, args.dir)
  const matrix = await git.statusMatrix({ fs, dir })
  const log = await git.log({ fs, dir, depth: 5 }).catch(() => [])
  return {
    dir: path.relative(root, dir),
    user: user(),
    branch: await git.currentBranch({ fs, dir }),
    remote: (await remote(dir)) || null,
    changed: matrix
      .filter(([, h, w, s]: number[]) => !(h === 1 && w === 1 && s === 1))
      .map(([f, h, w]: any[]) => (h === 0 ? 'new ' : w === 0 ? 'deleted ' : 'changed ') + f),
    log: log.map((c: any) => c.oid.slice(0, 7) + ' ' + c.commit.message.split('\n')[0]),
    tags: await git.listTags({ fs, dir }),
  }
}

export async function clone(root: string, args: any) {
  const url = String(args.url || '')
  if (!/^https:\/\/[^/]+\/.+/.test(url)) throw new Error('url must be an https URL of a repository')
  const name = args.dir || path.basename(new URL(url).pathname).replace(/\.git$/, '')
  const dir = inside(root, name)
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(name + ' exists and is not empty')
  await git.clone({ fs, http, dir, url, singleBranch: true, onAuth })
  return { dir: path.relative(root, dir), files: (await git.listFiles({ fs, dir })).length }
}

export async function sync(root: string, args: any) {
  const a = need()
  const dir = await repo(root, args.dir)
  const commit = await commitAll(dir, args.message || 'Update', a)
  if (!(await remote(dir))) return { commit, pushed: false, warning: 'no remote: git_publish to create one on GitHub' }
  try {
    await git.pull({ fs, http, dir, singleBranch: true, author: author(a), onAuth })
  } catch (e: any) {
    // ponytail: no conflict resolution, the user merges on github.com or by hand
    if (e.code !== 'MergeConflictError') throw e
    throw new Error(
      'conflict: ' + e.data.filepaths.join(', ') + ' changed on GitHub and here. Nothing was merged or pushed, the local commit stays. Tell the user.',
    )
  }
  await git.push({ fs, http, dir, onAuth })
  return { commit, pushed: true }
}

// a new GitHub repository for a folder below root, with its about section
export async function publish(root: string, args: any) {
  const a = need()
  const dir = inside(root, args.dir)
  if (fs.existsSync(path.join(dir, '.git')) && (await remote(dir))) throw new Error('already has a remote: git_sync')
  const name = args.name || path.basename(dir)
  const created = await api(a.token, 'POST', args.owner ? '/orgs/' + args.owner + '/repos' : '/user/repos', {
    name,
    private: !!args.private,
    description: args.description,
  })

  if (!fs.existsSync(path.join(dir, '.git'))) await git.init({ fs, dir, defaultBranch: 'main' })
  const commit = await commitAll(dir, args.message || 'First version', a)
  const branch = await git.currentBranch({ fs, dir })
  await git.addRemote({ fs, dir, remote: 'origin', url: created.clone_url })
  await git.setConfig({ fs, dir, path: 'branch.' + branch + '.remote', value: 'origin' })
  await git.setConfig({ fs, dir, path: 'branch.' + branch + '.merge', value: 'refs/heads/' + branch })
  await git.push({ fs, http, dir, onAuth })

  // a public course opens in LiaScript from the website link
  const homepage =
    args.homepage ||
    (!args.private && fs.existsSync(path.join(dir, 'README.md'))
      ? 'https://liascript.github.io/course/?https://raw.githubusercontent.com/' + created.full_name + '/' + branch + '/README.md'
      : undefined)
  if (homepage) await api(a.token, 'PATCH', '/repos/' + created.full_name, { homepage })
  if (args.topics) await api(a.token, 'PUT', '/repos/' + created.full_name + '/topics', { names: args.topics })
  return { url: created.html_url, commit, homepage: homepage || null, topics: args.topics || [] }
}

export async function tag(root: string, args: any) {
  const a = need()
  const dir = await repo(root, args.dir)
  const ref = String(args.name || '')
  await git.annotatedTag({ fs, dir, ref, message: args.message || ref, tagger: author(a) })
  if (!(await remote(dir))) return { tag: ref, pushed: false, warning: 'no remote: git_publish to create one on GitHub' }
  await git.push({ fs, http, dir, ref, onAuth })
  return { tag: ref, pushed: true }
}
