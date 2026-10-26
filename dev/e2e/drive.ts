/**
 * End to end, in scratch — run by hand, not by `bun test`:
 *
 *     HOST_DIR=<a detached worktree of the host, installed> CODEX_BIN=<a folder with a codex in it> KEEP=1 bun dev/e2e/drive.ts
 *
 * (e.g. `npm i --prefix /tmp/codex-cli @openai/codex@0.164.0`, CODEX_BIN=/tmp/codex-cli/node_modules/.bin).
 * a scratch Kehikot host (origin/main, `dev/scratch-host.mjs`), the Codex
 * module from its worktree (ready-built), the real Codex CLI 0.164.0 against a stand-in for the
 * model API, a stand-in module with an MCP door and skills. No credentials, no browser: this
 * script is the page (the session socket and the feed, as `src/` speaks them).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

import xterm from '@xterm/headless'

const HOST_DIR = process.env.HOST_DIR
if (!HOST_DIR || !process.env.CODEX_BIN) throw new Error('HOST_DIR and CODEX_BIN, please: see the top of this file')
const { bootHost, scratch, stop: stopHost } = await import(join(HOST_DIR, 'dev', 'scratch-host.mjs'))

const MODULE = join(import.meta.dir, '..', '..')
const CODEX_BIN = process.env.CODEX_BIN!
const REPORT = join(import.meta.dir, 'report.txt')
writeFileSync(REPORT, '')
const say = (line: string) => {
  console.log(line)
  appendFileSync(REPORT, `${line}\n`)
}
const results: { check: string; ok: boolean; note: string }[] = []
const check = (name: string, ok: boolean, note = '') => {
  results.push({ check: name, ok, note })
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

const children: { kill: (signal?: number | NodeJS.Signals) => void; pid: number; exited: Promise<number> }[] = []
process.on('exit', () => {
  for (const one of children) try { process.kill(one.pid, 'SIGTERM') } catch {}
})

/* ---- the scratch host ---- */
const pageUrl = await bootHost('codex-e2e')
const ROOT: string = scratch.root
const api = `http://127.0.0.1:${scratch.api}`
const pageOrigin = `http://127.0.0.1:${scratch.page}`
const origins = [pageOrigin, `http://localhost:${scratch.page}`, api, `http://localhost:${scratch.api}`].join(' ')
say(`host: ${api} (page ${pageUrl}), scratch ${ROOT}`)

/* ---- the stand-in model API ---- */
const apiPort = await free()
const requests = join(ROOT, 'model-requests.jsonl')
writeFileSync(requests, '')
const model = Bun.spawn(['bun', join(import.meta.dir, 'model-api.ts')], { env: { ...process.env, STANDIN_PORT: String(apiPort), STANDIN_LOG: requests, STANDIN_SCALE: '2' }, stdout: Bun.file(join(ROOT, 'model.log')), stderr: 'inherit' })
children.push({ kill: (s) => model.kill(s as number), pid: model.pid, exited: model.exited })

/* ---- a scratch CODEX_HOME: the stand-in provider, and nothing of the person's ---- */
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
const notesLog = join(ROOT, 'notes-mcp.jsonl')
writeFileSync(notesLog, '')
const notes = Bun.spawn(['bun', join(import.meta.dir, 'notes.ts'), String(notesPort), notesLog], { stdout: Bun.file(join(ROOT, 'notes.log')), stderr: 'inherit' })
children.push({ kill: (s) => notes.kill(s as number), pid: notes.pid, exited: notes.exited })
writeFileSync(join(ROOT, 'modules', 'kehikot.notes.json'), JSON.stringify({ url: `http://127.0.0.1:${notesPort}`, keep: true }))

/* ---- the Codex module, ready-built ---- */
const port = await free()
const origin = `http://127.0.0.1:${port}`
writeFileSync(join(ROOT, 'modules', 'kehikot.codex.json'), JSON.stringify({ url: origin, keep: true }))
const moduleEnv: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !/^(KEHIKKO_|KEHIKOT_|PORT$|HOST_PORT$|CLAUDE|CODEX_)/.test(key)) moduleEnv[key] = value
Object.assign(moduleEnv, {
  HOME: join(ROOT, 'home'),
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
let moduleProc: ReturnType<typeof Bun.spawn> | null = null
const moduleLog = join(ROOT, 'codex-module.log')
async function startModule() {
  moduleProc = Bun.spawn(['./run.sh'], { cwd: MODULE, env: moduleEnv, stdout: 'pipe', stderr: 'pipe' })
  const proc = moduleProc
  for (const stream of [proc.stdout, proc.stderr]) {
    ;(async () => {
      for await (const chunk of stream as ReadableStream<Uint8Array>) appendFileSync(moduleLog, chunk)
    })()
  }
  children.push({ kill: (s) => proc.kill(s as number), pid: proc.pid, exited: proc.exited })
  return until(async () => (await fetch(`${origin}/healthz`).then((r) => r.ok).catch(() => false)), 20000)
}
check('the module starts ready-built (serve.ts, not Vite)', Boolean(await startModule()))
const health = await fetch(`${origin}/healthz`).then((r) => r.json()).catch(() => null)
say(`module health: ${JSON.stringify(health)}`)

/* ---- put Codex, Notes and Alpha on project-a's "Wide" kehikko ---- */
const send = async (method: string, path: string, body: unknown) => {
  const response = await fetch(`${api}${path}`, { method, headers: { 'content-type': 'application/json', origin: pageOrigin }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
const canvases = (await (await fetch(`${api}/host/canvases`)).json()) as { projects: { id: number; path: string }[]; canvases: { id: number; key: string; name: string; project: number; placements: { i: string; x: number; y: number; w: number; h: number }[] }[] }
const projectId = canvases.projects.find((one) => one.path === projectA)!.id
const wide = canvases.canvases.find((one) => one.project === projectId && one.name === 'Wide')!
await send('PATCH', `/host/canvases/${wide.id}`, {
  placements: [
    { i: 'kehikot.alpha', x: 0, y: 0, w: 4, h: 14 },
    { i: 'kehikot.codex', x: 4, y: 0, w: 4, h: 14 },
    { i: 'kehikot.notes', x: 8, y: 0, w: 4, h: 14 },
  ],
})
say(`kehikko "Wide" key ${wide.key}: Alpha, Codex, Notes`)
/* The host's sweep finds the new registrations. */
const discovered = await until(async () => {
  const text = await (await fetch(`${api}/host/modules?fresh=1`)).text().catch(() => '')
  return text.includes('"kehikot.codex"') && text.includes('"kehikot.notes"') ? text : null
}, 30000, 1000)
check('the host has found the Codex module and Notes in its registry', Boolean(discovered))

/* ---- the page: ticket, feed, session socket ---- */
const app = await (await fetch(`${origin}/app`)).text()
const ticket = /id="ticket"[^>]*>\s*"?([^"<]+)"?\s*</.exec(app)?.[1] ?? /"ticket"\s*:\s*"([^"]+)"/.exec(app)?.[1]
check('the page carries its ticket', Boolean(ticket), ticket ? `${ticket.slice(0, 6)}…` : app.slice(0, 200))

const feed: { event: string; data: unknown }[] = []
async function follow() {
  const response = await fetch(`${origin}/api/feed?ticket=${encodeURIComponent(ticket!)}&notices=1`)
  const reader = response.body!.getReader()
  let buffer = ''
  ;(async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }))
      if (done) break
      buffer += new TextDecoder().decode(value)
      let at
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message'
        const data = /^data: (.*)$/m.exec(block)?.[1]
        try { feed.push({ event, data: data ? JSON.parse(data) : null }) } catch {}
      }
    }
  })()
}
await follow()

const place = { epic: 'methods', parts: [], kehikko: { key: wide.key }, kehikkoName: 'Wide' }
class View {
  term = new xterm.Terminal({ cols: 120, rows: 40, allowProposedApi: true })
  said: Record<string, unknown>[] = []
  ws: WebSocket
  closed: { code: number; reason: string } | null = null
  constructor(session: string | null) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/session`, { headers: { origin } } as never)
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => this.ws.send(JSON.stringify({ ticket, projectPath: projectA, place, session, cols: 120, rows: 40 }))
    this.ws.onmessage = (event) => {
      if (typeof event.data === 'string') this.said.push(JSON.parse(event.data))
      else this.term.write(new Uint8Array(event.data as ArrayBuffer))
    }
    this.term.onData((data: string) => this.frame({ d: data }))
    this.ws.onclose = (event) => (this.closed = { code: event.code, reason: event.reason })
  }
  frame(one: unknown) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(one))
  }
  async type(text: string) {
    for (const ch of text) {
      this.frame({ d: ch })
      await sleep(20)
    }
    await sleep(300)
    this.frame({ d: '\r' })
  }
  screen(): string {
    const b = this.term.buffer.active
    const out: string[] = []
    for (let i = 0; i < this.term.rows; i++) out.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? '')
    return out.join('\n').replace(/\n+$/, '')
  }
}
const modelRequests = () => readFileSync(requests, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { path: string; body: { input?: { type?: string; role?: string; content?: { text?: string }[] }[] } | null })
const developer = (body: { input?: { type?: string; role?: string; content?: { text?: string }[] }[] } | null) => (body?.input ?? []).filter((one) => one.role === 'developer').map((one) => (one.content ?? []).map((c) => c.text ?? '').join(''))
const userSaid = (body: { input?: { type?: string; role?: string; content?: { text?: string }[] }[] } | null) => (body?.input ?? []).filter((one) => one.role === 'user').map((one) => (one.content ?? []).map((c) => c.text ?? '').join(''))
const places = () => JSON.parse(readFileSync(join(projectA, '.kehikot', 'codex', 'places.json'), 'utf8'))

/* ---- 1. a session starts from the container ---- */
const view = new View(null)
const opened = await until(() => view.said.find((one) => 'opened' in one), 15000)
check('a new session opens in the container', Boolean(opened), JSON.stringify(opened))
const drawn = await until(() => (view.screen().includes('Ask Codex') || view.screen().includes('OpenAI Codex') ? view.screen() : null), 20000)
check('Codex draws its own UI in the container’s terminal', Boolean(drawn), drawn ? '' : view.screen().slice(0, 400))
say(`--- screen at start\n${view.screen()}\n---`)
view.frame({ w: true })
const before = modelRequests().length
await view.type('hello from the container')
const firstReq = await until(() => modelRequests().slice(before).find((one) => one.path.endsWith('/responses')) ?? null, 20000)
check('the prompt reached the (stand-in) model', Boolean(firstReq))
const dev = developer(firstReq?.body ?? null).join('\n\n')
check('the session was told its place', dev.includes('Kehikot: this conversation belongs to project project-a') && dev.includes('epic methods (the whole epic) on the kehikko "Wide"'), dev.split('\n').find((l) => l.startsWith('Kehikot:'))?.slice(0, 200) ?? 'not told')
check('and one line per module on the kehikko, with its MCP server', dev.includes('- Notes (kehikot.notes): "Notes beside the work.". MCP server: notes') && dev.includes('Alpha (kehikot.alpha)'), '')
check('and the skills loaded for it, as Codex lists its own', dev.includes('<skills_instructions>') && dev.includes('- kehikot-here:') && dev.includes('- notes-read:') && dev.includes('- notes-with-alpha:') && !dev.includes('notes-with-nobody'), '')
say(`--- what the session was told\n${dev.split('<skills_instructions>')[0]!.split('\n').filter((l) => l.startsWith('Kehikot') || l.startsWith('- ') || l.startsWith('Modules')).join('\n')}\n${(dev.match(/<skills_instructions>[\s\S]*?<\/skills_instructions>/)?.[0] ?? '').replace(/\(file: [^)]*\)/g, '(file …)')}\n---`)

const session = await until(() => view.said.find((one) => one.exists === true && typeof one.session === 'string')?.session as string | undefined, 15000)
check('the session learnt the id Codex chose', Boolean(session), String(session))
const filed = await until(() => {
  try {
    const p = places()
    const key = Object.keys(p.places).find((k) => k.includes(`kehikko=key:${wide.key}`))
    return key && p.places[key].own === session && p.sessions[session!]?.home === key ? { key, entry: p.sessions[session!] } : null
  } catch {
    return null
  }
}, 15000)
check('it is filed under its place and is that kehikko’s own, with nothing typed', Boolean(filed), filed ? `${filed.key}, label “${filed.entry.label}”` : '')

/* The skill's file as Codex reads it. */
const skillFile = /`k0` = `([^`]+)`/.exec(dev)?.[1]
const notesRead = skillFile && existsSync(join(skillFile, 'notes-read', 'SKILL.md')) ? readFileSync(join(skillFile, 'notes-read', 'SKILL.md'), 'utf8') : ''
check('a Claude Code skill arrives in Codex’s format: $name, $CODEX_THREAD_ID, the load-time command to run first', notesRead.includes('$notes-read') && notesRead.includes('$CODEX_THREAD_ID') && notesRead.includes('require_escalated') && !notesRead.includes('allowed-tools'), notesRead.split('\n').slice(0, 6).join(' / '))

/* ---- the MCP doors it sees ---- */
await sleep(500)
await view.type('/mcp')
const mcpScreen = await until(() => (/kehikko: connected/.test(view.screen()) && /notes: connected/.test(view.screen()) ? view.screen() : null), 10000)
check('the session sees the kehikko’s MCP doors (/mcp: kehikko and notes connected)', Boolean(mcpScreen), (mcpScreen ?? view.screen()).split('\n').filter((l) => /connected|MCP/.test(l)).join(' | '))
const notesCalls = readFileSync(notesLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
check('Notes’ door was called with the session’s place token', notesCalls.some((one) => one.url.includes('kehikot-place=') && one.method === 'tools/list'), `${notesCalls.length} requests`)

/* ---- the meter ---- */
const meter1 = await until(() => [...view.said].reverse().find((one) => one.meter && (one.meter as { context?: { tokens?: number } }).context?.tokens)?.meter as { context: { tokens: number; window: number; percent: number; model?: { name: string } } } | undefined, 15000)
check('the context meter has a figure from the transcript', Boolean(meter1), meter1 ? `${meter1.context.tokens} of ${meter1.context.window} (${meter1.context.percent}%), ${meter1.context.model?.name}` : '')

/* ---- activity ---- */
const finished = await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string; state: string; label: string }[] } | undefined
  return rows?.items.find((one) => one.id === session && one.state === 'done')
}, 15000)
check('its turn’s end is in the activity list the page hands the host (done)', Boolean(finished), JSON.stringify(finished))

/* A module put on the kehikko mid-session is said at the next prompt. */
await send('PATCH', `/host/canvases/${wide.id}`, {
  placements: [
    { i: 'kehikot.alpha', x: 0, y: 0, w: 3, h: 14 },
    { i: 'kehikot.codex', x: 3, y: 0, w: 3, h: 14 },
    { i: 'kehikot.notes', x: 6, y: 0, w: 3, h: 14 },
    { i: 'kehikot.beta', x: 9, y: 0, w: 3, h: 14 },
  ],
})
await sleep(2500)
const before2 = modelRequests().length
await view.type('SLOW 4 a second prompt')
const working = await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string; state: string }[] } | undefined
  return rows?.items.find((one) => one.id === session && one.state === 'working')
}, 8000, 100)
check('a turn under way is in the activity list (working)', Boolean(working))
const secondReq = await until(() => modelRequests().slice(before2).find((one) => one.path.endsWith('/responses')) ?? null, 20000)
const dev2 = modelRequests().slice(before2).flatMap((one) => developer(one.body)).filter((one) => one.startsWith('Kehikot: the kehikko'))
check('a module added mid-session is announced at the next prompt', dev2.some((one) => one.includes('It now also has') && one.includes('Beta (kehikot.beta)')), dev2.join(' ').slice(0, 300))
await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string; state: string }[] } | undefined
  return rows?.items.find((one) => one.id === session && one.state === 'done')
}, 15000)
const meter2 = await until(() => {
  const latest = [...view.said].reverse().find((one) => one.meter && (one.meter as { context?: { tokens?: number } }).context?.tokens)?.meter as { context: { tokens: number } } | undefined
  return latest && meter1 && latest.context.tokens > meter1.context.tokens ? latest : null
}, 15000)
check('the meter moves with the conversation', Boolean(meter2), meter2 ? `${meter1?.context.tokens} → ${meter2.context.tokens}` : '')

/* A question for the person: needs you. */
await view.type('ESC: echo approved-by-the-person')
const asking = await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string; state: string; detail: string }[] } | undefined
  return rows?.items.find((one) => one.id === session && one.state === 'attention')
}, 15000)
check('an approval question on screen is “needs you” in the activity list', Boolean(asking), JSON.stringify(asking))
say(`--- screen at the question\n${view.screen().split('\n').filter((l) => l.trim()).slice(-12).join('\n')}\n---`)
/* Codex runs PermissionRequest hooks before it draws the question: press only once it is on screen. */
const dialog = await until(() => (view.screen().includes('Would you like to run') ? view.screen() : null), 10000)
check('Codex’s own approval question is on screen', Boolean(dialog))
view.frame({ d: 'y' })
await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string; state: string }[] } | undefined
  return rows?.items.find((one) => one.id === session && one.state === 'done')
}, 15000)

/* The MCP tool, as an agent on the kehikko would call it. */
const mcp = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sessions', arguments: { project: projectA } } }) }).then((r) => r.json()).catch(() => null) as { result?: { content?: { text: string }[] } } | null
const listedText = mcp?.result?.content?.[0]?.text ?? ''
say(listedText); check('the sessions MCP tool lists it under its place, with its state and context', listedText.includes(session ?? '-') && listedText.includes('finished') && listedText.includes('context'), '')

/* Compact: Codex's own /compact, typed on a press. */
await sleep(1500)
view.frame({ c: 'compact' })
const commanded = await until(() => view.said.find((one) => one.commanded), 5000)
check('Compact is typed at the prompt on a press, when Codex waits there', Boolean(commanded && (commanded.commanded as { ok: boolean }).ok), JSON.stringify(commanded))
const compacted = await until(() => [...view.said].reverse().find((one) => (one.meter as { context?: { compacted?: unknown } } | undefined)?.context?.compacted), 15000)
check('and the meter says it was compacted', Boolean(compacted), JSON.stringify((compacted?.meter as { context?: { compacted?: unknown; tokens?: number } })?.context?.compacted ?? null))

/* ---- 2. resume after a module restart, with a turn cut off ---- */
await sleep(1500)
const before3 = modelRequests().length
await view.type('SLOW 40 a long task that a restart will cut off')
await until(() => modelRequests().slice(before3).find((one) => one.path.endsWith('/responses')), 10000)
await sleep(800)
const pid = moduleProc!.pid
process.kill(pid, 'SIGTERM')
await moduleProc!.exited
await until(() => view.closed, 5000)
check('stopping the module closes the view (the session ends with it: per-run settings keep Codex off its background server)', Boolean(view.closed), JSON.stringify(view.closed))
const lock = await until(() => {
  const dir = join(codexHome, 'thread-writer-locks')
  const names = existsSync(dir) ? Bun.spawnSync(['/usr/sbin/lsof', '-F', 'p', '+D', dir]).stdout.toString() : ''
  return names.includes('p') ? null : 'released'
}, 8000)
check('the Codex process went with it (its lock released)', Boolean(lock))
const working3 = places().sessions[session!]?.working
check('the record marked it as working when the module went', Boolean(working3), String(working3))

check('the module starts again', Boolean(await startModule()))
const app2 = await (await fetch(`${origin}/app`)).text()
const ticket2 = /id="ticket"[^>]*>\s*"?([^"<]+)"?\s*</.exec(app2)?.[1] ?? /"ticket"\s*:\s*"([^"]+)"/.exec(app2)?.[1]
Object.assign(globalThis, {})
feed.length = 0
const followAgain = async () => {
  const response = await fetch(`${origin}/api/feed?ticket=${encodeURIComponent(ticket2!)}&notices=1&project=${encodeURIComponent(projectA)}`)
  const reader = response.body!.getReader()
  let buffer = ''
  ;(async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }))
      if (done) break
      buffer += new TextDecoder().decode(value)
      let at
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message'
        const data = /^data: (.*)$/m.exec(block)?.[1]
        try { feed.push({ event, data: data ? JSON.parse(data) : null }) } catch {}
      }
    }
  })()
}
await followAgain()
const cutRow = await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string; state: string; label: string }[] } | undefined
  return rows?.items.find((one) => one.id === `cut-off:${session}`)
}, 15000)
check('“interrupted work”: the cut-off turn is a “needs you” line in the Inbox list', Boolean(cutRow && cutRow.state === 'attention'), JSON.stringify(cutRow))

const before4 = modelRequests().length
const resumed = new (class extends View {})(session!)
;(resumed as unknown as { ticketOverride: string }).ticketOverride = ticket2!
/* The page sends the new ticket: rebuild the opening frame. */
resumed.ws.onopen = () => resumed.ws.send(JSON.stringify({ ticket: ticket2, projectPath: projectA, place, session, cols: 120, rows: 40 }))
const reopened = await until(() => resumed.said.find((one) => 'opened' in one), 15000)
check('opening its place again resumes the same conversation by id', Boolean(reopened && reopened.opened === 'resumed' && reopened.session === session), JSON.stringify(reopened))
const toldReq = await until(() => modelRequests().slice(before4).find((one) => userSaid(one.body).some((t) => t.startsWith('Kehikot restarted while you were working'))) ?? null, 20000)
check('and, the setting being on, it is told once what happened', Boolean(toldReq))
const devResume = developer(toldReq?.body ?? null).join('\n')
check('on resume it is told its place again (SessionStart, source resume)', devResume.includes('Kehikot: this conversation belongs to project project-a'), '')
const cutGone = await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string }[] } | undefined
  return rows && !rows.items.some((one) => one.id === `cut-off:${session}`) ? 'gone' : null
}, 10000)
check('the Inbox line goes once the person has it open', Boolean(cutGone))

/* ---- $kehikot-here, as the skill has the model run it: $CODEX_THREAD_ID, outside the sandbox ---- */
await sleep(1500)
await fetch(`${origin}/api/showing`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-module-ticket': ticket2! }, body: JSON.stringify({ page: 'drivepage01', projectPath: projectA, key: `epic=results;parts=-;kehikko=key:${wide.key}`, kehikkoName: 'Wide', onScreen: true }) })
await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string; state: string }[] } | undefined
  return rows?.items.find((one) => one.id === session && one.state === 'done') ?? (resumed.screen().includes('Ask Codex') ? 'idle' : null)
}, 15000)
const before5 = modelRequests().length
await resumed.type(`ESC: curl -s -m 5 -X POST -G --data-urlencode "session=$CODEX_THREAD_ID" --data-urlencode 'say=own' ${origin}/api/here`)
const hereDialog = await until(() => (resumed.screen().includes('Would you like to run') ? resumed.screen() : null), 15000)
check('$kehikot-here’s command asks to leave the sandbox (loopback is blocked inside it)', Boolean(hereDialog))
resumed.frame({ d: 'y' })
const hereAnswer = await until(() => modelRequests().slice(before5).flatMap((one) => (one.body?.input ?? []) as { type?: string; output?: unknown }[]).find((one) => one.type === 'function_call_output' && String(one.output).includes('Kehikot:')), 20000)
const answerText = hereAnswer ? String(hereAnswer.output).split('\n').find((l) => l.includes('Kehikot:')) ?? '' : ''
check('the module believes $CODEX_THREAD_ID for a conversation a Codex process holds, and assigns it', answerText.includes('Kehikot: Assigned to Wide · results'), answerText)
const resultsKey = `epic=results;parts=-;kehikko=key:${wide.key}`
check('the record files it there, as that place’s own', places().places[resultsKey]?.own === session, JSON.stringify(places().places[resultsKey] ?? null))

/* ---- Clear: a new conversation in the same process, followed by the record ---- */
await until(() => {
  const rows = [...feed].reverse().find((one) => one.event === 'activity')?.data as { items: { id: string; state: string }[] } | undefined
  return rows?.items.find((one) => one.id === session && one.state === 'done')
}, 15000)
await sleep(1500)
resumed.frame({ c: 'clear' })
const cleared = await until(() => resumed.said.find((one) => (one.commanded as { which?: string } | undefined)?.which === 'clear'), 5000)
check('Clear is typed at the prompt on a press', Boolean(cleared && (cleared.commanded as { ok: boolean }).ok), JSON.stringify(cleared))
await sleep(2000)
await resumed.type('after the clear')
const next = await until(() => resumed.said.find((one) => one.exists === true && typeof one.session === 'string' && one.session !== session)?.session as string | undefined, 15000)
check('the new conversation Codex starts after /clear is followed, and filed at the place', Boolean(next) && (places().places[`epic=methods;parts=-;kehikko=key:${wide.key}`]?.sessions ?? []).includes(next), String(next))

const log = readFileSync(moduleLog, 'utf8')
say(`--- module log, the lines about this session\n${log.split('\n').filter((l) => l.includes('codex:') && !l.includes('refused')).slice(0, 40).join('\n')}\n---`)

const failed = results.filter((one) => !one.ok)
say(`\n${results.length - failed.length}/${results.length} checks passed`)
for (const one of children) try { process.kill(one.pid, 'SIGTERM') } catch {}
stopHost()
process.exit(failed.length ? 1 : 0)
