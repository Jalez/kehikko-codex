/**
 * End to end for Kehikot's skills in Codex's `$` menu, in scratch — run by hand, not by `bun test`:
 *
 *     HOST_DIR=<a worktree of the host, installed> CODEX_BIN=<a folder with a codex in it> bun dev/e2e/skills.ts
 *
 * (e.g. `npm i --prefix /tmp/codex-cli @openai/codex@0.164.0`, CODEX_BIN=/tmp/codex-cli/node_modules/.bin).
 * A scratch Kehikot host (`dev/scratch-host.mjs`, every location and HOME scratch), the Codex module
 * from this checkout, the real Codex CLI against a stand-in for the model API (`model-api.ts`), and
 * the Notes stand-in (`notes.ts`, skills written for Claude Code, one of them kehikko-bound to
 * Alpha). No credentials, no browser: this script is the page. Writes `skills-report.txt` beside it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import xterm from '@xterm/headless'

const HOST_DIR = process.env.HOST_DIR
if (!HOST_DIR || !process.env.CODEX_BIN) throw new Error('HOST_DIR and CODEX_BIN, please: see the top of this file')
const { bootHost, scratch, stop: stopHost } = await import(join(HOST_DIR, 'dev', 'scratch-host.mjs'))

const MODULE = join(import.meta.dir, '..', '..')
const CODEX_BIN = process.env.CODEX_BIN!
const REPORT = join(import.meta.dir, 'skills-report.txt')
writeFileSync(REPORT, '')
const say = (line: string) => {
  console.log(line)
  appendFileSync(REPORT, `${line}\n`)
}
const results: { check: string; ok: boolean }[] = []
const check = (name: string, ok: boolean, note = '') => {
  results.push({ check: name, ok })
  say(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ` — ${note}` : ''}`)
}
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))
const free = () => new Promise<number>((done) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)) }) })
async function until<T>(what: () => T | Promise<T>, ms = 15000, every = 200): Promise<T | null> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const got = await what()
    if (got) return got
    await sleep(every)
  }
  return null
}
const children: { pid: number }[] = []
process.on('exit', () => {
  for (const one of children) try { process.kill(one.pid, 'SIGTERM') } catch {}
})

/* ---- the scratch host, the person's Settings keeping every module's skills installed ---- */
const pageUrl = await bootHost('codex-skills-e2e')
const ROOT: string = scratch.root
const api = `http://127.0.0.1:${scratch.api}`
const pageOrigin = `http://127.0.0.1:${scratch.page}`
const origins = [pageOrigin, `http://localhost:${scratch.page}`, api, `http://localhost:${scratch.api}`].join(' ')
say(`host: ${api} (page ${pageUrl}), scratch ${ROOT}`)
const send = async (method: string, path: string, body: unknown) => {
  const response = await fetch(`${api}${path}`, { method, headers: { 'content-type': 'application/json', origin: pageOrigin }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
await send('POST', '/host/settings', { settings: { asked: true, tools: { auto: false }, skills: { auto: true } } })

/* ---- the stand-in model API ---- */
const apiPort = await free()
const requests = join(ROOT, 'model-requests.jsonl')
writeFileSync(requests, '')
const model = Bun.spawn(['bun', join(import.meta.dir, 'model-api.ts')], { env: { ...process.env, STANDIN_PORT: String(apiPort), STANDIN_LOG: requests }, stdout: Bun.file(join(ROOT, 'model.log')), stderr: 'inherit' })
children.push({ pid: model.pid })

/* ---- a scratch CODEX_HOME and HOME: the stand-in provider, and nothing of the person's ---- */
const home = join(ROOT, 'home')
const agents = join(home, '.agents', 'skills')
const codexHome = join(ROOT, 'codexhome')
mkdirSync(codexHome, { recursive: true })
const projectA = join(ROOT, 'project-a')
writeFileSync(
  join(codexHome, 'config.toml'),
  [
    'model = "gpt-5.5"',
    'model_provider = "standin"',
    '[model_providers.standin]',
    'name = "standin"',
    `base_url = "http://127.0.0.1:${apiPort}/v1"`,
    'wire_api = "responses"',
    'env_key = "STANDIN_KEY"',
    '[tui]',
    'screen_reader_detection_done = true',
    `[projects."${projectA}"]`,
    'trust_level = "trusted"',
    '[notice.model_migrations]',
    '"gpt-5.5" = "gpt-6-sol"',
    '',
  ].join('\n'),
)

/* ---- the Notes stand-in, registered ---- */
const notesPort = await free()
const notes = Bun.spawn(['bun', join(import.meta.dir, 'notes.ts'), String(notesPort), join(ROOT, 'notes-mcp.jsonl')], { stdout: Bun.file(join(ROOT, 'notes.log')), stderr: 'inherit' })
children.push({ pid: notes.pid })
writeFileSync(join(ROOT, 'modules', 'kehikot.notes.json'), JSON.stringify({ url: `http://127.0.0.1:${notesPort}`, keep: true }))

/* ---- the Codex module, from this checkout ---- */
const port = await free()
const origin = `http://127.0.0.1:${port}`
writeFileSync(join(ROOT, 'modules', 'kehikot.codex.json'), JSON.stringify({ url: origin, keep: true }))
const moduleEnv: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !/^(KEHIKKO_|KEHIKOT_|PORT$|HOST_PORT$|CLAUDE|CODEX_)/.test(key)) moduleEnv[key] = value
Object.assign(moduleEnv, {
  HOME: home,
  CODEX_HOME: codexHome,
  STANDIN_KEY: 'dummy',
  PATH: `${CODEX_BIN}:${process.env.PATH}`,
  PORT: String(port),
  KEHIKOT_ORIGINS: origins,
  KEHIKOT_ORIGIN: origins,
  KEHIKOT_MODULES_DIR: join(ROOT, 'modules'),
  CLAUDE_CONFIG: join(ROOT, 'home/.claude.json'),
  CLAUDE_CONFIG_DIR: join(ROOT, 'claude'),
})
const moduleLog = join(ROOT, 'codex-module.log')
const moduleProc = Bun.spawn(['./run.sh'], { cwd: MODULE, env: moduleEnv, stdout: 'pipe', stderr: 'pipe' })
children.push({ pid: moduleProc.pid })
for (const stream of [moduleProc.stdout, moduleProc.stderr]) {
  ;(async () => {
    for await (const chunk of stream as ReadableStream<Uint8Array>) appendFileSync(moduleLog, chunk)
  })()
}
check('the module starts', Boolean(await until(async () => (await fetch(`${origin}/healthz`).then((r) => r.ok).catch(() => false)), 30000)))

/* ---- two kehikot: "Wide" has Alpha, Codex and Notes; "Narrow" has Codex and Notes ---- */
const canvases = (await (await fetch(`${api}/host/canvases`)).json()) as { projects: { id: number; path: string }[]; canvases: { id: number; key: string; name: string; project: number }[] }
const projectId = canvases.projects.find((one) => one.path === projectA)!.id
const ofProject = canvases.canvases.filter((one) => one.project === projectId)
const wide = ofProject.find((one) => one.name === 'Wide')!
const narrow = ofProject.find((one) => one.id !== wide.id)!
await send('PATCH', `/host/canvases/${wide.id}`, { placements: [{ i: 'kehikot.alpha', x: 0, y: 0, w: 4, h: 14 }, { i: 'kehikot.codex', x: 4, y: 0, w: 4, h: 14 }, { i: 'kehikot.notes', x: 8, y: 0, w: 4, h: 14 }] })
await send('PATCH', `/host/canvases/${narrow.id}`, { placements: [{ i: 'kehikot.codex', x: 0, y: 0, w: 6, h: 14 }, { i: 'kehikot.notes', x: 6, y: 0, w: 6, h: 14 }] })
say(`kehikko "${wide.name}" (${wide.key}): Alpha, Codex, Notes; kehikko "${narrow.name}" (${narrow.key}): Codex, Notes`)
check('the host has found Codex and Notes', Boolean(await until(async () => {
  const text = await (await fetch(`${api}/host/modules?fresh=1`)).text().catch(() => '')
  return text.includes('"kehikot.codex"') && text.includes('"kehikot.notes"') ? text : null
}, 30000, 1000)))
const skills = await (await fetch(`${api}/host/skills?module=kehikot.codex`)).json() as { skills?: { name: string; status: string; says: string }[] }
check('the host shows Codex’s declared $kehikot-here as kept by its module, not for Claude Code', skills.skills?.[0]?.name === 'kehikot-here' && skills.skills[0].status === 'agent', JSON.stringify(skills.skills?.map((one) => [one.name, one.status, one.says])))
check('and installed nothing of Codex’s in Claude Code’s folder', !existsSync(join(ROOT, 'claude', 'skills', 'kehikot-here')))
check('nothing is in ~/.agents/skills before a session starts', !existsSync(agents) || readdirSync(agents).length === 0)

/* ---- the page ---- */
const app = await (await fetch(`${origin}/app`)).text()
const ticket = /id="ticket"[^>]*>\s*"?([^"<]+)"?\s*</.exec(app)?.[1] ?? /"ticket"\s*:\s*"([^"]+)"/.exec(app)?.[1]
const placeOf = (canvas: { key: string; name: string }) => ({ epic: 'methods', parts: [], kehikko: { key: canvas.key }, kehikkoName: canvas.name })
class View {
  term = new xterm.Terminal({ cols: 140, rows: 44, allowProposedApi: true })
  said: Record<string, unknown>[] = []
  ws: WebSocket
  closed: { code: number } | null = null
  constructor(place: unknown) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/session`, { headers: { origin } } as never)
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => this.ws.send(JSON.stringify({ ticket, projectPath: projectA, place, session: null, cols: 140, rows: 44 }))
    this.ws.onmessage = (event) => {
      if (typeof event.data === 'string') this.said.push(JSON.parse(event.data))
      else this.term.write(new Uint8Array(event.data as ArrayBuffer))
    }
    this.term.onData((data: string) => this.frame({ d: data }))
    this.ws.onclose = (event) => (this.closed = { code: event.code })
  }
  frame(one: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(one))
  }
  async keys(text: string) {
    for (const ch of text) {
      this.frame({ d: ch })
      await sleep(30)
    }
  }
  async type(text: string) {
    await this.keys(text)
    await sleep(400)
    this.frame({ d: '\r' })
  }
  screen(): string {
    const b = this.term.buffer.active
    const out: string[] = []
    for (let i = 0; i < this.term.rows; i++) out.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? '')
    return out.join('\n').replace(/\n+$/, '')
  }
}
type Body = { input?: { type?: string; role?: string; content?: { text?: string }[]; output?: unknown }[] } | null
const modelRequests = () => readFileSync(requests, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { path: string; body: Body })
const developer = (body: Body) => (body?.input ?? []).filter((one) => one.role === 'developer').map((one) => (one.content ?? []).map((c) => c.text ?? '').join(''))
const installed = () => (existsSync(agents) ? readdirSync(agents).filter((one) => !one.startsWith('.')).sort() : [])
const ready = (view: View) => until(() => (/Ask Codex|OpenAI Codex|›/.test(view.screen()) ? view.screen() : null), 25000)

/* ---- 1. a session on "Wide" ---- */
const one = new View(placeOf(wide))
check('a session opens in the container on Wide', Boolean(await until(() => one.said.find((said) => 'opened' in said), 20000)))
check('Codex draws its own UI', Boolean(await ready(one)))
await sleep(1500)
const wanted = ['kehikot-here', 'kehikot-module', 'notes-read', 'notes-with-alpha']
check('before Codex started, Kehikot installed its skills in ~/.agents/skills: Codex’s own, the kehikko’s (one kehikko-bound to Alpha), and Kehikot’s own kept everywhere', JSON.stringify(installed()) === JSON.stringify(wanted), installed().join(', '))
check('the one that needs a module not on the kehikko is not installed', !installed().includes('notes-with-nobody'))
const marker = (name: string) => JSON.parse(readFileSync(join(agents, name, '.kehikot-skill.json'), 'utf8'))
check('each carries Kehikot’s marker', wanted.every((name) => marker(name).by === 'kehikot.codex'), wanted.map((name) => `${name}: ${marker(name).module}${marker(name).everywhere ? ', everywhere' : ''}${marker(name).bound ? ', bound' : ''}`).join('; '))
const notesRead = readFileSync(join(agents, 'notes-read', 'SKILL.md'), 'utf8')
check('a Claude Code skill is installed in Codex’s format: $name, $CODEX_THREAD_ID, the load-time command to run first', notesRead.includes('$notes-read') && notesRead.includes('$CODEX_THREAD_ID') && notesRead.includes('require_escalated') && !notesRead.includes('allowed-tools'), notesRead.split('\n').slice(0, 4).join(' / '))
check('the kehikko-bound one checks its place first', readFileSync(join(agents, 'notes-with-alpha', 'SKILL.md'), 'utf8').includes('works only in a Codex conversation Kehikot started on a kehikko that also has'))

/* Codex's own `$` menu. */
await one.keys('$')
const menu = await until(() => (/kehikot-here/.test(one.screen()) ? one.screen() : null), 8000)
say(`--- Wide, after typing $\n${(menu ?? one.screen()).split('\n').filter((l) => l.trim()).slice(-16).join('\n')}\n---`)
check('Codex’s $ menu lists $kehikot-here', Boolean(menu))
await one.keys('notes')
const notesMenu = await until(() => (/notes-read/.test(one.screen()) && /notes-with-alpha/.test(one.screen()) ? one.screen() : null), 8000)
say(`--- Wide, after typing $notes\n${(notesMenu ?? one.screen()).split('\n').filter((l) => l.trim()).slice(-10).join('\n')}\n---`)
check('and the modules’ skills: $notes-read and, Alpha being on Wide, $notes-with-alpha', Boolean(notesMenu))
for (let i = 0; i < 6; i++) {
  one.frame({ d: '\x7f' })
  await sleep(60)
}
one.frame({ d: '\x1b' })
await sleep(600)

/* $kehikot-here, invoked: the stand-in model does what the skill says. */
/* The page says what is on screen: Wide, epic methods (what /api/here assigns to). */
await fetch(`${origin}/api/showing`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-module-ticket': ticket! }, body: JSON.stringify({ page: 'drivepage01', projectPath: projectA, key: `epic=methods;parts=-;kehikko=key:${wide.key}`, kehikkoName: wide.name, onScreen: true }) })
const before = modelRequests().length
await one.type('$kehikot-here own')
const firstReq = await until(() => modelRequests().slice(before).find((req) => req.path.endsWith('/responses')) ?? null, 20000)
const dev = developer(firstReq?.body ?? null).join('\n\n')
check('the session is told its skills as callable $name entries', dev.includes('Kehikot skills in this conversation') && dev.includes('- `$kehikot-here` (Codex)') && dev.includes('- `$notes-read` (Notes)') && dev.includes('- `$kehikot-module` (Kehikot)'), dev.split('\n').filter((l) => l.startsWith('Kehikot skills') || l.startsWith('- `$')).join(' | ').slice(0, 500))
const listed = dev.match(/<skills_instructions>[\s\S]*?<\/skills_instructions>/)?.[0] ?? ''
/* Codex lists to the model only the skills it may use unasked; the person-only ones (`allow_implicit_invocation: false`) run from `$` alone. */
check('and Codex lists the one its model may use unasked among its own skills, from ~/.agents/skills, and not the person-only ones', listed.includes('.agents/skills') && listed.includes('- notes-with-alpha:') && !listed.includes('- notes-read:') && !listed.includes('- kehikot-here:'), listed.split('\n').filter((l) => /^- (kehikot|notes)|\.agents/.test(l)).map((l) => l.slice(0, 90)).join(' | '))
const asked = await until(() => (one.screen().includes('Would you like to run') ? one.screen() : null), 25000)
say(`--- the command $kehikot-here asks to run\n${(asked ?? one.screen()).split('\n').filter((l) => l.trim()).slice(-14).join('\n')}\n---`)
check('$kehikot-here runs its command, asking to leave the sandbox', Boolean(asked) && /api\/here/.test(asked ?? ''))
one.frame({ d: 'y' })
const answer = await until(() => modelRequests().slice(before).flatMap((req) => req.body?.input ?? []).find((item) => item.type === 'function_call_output' && String(item.output).includes('Kehikot:')), 25000)
const answerText = answer ? String(answer.output).split('\n').find((l) => l.includes('Kehikot:')) ?? '' : ''
check('and the module answers it: the conversation is assigned', answerText.startsWith('Kehikot: Assigned') || answerText.startsWith('Kehikot: This conversation'), answerText)

/* ---- 2. a session on "Narrow", while the first holds the kehikko-bound skill ---- */
await sleep(1500)
const two = new View(placeOf(narrow))
check('a second session opens on Narrow', Boolean(await until(() => two.said.find((said) => 'opened' in said), 20000)))
check('Codex draws its own UI there', Boolean(await ready(two)))
await sleep(1500)
await two.keys('$notes')
const narrowMenu = await until(() => (/notes-read/.test(two.screen()) ? two.screen() : null), 8000)
say(`--- Narrow, after typing $notes\n${(narrowMenu ?? two.screen()).split('\n').filter((l) => l.trim()).slice(-10).join('\n')}\n---`)
check('on Narrow, $notes-read is there and $notes-with-alpha (installed for Wide’s session) is switched off', Boolean(narrowMenu) && !/notes-with-alpha/.test(narrowMenu ?? ''))
check('it is still installed, for Wide’s session', installed().includes('notes-with-alpha'))

/* ---- 3. Wide's session ends: what only it held goes; what Settings keep stays ---- */
const sessionOne = [...one.said].reverse().find((said) => typeof said.session === 'string')?.session as string | undefined
const ended = await fetch(`${origin}/api/end`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-module-ticket': ticket! }, body: JSON.stringify({ session: sessionOne }) }).then((r) => r.json()).catch(() => null)
say(`ended ${sessionOne}: ${JSON.stringify(ended)}`)
const gone = await until(() => (!installed().includes('notes-with-alpha') ? installed() : null), 20000)
check('when the session on Wide ends, the kehikko-bound skill only it held is removed', Boolean(gone), installed().join(', '))
check('Kehikot’s own, kept for every conversation, and the skills Narrow’s session holds stay', ['kehikot-here', 'kehikot-module', 'notes-read'].every((name) => installed().includes(name)), installed().join(', '))

say(`--- module log, skills\n${readFileSync(moduleLog, 'utf8').split('\n').filter((l) => /skill|installed|removed/.test(l)).slice(0, 30).join('\n')}\n---`)
const failed = results.filter((one) => !one.ok)
say(`\n${results.length - failed.length}/${results.length} checks passed`)
for (const child of children) try { process.kill(child.pid, 'SIGTERM') } catch {}
stopHost()
process.exit(failed.length ? 1 : 0)
