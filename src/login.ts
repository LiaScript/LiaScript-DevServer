// The pages of the gateway's front before a user is in: the login, which
// greets with the name of the link (?user=, &user= of the share link) and
// shows no role, and the welcome after a right password, by role. Pure
// functions of their input; gateway.ts serves them. The front sends no CSP,
// so the style and the small scripts are inline. Design:
// docs/superpowers/specs/2026-11-04-lialms-design.md, section 3.

const esc = (s: any) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';')

const de = {
  lang: 'de',
  locale: 'de-DE',
  title: 'Anmelden',
  hello: 'Hallo,',
  helloAlone: 'Hallo.',
  companion: 'Schön, dass du da bist!',
  lead: 'Dein Kurs und dein Lernbegleiter warten auf dich. Gib dein Passwort ein, dann geht es genau dort weiter, wo du aufgehört hast.',
  teacher: 'Lehrkraft',
  fromTeacher: 'an die Klasse',
  notYou: 'Nicht du?',
  name: 'Name',
  password: 'Passwort',
  show: 'Passwort zeigen',
  hide: 'Passwort verbergen',
  remember: 'Auf diesem Gerät 7 Tage angemeldet bleiben',
  go: 'Weiter',
  forgot: 'Passwort vergessen? Frag deine Lehrkraft, sie kann dir ein neues geben.',
  secure: 'Verschlüsselte Verbindung direkt zum Rechner deiner Schule',
  wrong: 'Name oder Passwort stimmt nicht.',
  wait: 'Zu viele Versuche, bitte eine Minute warten.',
  welcome: 'Angemeldet',
  learn: 'Weiterlernen …',
  write: 'Weiterschreiben …',
  back: 'Willkommen zurück,',
  workshop: 'Werkstatt für Autoren',
  ready: 'Bereit, wenn du es bist.',
  moment: 'Einen Moment',
  preparing: (share: string) => 'Dein Kurs wird vorbereitet' + share + '. Die Seite lädt gleich von selbst neu.',
}
export type LoginTexts = typeof de
const en: LoginTexts = {
  lang: 'en',
  locale: 'en-GB',
  title: 'Sign in',
  hello: 'Hello,',
  helloAlone: 'Hello.',
  companion: 'Good to see you!',
  lead: 'Your course and your learning companion are waiting. Enter your password and you continue right where you left off.',
  teacher: 'Teacher',
  fromTeacher: 'to the class',
  notYou: 'Not you?',
  name: 'Name',
  password: 'Password',
  show: 'Show password',
  hide: 'Hide password',
  remember: 'Stay signed in on this device for 7 days',
  go: 'Continue',
  forgot: 'Forgot your password? Ask your teacher, they can give you a new one.',
  secure: 'Encrypted connection straight to the computer of your school',
  wrong: 'Name or password is wrong.',
  wait: 'Too many tries, please wait a minute.',
  welcome: 'Signed in',
  learn: 'Back to learning …',
  write: 'Back to writing …',
  back: 'Welcome back,',
  workshop: 'Workshop for authors',
  ready: 'Ready when you are.',
  moment: 'One moment',
  preparing: (share: string) => 'Your course is being prepared' + share + '. The page reloads by itself.',
}
export const LOGIN: { de: LoginTexts; en: LoginTexts } = { de, en }

// the learning companion: the pixel robot of the chat, cheeks and an antenna light
const COMPANION = `<svg class="bot" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="2" width="10" height="9" rx="2" fill="#147375"/><rect x="5.5" y="0.4" width="1" height="1.6" fill="#147375"/><rect x="5.2" y="0" width="1.6" height="0.8" rx="0.4" fill="#f59e0b"/><rect x="3" y="4.6" width="2" height="2" fill="#fff"/><rect x="7" y="4.6" width="2" height="2" fill="#fff"/><rect x="3.6" y="5.2" width="0.8" height="0.8" fill="#0b3b3c"/><rect x="7.6" y="5.2" width="0.8" height="0.8" fill="#0b3b3c"/><rect x="3.5" y="8" width="5" height="1" rx="0.5" fill="#9fe3dc"/><rect x="2" y="7.6" width="1" height="0.6" fill="#f3a7a0"/><rect x="9" y="7.6" width="1" height="0.6" fill="#f3a7a0"/></svg>`
// the Teaching-Agent of an author: glasses and a pencil
const AUTHOR = `<svg class="bot" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="2" width="10" height="9" rx="2" fill="#4c3bb8"/><rect x="3" y="2.6" width="1" height="1" fill="#c9bffc"/><rect x="4" y="3" width="1" height="0.6" fill="#c9bffc"/><rect x="5" y="2.6" width="3.6" height="0.6" fill="#c9bffc"/><rect x="3" y="4.8" width="2" height="1.6" fill="#fff"/><rect x="7" y="4.8" width="2" height="1.6" fill="#fff"/><rect x="3.6" y="5.2" width="0.8" height="0.8" fill="#1e1452"/><rect x="7.6" y="5.2" width="0.8" height="0.8" fill="#1e1452"/><rect x="2.6" y="4.4" width="2.8" height="0.4" fill="#1e1452"/><rect x="6.6" y="4.4" width="2.8" height="0.4" fill="#1e1452"/><rect x="5.4" y="4.6" width="1.2" height="0.3" fill="#1e1452"/><rect x="4" y="8.2" width="4" height="0.8" rx="0.4" fill="#c9bffc"/><rect x="10.2" y="5" width="1.4" height="5" rx="0.3" fill="#f59e0b" transform="rotate(18 10.9 7.5)"/></svg>`
const MARK = `<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="2" width="10" height="9" rx="2" fill="#147375"/><rect x="3" y="5" width="2" height="2" fill="#fff"/><rect x="7" y="5" width="2" height="2" fill="#fff"/><rect x="4" y="8.5" width="4" height="1" fill="#9fe3dc"/><rect x="5.5" y="0.5" width="1" height="1.5" fill="#147375"/></svg>`

const STYLE = (base: string) => `@font-face{font-family:Geist;src:url(${base}/lia-font/geist.woff2) format('woff2');font-weight:100 900;font-display:swap}
:root{color-scheme:light;--c:#147375;--soft:#eef5f4;--ring:rgba(20,115,117,.12);--bg:#f2f6f5;--fg:#23292a;--muted:#56605f;--bad:#b42318}
.author{--c:#4c3bb8;--soft:#efedfc;--ring:rgba(76,59,184,.14);--bg:#f5f4fb;background-image:linear-gradient(rgba(76,59,184,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(76,59,184,.07) 1px,transparent 1px);background-size:28px 28px}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;background-color:var(--bg);color:var(--fg);font:16px/1.5 Geist,system-ui,sans-serif}
.wrap{width:100%;max-width:1180px;margin:0 auto;padding:24px}header{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px}header svg{width:26px;height:26px}header b{color:var(--c)}header .mode{margin-left:auto;font-weight:400;font-size:13px;color:var(--muted)}
.author header .mode{padding:4px 10px;border-radius:6px;background:var(--soft);color:var(--c);font-family:ui-monospace,monospace;font-size:12px;letter-spacing:.08em}
main{flex:1;display:flex;flex-wrap:wrap;align-items:center;gap:48px}.hi{flex:999 1 420px;min-width:0;display:grid;gap:24px;align-content:center}
.meet{display:flex;align-items:flex-end;gap:16px}.bot{width:120px;height:120px;flex:none}.bubble{margin-bottom:56px;padding:12px 16px;border-radius:18px 18px 18px 4px;background:#fff;box-shadow:0 6px 20px -8px var(--c);font-size:15px}
h1{margin:0;font-size:clamp(40px,7vw,64px);line-height:1.02;font-weight:800;letter-spacing:-.035em;overflow-wrap:anywhere}h1 .who{color:var(--c)}
.lead{margin:0;max-width:36ch;font-size:19px;color:#444d4e}
.note{margin:0;max-width:460px;padding:16px 18px;border-radius:16px;background:#fff;border:1px solid var(--ring);display:flex;gap:14px}.note .av{width:40px;height:40px;flex:none;border-radius:20px;background:#fdecc8;color:#8a4b06;display:grid;place-items:center;font-weight:700}
.note small{display:block;color:var(--muted);font-size:12px}.note blockquote{margin:2px 0 0;font-size:15px;overflow-wrap:anywhere}
.card{flex:1 1 340px;max-width:440px;margin:0 auto;padding:32px;border-radius:24px;background:#fff;box-shadow:0 24px 60px -24px rgba(16,40,61,.35),0 0 0 1px rgba(0,0,0,.04)}
form{display:grid;gap:18px}.chip{display:flex;align-items:center;gap:14px;padding:12px;border-radius:16px;background:var(--soft)}.chip .av{width:48px;height:48px;flex:none;border-radius:24px;background:var(--c);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:700}
.chip span{flex:1;min-width:0;font-size:17px;font-weight:600;overflow-wrap:anywhere}.chip a,a{color:var(--c);font-size:14px;font-weight:500}
label.f{display:grid;gap:8px;font-size:14px;font-weight:600}.field{display:flex;align-items:center;height:52px;padding:0 4px 0 16px;border-radius:14px;border:2px solid #d6dede;background:#fff}.field:focus-within{border-color:var(--c);box-shadow:0 0 0 4px var(--ring)}
.field input{flex:1;min-width:0;height:100%;border:0;outline:0;background:none;font:inherit;font-size:17px;color:var(--fg)}
.eye{width:44px;height:44px;border:0;background:none;border-radius:10px;color:#444d4e;display:grid;place-items:center;cursor:pointer}.eye svg{width:20px;height:20px}
.check{display:flex;align-items:center;gap:10px;font-size:14px;color:#3a4243}.check input{width:20px;height:20px;accent-color:var(--c)}
.go{height:54px;border:0;border-radius:14px;background:var(--c);color:#fff;font:inherit;font-size:17px;font-weight:600;cursor:pointer}.go:focus-visible,.eye:focus-visible,a:focus-visible{outline:3px solid var(--c);outline-offset:2px}
.bad{margin:0;color:var(--bad);font-weight:600}.small{margin:0;font-size:13px;color:var(--muted);text-align:center}
footer{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}footer svg{width:14px;height:14px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:640px){.wrap{padding:16px}main{gap:28px}.bot{width:84px;height:84px}.bubble{margin-bottom:36px}.card{padding:22px}}`

// the page around both: head, the LiaLMS mark, the footer
export function shellHtml(L: LoginTexts, base: string, title: string, body: string, o: { author?: boolean; mode?: string; secure?: boolean } = {}) {
  return `<!doctype html><html lang="${L.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · LiaLMS</title>
<style>${STYLE(base)}</style></head><body${o.author ? ' class="author"' : ''}><div class="wrap"><header>${MARK}<span>Lia<b>LMS</b></span>${o.mode ? `<span class="mode">${esc(o.mode)}</span>` : ''}</header></div>
<main class="wrap">${body}</main>
<div class="wrap"><footer>${
    o.secure
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>${esc(L.secure)}`
      : ''
  }</footer></div></body></html>`
}

export type Note = { t: number; text: string }

export function loginHtml(o: { L: LoginTexts; base: string; user: string; message: string; note?: Note; secure: boolean }) {
  const { L, base, user } = o
  const note = o.note
    ? `<figure class="note"><span class="av" aria-hidden="true">${esc(L.teacher[0])}</span><span><small><b>${esc(L.teacher)}</b> ${esc(L.fromTeacher)} · ${esc(
        new Date(o.note.t).toLocaleString(L.locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
      )}</small><blockquote>${esc(o.note.text)}</blockquote></span></figure>`
    : ''
  const who = user
    ? `<div class="chip"><span class="av" aria-hidden="true">${esc(user[0].toUpperCase())}</span><span>${esc(user)}</span><a href="${esc(base)}/">${esc(L.notYou)}</a></div>
<input type="hidden" name="name" value="${esc(user)}">`
    : `<label class="f">${esc(L.name)}<span class="field"><input name="name" autocomplete="username" required autofocus></span></label>`
  const eye = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`
  return shellHtml(
    L,
    base,
    L.title,
    `<section class="hi"><div class="meet">${COMPANION}<p class="bubble">${esc(L.companion)}</p></div>
<h1>${user ? `${esc(L.hello)} <span class="who">${esc(user)}</span>.` : esc(L.helloAlone)}</h1>
<p class="lead">${esc(L.lead)}</p>${note}</section>
<section class="card"><form method="post" action="${esc(base)}/lia-login">${who}
<label class="f" for="pw">${esc(L.password)}</label><span class="field"><input id="pw" name="password" type="password" autocomplete="current-password" required${
      user ? ' autofocus' : ''
    }><button type="button" class="eye" id="eye" aria-pressed="false" aria-label="${esc(L.show)}">${eye}</button></span>
<label class="check"><input type="checkbox" name="remember" value="1" checked> ${esc(L.remember)}</label>
${o.message ? `<p class="bad" role="alert">${esc(o.message)}</p>` : ''}<button class="go">${esc(L.go)}</button>
<p class="small">${esc(L.forgot)}</p></form></section>
<script>document.getElementById('eye').onclick=function(){var i=document.getElementById('pw'),s=i.type==='password';i.type=s?'text':'password';this.setAttribute('aria-pressed',String(s));this.setAttribute('aria-label',s?${JSON.stringify(
      L.hide,
    )}:${JSON.stringify(L.show)})}</script>`,
    { secure: o.secure },
  )
}

// after a right password: for about a second the page of the role, then on.
// The token first: the share page takes it from sessionStorage.
export function welcomeHtml(o: { L: LoginTexts; base: string; name: string; role: 'student' | 'author'; token: string }) {
  const { L, name } = o
  const author = o.role === 'author'
  return shellHtml(
    L,
    o.base,
    L.welcome,
    `<section class="hi"><div class="meet">${author ? AUTHOR : COMPANION}<p class="bubble">${esc(author ? L.ready : L.companion)}</p></div>
<h1>${esc(author ? L.back : L.hello)} <span class="who">${esc(name)}</span>.</h1>
<p class="lead" role="status">${esc(author ? L.write : L.learn)}</p></section>
<script>sessionStorage.setItem('lia-share-token', ${JSON.stringify(o.token)}); setTimeout(function () { location.replace(${JSON.stringify(
      o.base + '/',
    )}) }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1200)</script>`,
    { author, mode: author ? L.workshop : '' },
  )
}
