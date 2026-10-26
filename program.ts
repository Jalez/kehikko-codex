import { execFile, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

/**
 * The program this module opens, and everything that is specific to it.
 *
 * ## This is the only file that knows it is Codex
 *
 * The rest of the module is a terminal that holds one session per place: a pty, a record of
 * which session belongs where, a list to choose from. Everything that knows the program is the
 * Codex CLI is here, as one value of one interface — `Program`, the same interface the Claude
 * module answers for Claude Code.
 *
 * What a program has to answer, and it is the whole list:
 *
 *  1. **Where is the binary?** (`find`) The desktop app starts modules with a thin PATH.
 *  2. **Can this copy do what is asked of it?** (`supports`)
 *  3. **How is a new session started, and how is one resumed?** (`fresh`, `resume`) As argv.
 *  4. **Does a session exist yet, and under which id?** (`settled`) Codex chooses a new
 *     session's id itself and writes nothing for it until the person first says something; the
 *     session's own hooks then name it (`learnSession`).
 *  5. **Which sessions does it hold for a folder?** (`sessions`)
 *  6. **How is it installed?** (`install`)
 *  7. **Can it say what it is doing?** (`hookArgs`, `signal`) Codex's own lifecycle hooks.
 *  8. **Is a session already open in another process?** (`active`) Codex holds a lock file per
 *     conversation while a process writes it; who holds it is asked of `lsof`.
 *
 * ## What is never here
 *
 * A prompt of anybody's but the person's: the person types. The one sentence this module ever
 * sends is its own, fixed, to a conversation a restart cut off mid-turn, when the person opens it
 * again, behind a setting they can turn off (`RESUME_LINE` in live.ts). And no flag that widens
 * what the program may do: nothing about the sandbox, approvals, the model or features. A session
 * opened here has exactly the permissions `codex` would have in any terminal in that folder.
 *
 * ## Every command line this module ever runs, and it is the whole list
 *
 *     codex --help                                     once per binary: which flags and commands it has
 *     codex features list                              once per binary: whether its hooks are on
 *     codex [-c <hook>…] [-c <door>…]                  a new session
 *     codex resume <uuid> [<line>] [-c <hook>…] [-c <door>…]   a session nothing else holds
 *     lsof -F pn <lock files>                          which process holds which conversation: reads
 *
 * `-c` is Codex's own per-run override of its configuration (`config.toml` is never written):
 * `hooks.<Event>` are this module's hooks, `hooks.state` the trust of exactly those hooks, and
 * `mcp_servers.<name>` the Kehikot doors of the place. Measured on 0.164.0 with a scratch
 * `CODEX_HOME` and a stand-in for the model API.
 */

export interface Found {
  /** The binary, absolute, or null when no candidate is an executable file. */
  file: string | null
  /** Every directory looked in, in the order it was looked in. */
  looked: string[]
  /** The ones among them that are not from PATH: the usual places an install lands. */
  usual: string[]
}

export interface Able {
  ok: boolean
  /** What this copy lacks, for the sentence on screen. Null when ok, or when nothing could be told. */
  missing: string | null
  /** Whether this copy runs hooks given for one process (`-c hooks.*`, trusted per run): how a session says what it is doing. */
  tells: boolean
  /** Whether this copy can be asked which process holds a conversation (its lock files). */
  lists: boolean
  /** Whether this copy takes a display name for a session. Codex does not, at start. */
  names?: boolean
  /** Whether this copy takes MCP servers for one process (`-c mcp_servers.*`): how a session is given its place. */
  configures?: boolean
  /** Whether a session can be given this module's skills: they are announced through its hooks, so with `tells`. */
  plugins?: boolean
  /** Whether this copy runs a session in the background that outlives this process. Codex does not with per-run configuration (see `fresh`). */
  backgrounds?: boolean
}

/** A session started or woken in the background, or why not. Codex never is: the type stays for the interface. */
export type Backgrounded = { ok: true; handle: string; active: Active } | { ok: false; why: string }

/**
 * One conversation a process holds now, as its lock file says.
 *
 * Codex 0.164.0 keeps `$CODEX_HOME/thread-writer-locks/<session id>.lock` open in the process that
 * writes the conversation (measured: one lock file per running conversation, held by the `codex`
 * process; a second `codex resume <id>` shows "This conversation is open in another app" and
 * offers to retry or fork). Who holds it is asked of `lsof`.
 */
export interface Active {
  session: string
  /** Always `interactive` for Codex: nothing it runs can be attached to. */
  kind: 'background' | 'interactive' | 'other'
  called: string
  /** What `attach` would take. Null: Codex has no attach. */
  handle: string | null
  pid: number | null
  cwd: string
  startedAt: number | null
  name: string
  state?: State | null
  status?: ActiveStatus | null
}

export type ActiveStatus = 'idle' | 'busy' | 'waiting' | 'shell'

export type Running = { known: true; active: Active[] } | { known: false; why: 'too-old' | 'failed' }

/** What a session is doing, as far as its program says. */
export type State = 'working' | 'needs-you' | 'finished'
export const STATES: readonly State[] = ['working', 'needs-you', 'finished']

/** One session as the program's own records describe it. */
export interface Recorded {
  id: string
  /** What the session is called: its first prompt, one line, cut short. `''` when nothing readable was found. */
  label: string
  firstPrompt?: string
  lastPrompt?: string
  prs?: { number: number; url: string }[]
  /** The sessions this conversation was carried on in. Codex resumes a conversation under its own id, so none. */
  next?: string[]
  /** When the record last grew, in milliseconds. */
  lastActive: number
}

export interface Install {
  line: string
  lands: string
  source: string
  checked: string
}

/** One group of hook handlers for one Codex event: every command runs, in order. */
export interface HookGroup {
  event: HookEvent
  /** A regex Codex matches against the tool name (or `source` for SessionStart). Absent: every one. */
  matcher?: string
  commands: { command: string; timeout: number }[]
}

export interface Program {
  name: string
  binary: string
  find(env?: NodeJS.ProcessEnv): Found
  supports(file: string): Promise<Able>
  newId(): string
  isId(id: string): boolean
  fresh(id: string, name?: string): string[]
  resume(id: string, name?: string, line?: string): string[]
  settled(projectPath: string, id: string, since: number): Promise<string | null>
  sessions(projectPath: string, also?: readonly string[]): Promise<Recorded[]>
  install(env?: NodeJS.ProcessEnv): Install
  /** The environment the installer runs in: the one given, with the places `npm` and `brew` live added to PATH. */
  installEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** What to tell the person when the installer ended without a binary: plain words and the next step. */
  explain(output: string, exitCode: number, ran: string, env?: NodeJS.ProcessEnv): string
  environment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  /** The `-c` arguments that give one process these hooks, and trust exactly them. */
  hookArgs(groups: readonly HookGroup[]): string[]
  signal(event: string): State | null
  active(file: string, env?: NodeJS.ProcessEnv): Promise<Running>
}

/* ------------------------------------------------------------------------ *
 * Codex
 * ------------------------------------------------------------------------ */

const BINARY = 'codex'

/** The home folder as the environment names it, which is what the program itself goes by. */
export function home(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || homedir()
}

/**
 * Where Codex keeps what it knows: `~/.codex`, or wherever `CODEX_HOME` says — the variable the
 * program itself honours, which is also how a test points this at a scratch folder. Read, never
 * written: the conversations (`sessions/`), their lock files, and nothing else.
 */
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME || join(home(env), '.codex')
}

/**
 * The places an install usually lands that a thin PATH leaves out: npm's and Homebrew's global
 * bins, Bun's, and the CLI the Codex desktop app carries inside itself.
 */
function usualDirs(env: NodeJS.ProcessEnv): string[] {
  const at = home(env)
  return [
    join(at, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(at, '.npm-global', 'bin'),
    join(at, '.bun', 'bin'),
    '/Applications/Codex.app/Contents/Resources',
    join(at, 'Applications', 'Codex.app', 'Contents', 'Resources'),
  ]
}

/** PATH with the usual places added after it, so `npm` and `brew` are found under the desktop app's thin one. */
function installPath(env: NodeJS.ProcessEnv): string {
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...toolDirs(env), '/usr/bin', '/bin']
  return [...new Set(dirs)].join(delimiter)
}

/**
 * Where `brew` and `npm` usually are: Homebrew's two prefixes. `KEHIKOT_CODEX_TOOL_DIRS` (a
 * PATH-style list, empty for none) replaces them, which is how a test keeps this machine's real
 * Homebrew and npm out of what it checks.
 */
function toolDirs(env: NodeJS.ProcessEnv): string[] {
  const said = env.KEHIKOT_CODEX_TOOL_DIRS
  return said === undefined ? ['/opt/homebrew/bin', '/usr/local/bin'] : said.split(delimiter).filter(Boolean)
}

function runnable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The Rust binary an npm install of `@openai/codex` carries for this machine (the triples of `codex.js`). */
const TRIPLES: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
}

/**
 * The native binary behind an npm launcher, when `file` is one.
 *
 * npm installs `codex` as a link to `@openai/codex/bin/codex.js`, a Node script (`#!/usr/bin/env
 * node`) that only finds and runs the Rust binary in `@openai/codex-<platform>`. Under the
 * desktop app's thin PATH there may be no `node` to run it with, so the binary is run directly:
 * the same program, without the hop. Anything else is returned as it was.
 */
export function nativeOf(file: string): string {
  let real = file
  try {
    real = realpathSync(file)
  } catch {
    return file
  }
  if (!real.endsWith(join('@openai', 'codex', 'bin', 'codex.js'))) return file
  const key = `${process.platform}-${process.arch}`
  const triple = TRIPLES[key]
  if (!triple) return file
  const pkg = dirname(dirname(real))
  for (const base of [join(pkg, 'node_modules'), dirname(dirname(pkg))]) {
    const candidate = join(base, '@openai', `codex-${key}`, 'vendor', triple, 'bin', BINARY)
    if (runnable(candidate)) return candidate
  }
  return file
}

/** npm's global prefix as `npm prefix -g` says it, asked at most every few seconds; null when npm cannot say. */
const prefixes = new Map<string, { at: number; prefix: string | null }>()
const PREFIX_FOR = 5_000

export function npmPrefix(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = `${home(env)}\0${env.PATH ?? ''}`
  const known = prefixes.get(key)
  if (known && Date.now() - known.at < PREFIX_FOR) return known.prefix
  let prefix: string | null = null
  try {
    const said = execFileSync('npm', ['prefix', '-g'], {
      env: { ...env, PATH: installPath(env) },
      timeout: 3000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    prefix = said.startsWith('/') ? said : null
  } catch {
    prefix = null
  }
  prefixes.set(key, { at: Date.now(), prefix })
  return prefix
}

function find(env: NodeJS.ProcessEnv = process.env): Found {
  const looked: string[] = []
  const usual = usualDirs(env)
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...usual]
  for (const dir of dirs) {
    if (looked.includes(dir)) continue
    looked.push(dir)
    const file = join(dir, BINARY)
    if (runnable(file)) return { file: nativeOf(file), looked, usual }
  }
  /* Last, because it costs a process: where npm itself puts a global install, which is not
     always a folder anyone listed (a prefix the person set, or a version manager's). */
  const prefix = npmPrefix(env)
  if (prefix) {
    const dir = join(prefix, 'bin')
    if (!looked.includes(dir)) {
      looked.push(dir)
      usual.push(dir)
      const file = join(dir, BINARY)
      if (runnable(file)) return { file: nativeOf(file), looked, usual }
    }
  }
  return { file: null, looked, usual }
}

/**
 * The command a resumed session needs, and the option every per-run setting rides on. Checked
 * against 0.164.0's `codex --help`, not written from memory:
 *
 *     resume   Resume a previous interactive session (picker by default; use --last to continue the most recent)
 *     -c, --config <key=value>   Override a configuration value that would otherwise be loaded from `~/.codex/config.toml`. …
 */
const NEEDS: readonly { said: string; test: RegExp }[] = [
  { said: 'resume', test: /^\s*resume\b/m },
  { said: '--config', test: /--config\b/ },
]

/**
 * Whether its hooks run: `codex features list` prints one line per feature, `hooks  stable  true`
 * on 0.164.0. A copy that cannot say, or says they are off, is started without them and its
 * sessions have no state.
 */
const HOOKS_ON = /^hooks\s+.*\btrue\s*$/m

/**
 * Hook trust as a per-run setting: Codex 0.164.0 runs a hook from a non-managed source only when
 * `hooks.state."<key>".trusted_hash` matches its hash, and reads that state from the session's own
 * `-c` layer as well as the person's `config.toml` (`hook_states_from_stack`). A copy whose help
 * does not mention hook trust predates that and is not given hooks.
 */
const TRUSTS = /hook[- ]trust/i

const able = new Map<string, Able>()

/**
 * What the program prints for a command that only answers, read through a real pipe, whole (the
 * Claude module found Claude Code's help cut short when read directly; a pipe costs nothing).
 * Standard input closed; `''` for anything that went wrong.
 */
function answered(file: string, args: readonly string[], env?: NodeJS.ProcessEnv, more: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((done) => {
    const child = execFile('/bin/sh', ['-c', '"$0" "$@" </dev/null | /bin/cat', file, ...args], { timeout: more.timeout ?? 8000, maxBuffer: 16 * 1024 * 1024, ...(env ? { env } : {}), ...(more.cwd ? { cwd: more.cwd } : {}) }, (error, stdout) =>
      done(error ? '' : String(stdout ?? '')),
    )
    child.on('error', () => done(''))
  })
}

/**
 * Whether this copy has what is used, asked once per binary per build. A copy whose help cannot be
 * read at all is NOT called too old: nothing was learned, and nothing extra is passed either.
 */
async function supports(file: string): Promise<Able> {
  let stamp = file
  try {
    stamp = `${file}@${statSync(file).mtimeMs}`
  } catch {
    /* Gone between being found and being asked. */
  }
  const known = able.get(stamp)
  if (known) return known
  const help = await answered(file, ['--help'], environment())
  let said: Able
  if (!help) said = { ok: true, missing: null, tells: false, lists: false, names: false, configures: false, plugins: false, backgrounds: false }
  else {
    const missing = NEEDS.find((one) => !one.test.test(help))?.said ?? null
    const configures = /--config\b/.test(help)
    const features = configures && TRUSTS.test(help) ? await answered(file, ['features', 'list'], environment()) : ''
    const tells = configures && HOOKS_ON.test(features)
    said = { ok: missing === null, missing, tells, lists: true, names: false, configures, plugins: tells, backgrounds: false }
  }
  able.set(stamp, said)
  return said
}

/* ------------------------------------------------------------------------ *
 * Its records: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl
 * ------------------------------------------------------------------------ */

/** A session id as Codex spells one: a UUID (version 7 on 0.164.0). */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ROLLOUT = /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/
const DATED = /^\d{2,4}$/

/** Where Codex files its conversations. */
export function sessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(codexHome(env), 'sessions')
}

/** Kept between lists: each folder's names, by the folder's own time. */
const listings = new Map<string, { mtimeMs: number; names: string[] }>()

async function listed(dir: string): Promise<string[]> {
  let mtimeMs = 0
  try {
    mtimeMs = (await stat(dir)).mtimeMs
  } catch {
    listings.delete(dir)
    return []
  }
  const kept = listings.get(dir)
  if (kept && kept.mtimeMs === mtimeMs) return kept.names
  const names = await readdir(dir).catch(() => [] as string[])
  listings.set(dir, { mtimeMs, names })
  return names
}

/** Every rollout file under the sessions folder, by session id: three levels of dated folders. */
export async function rollouts(env: NodeJS.ProcessEnv = process.env): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const root = sessionsRoot(env)
  for (const year of (await listed(root)).filter((one) => DATED.test(one))) {
    for (const month of (await listed(join(root, year))).filter((one) => DATED.test(one))) {
      for (const day of (await listed(join(root, year, month))).filter((one) => DATED.test(one))) {
        for (const name of await listed(join(root, year, month, day))) {
          const id = ROLLOUT.exec(name)?.[1]
          if (id) out.set(id, join(root, year, month, day, name))
        }
      }
    }
  }
  return out
}

/** Where Codex keeps the record of session `id`, or null when this computer has none. */
export async function recordFile(_projectPath: string, id: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!SESSION_ID.test(id)) return null
  const file = (await rollouts(env)).get(id) ?? null
  if (!file) return null
  try {
    return (await stat(file)).isFile() ? file : null
  } catch {
    return null
  }
}

/** Enough of the head of a record to hold its meta line (≈22 KB on 0.164.0, the instructions in it) and the first prompt. */
const HEAD_BYTES = 512 * 1024
const TAIL_BYTES = 512 * 1024
export const LABEL_CHARS = 80
const TITLE_CHARS = 120

const line = (text: unknown, most: number): string => {
  const first = typeof text === 'string' ? (text.split('\n').map((one) => one.trim()).find(Boolean) ?? '') : ''
  return first.length > most ? `${first.slice(0, most - 1).trimEnd()}…` : first
}

/** What the meta row (the first of a record) says: the folder, and whether it is a person's interactive conversation. */
export interface Meta {
  id: string
  cwd: string
  /** `cli` for the terminal UI, `exec` for `codex exec`, or what else Codex wrote. */
  source: string
  /** A subagent's thread is not a conversation of the person's. */
  person: boolean
}

export function metaOf(head: string): Meta | null {
  const end = head.indexOf('\n')
  const first = end >= 0 ? head.slice(0, end) : head
  let row: { type?: unknown; payload?: Record<string, unknown> }
  try {
    row = JSON.parse(first)
  } catch {
    return null
  }
  if (row.type !== 'session_meta' || !row.payload) return null
  const p = row.payload
  const id = typeof p.id === 'string' ? p.id : typeof p.session_id === 'string' ? p.session_id : ''
  if (!SESSION_ID.test(id) || typeof p.cwd !== 'string') return null
  const source = typeof p.source === 'string' ? p.source : typeof p.source === 'object' && p.source !== null ? 'subagent' : ''
  const person = source !== 'subagent' && (p.thread_source === undefined || p.thread_source === 'user')
  return { id, cwd: p.cwd, source, person }
}

/**
 * The things a person said in a record, as Codex itself noted them: `event_msg` rows of kind
 * `item_completed` whose item is a `UserMessage` (measured on 0.164.0: its text is exactly what
 * was typed; the environment and the instructions Codex adds are other rows). Of the head, the
 * first; of the tail, the last. This is the ONLY content of a transcript read for a label.
 */
export function promptsOf(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    if (!raw.includes('"UserMessage"')) continue
    let row: { type?: unknown; payload?: { type?: unknown; item?: { type?: unknown; content?: unknown } } }
    try {
      row = JSON.parse(raw.trim())
    } catch {
      continue
    }
    if (row.type !== 'event_msg' || row.payload?.type !== 'item_completed' || row.payload.item?.type !== 'UserMessage') continue
    const content = row.payload.item.content
    const said = Array.isArray(content) ? content.map((part: unknown) => (typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' ? String((part as { text?: unknown }).text ?? '') : '')).join('\n') : ''
    if (said.trim()) out.push(said)
  }
  return out
}

/** The first line of the first thing a person said. */
export function firstPrompt(head: string): string {
  const first = promptsOf(head)[0]
  return first ? line(first, LABEL_CHARS) : ''
}

const described = new Map<string, { stamp: string; meta: Meta | null; first: string; last: string }>()

async function describe(file: string): Promise<{ meta: Meta | null; first: string; last: string; lastActive: number } | null> {
  let info: { size: number; mtimeMs: number }
  try {
    info = await stat(file)
  } catch {
    return null
  }
  const stamp = `${info.size}@${info.mtimeMs}`
  const known = described.get(file)
  if (known?.stamp === stamp) return { ...known, lastActive: info.mtimeMs }
  let head = ''
  let tail = ''
  try {
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(HEAD_BYTES, info.size))
      const got = await handle.read(buffer, 0, buffer.length, 0)
      head = buffer.subarray(0, got.bytesRead).toString('utf8')
      const from = Math.max(0, info.size - TAIL_BYTES)
      const end = Buffer.alloc(info.size - from)
      const read = await handle.read(end, 0, end.length, from)
      tail = end.subarray(0, read.bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
  const meta = known?.meta ?? metaOf(head)
  const first = known?.first || firstPrompt(head)
  const lastSaid = promptsOf(tail).at(-1)
  const said = { stamp, meta, first, last: lastSaid ? line(lastSaid, TITLE_CHARS) : (known?.last ?? '') }
  described.set(file, said)
  while (described.size > 2048) described.delete(described.keys().next().value!)
  return { ...said, lastActive: info.mtimeMs }
}

/** A folder as the program would name it: Codex writes the path it finds itself in (`/tmp` is `/private/tmp`). */
function spellings(path: string): Set<string> {
  const out = new Set([path])
  try {
    out.add(realpathSync(path))
  } catch {
    /* Not there. */
  }
  return out
}

async function sessions(projectPath: string, also: readonly string[] = []): Promise<Recorded[]> {
  const folders = spellings(projectPath)
  const wanted = new Set(also.filter((id) => SESSION_ID.test(id)))
  const found: Recorded[] = []
  for (const [id, file] of await rollouts()) {
    const said = await describe(file)
    if (!said?.meta) continue
    const here = folders.has(said.meta.cwd) || [...spellings(said.meta.cwd)].some((one) => folders.has(one))
    /* A project's own record names it, whatever folder it ran in (a project whose folder was renamed). */
    if (!wanted.has(id) && (!here || !said.meta.person || said.meta.source === 'exec')) continue
    found.push({ id, label: said.first, firstPrompt: said.first, lastPrompt: said.last, prs: [], next: [], lastActive: said.lastActive })
  }
  return found.sort((a, b) => b.lastActive - a.lastActive)
}

/** What a recorded session ran in, from its meta row: what `$kehikot-here` takes as its folder. */
export async function folderOfRecord(id: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const file = await recordFile('', id, env)
  if (!file) return null
  return (await describe(file))?.meta?.cwd ?? null
}

/** Where a conversation is now, from an id it was once under. Codex keeps one id per conversation, so it is that id. */
export function headOf(id: string, _held?: ReadonlyMap<string, Recorded>, _live?: ReadonlySet<string>): string {
  return id
}

/** A place's name: one line, no control characters, never starting with a dash, short. */
export function sessionName(words: readonly (string | null | undefined)[]): string {
  const said = words.map((one) => (one ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ')
  return said.replace(/^-+\s*/, '').slice(0, 120)
}

/* ------------------------------------------------------------------------ *
 * A new session's id, which Codex chooses
 * ------------------------------------------------------------------------ */

/**
 * The id Codex gave each new session this module started, by the id this module opened it under.
 *
 * Codex takes no session id on its command line and writes nothing for a new session until the
 * person first says something (measured on 0.164.0: no rollout, no lock, until the first prompt).
 * Its hooks then name it — every hook is handed `session_id` — and `tell.sh` passes it here
 * (`learnSession`) beside the run's own id, which only this module and the session's environment
 * know. A `/clear` is a new session id in the same process, said the same way.
 */
const LEARNED = new Map<string, string>()

export function learnSession(opened: string, session: string): void {
  if (!SESSION_ID.test(opened) || !SESSION_ID.test(session)) return
  LEARNED.delete(opened)
  LEARNED.set(opened, session)
  while (LEARNED.size > 1024) LEARNED.delete(LEARNED.keys().next().value!)
}

async function settled(projectPath: string, id: string): Promise<string | null> {
  const real = LEARNED.get(id) ?? id
  return (await recordFile(projectPath, real)) ? real : null
}

/* ------------------------------------------------------------------------ *
 * How it is installed
 * ------------------------------------------------------------------------ */

/**
 * How the Codex CLI is installed, from the vendor's own page.
 *
 *   Source: https://developers.openai.com/codex/cli — "npm i -g @openai/codex" (or
 *   `brew install --cask codex`). Read 2026-10-26.
 *
 * Never `npm install -g` as it is on that page: with Node from the official installer npm's global
 * prefix is `/usr/local`, owned by root, and the install fails with EACCES. Nothing here asks for
 * admin rights, uses `sudo` or changes npm's configuration (`installFor`).
 *
 * It is DATA. Nothing in this file runs it: `live.ts` does, in a pty the person is looking at, and
 * only after a press in the page. Signing in is Codex's own first screen afterwards.
 */
const SOURCE = 'https://developers.openai.com/codex/cli'
const CHECKED = '2026-10-26'

/** Whether Homebrew is here: `brew` on PATH, or in either of Homebrew's usual prefixes. */
export function hasBrew(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) if (runnable(join(dir, 'brew'))) return true
  return toolDirs(env).some((dir) => runnable(join(dir, 'brew')))
}

/** Homebrew's own cask, which needs no admin rights. */
const BREW_LINE = 'brew install --cask codex'
/** npm into the home folder, where Claude Code already lives: needs no admin rights and changes no npm setting. */
const HOME_LINE = 'npm install -g --prefix ~/.local @openai/codex'

/**
 * The install command, the first that applies, none of which asks for admin rights:
 * Homebrew's cask when Homebrew is here, otherwise npm with a prefix in the home folder.
 * Never `sudo`, and never npm's own configuration.
 */
export function installFor(env: NodeJS.ProcessEnv = process.env): Install {
  return hasBrew(env)
    ? { line: BREW_LINE, lands: 'Homebrew’s bin folder', source: SOURCE, checked: CHECKED }
    : { line: HOME_LINE, lands: '~/.local/bin', source: SOURCE, checked: CHECKED }
}

/** The install command, or the stand-in a test names (`KEHIKOT_CODEX_INSTALL_LINE`, from the environment of whoever started this server). */
function install(env: NodeJS.ProcessEnv = process.env): Install {
  const said = env.KEHIKOT_CODEX_INSTALL_LINE
  const chosen = installFor(env)
  return said ? { ...chosen, line: said } : chosen
}

function installEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, PATH: installPath(env) }
}

/* eslint-disable-next-line no-control-regex */
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

/** Terminal output as plain text. */
export function plain(output: string): string {
  return output.replace(ESCAPES, '').replace(/\r/g, '')
}

/** Whether npm failed for lack of permission to write where it was asked to. */
export function deniedWrite(output: string): boolean {
  return /\bEACCES\b|permission denied/i.test(plain(output))
}

/** The folder npm said it could not write to (`/usr/local` out of `/usr/local/lib/node_modules/@openai`), when it said. */
function deniedFolder(output: string): string | null {
  const said = plain(output).match(/'(\/[^'\n]*?)\/lib\/node_modules\b[^'\n]*'/) ?? plain(output).match(/'(\/[^'\n]+)'/)
  return said ? said[1]! : null
}

/**
 * What the person is told when the installer ended and no binary was found: plain words and the
 * next step, never npm's stack. The whole output stays in the terminal ("See the log").
 */
function explain(output: string, exitCode: number, ran: string, env: NodeJS.ProcessEnv = process.env): string {
  const text = plain(output)
  if (exitCode === 0) return 'The installer finished, but Codex was not found afterwards. See the log.'
  if (deniedWrite(text)) {
    const instead = installFor(env).line
    const where = deniedFolder(text)
    if (instead === ran) return `The installer can't write${where ? ` to ${where}` : ' where it was asked to'}. Check that the folder is yours, or install Codex another way: ${SOURCE}`
    return `npm can't write to ${where ?? 'its global folder'} without admin rights. Install into your home folder instead: ${instead}`
  }
  if (exitCode === 127 || /(npm|brew): (command )?not found/i.test(text)) {
    return ran.startsWith('brew') ? 'Homebrew was not found. Install Codex with npm or from the Codex app instead.' : `npm was not found. Install Node.js or Homebrew (https://brew.sh), then try again. Or run ${installFor(env).line} once one is there.`
  }
  return `The installer exited with ${exitCode}. See the log, or run ${ran} in a terminal.`
}

/**
 * The variables a Codex process exports to the commands it runs. A module started from inside one
 * would hand them on, and the session opened here would believe it was sandboxed, or a tool call
 * of another conversation.
 */
const NESTED = [
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CODEX_TOOL_CALL_ID',
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'CODEX_NETWORK_PROXY_ACTIVE',
  'CODEX_NON_INTERACTIVE',
  'CODEX_STARTING_DIFF',
]

function environment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env }
  for (const name of NESTED) delete out[name]
  return out
}

/* ------------------------------------------------------------------------ *
 * Its hooks: what it says it is doing
 * ------------------------------------------------------------------------ */

/**
 * The Codex events this module hears, and their names in a hook's trust key. Measured on 0.164.0
 * against a stand-in for the model:
 *
 *     the person sends a prompt               SessionStart (first prompt of a conversation), UserPromptSubmit
 *     a tool is about to run                  PreToolUse
 *     an approval question is on screen       PermissionRequest   (at once)
 *     the tool has run                        PostToolUse
 *     the turn is over                        Stop
 *     Esc interrupted the turn                Interrupt           (no Stop)
 *     /compact                                PreCompact, PostCompact, then SessionStart (source compact) at the next prompt
 *     /clear                                  SessionStart (source clear, a NEW session_id) at the next prompt
 */
export type HookEvent = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PermissionRequest' | 'PostToolUse' | 'Stop' | 'Interrupt' | 'PreCompact' | 'PostCompact'

export const HOOK_KEYS: Record<HookEvent, string> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_prompt_submit',
  PreToolUse: 'pre_tool_use',
  PermissionRequest: 'permission_request',
  PostToolUse: 'post_tool_use',
  Stop: 'stop',
  Interrupt: 'interrupt',
  PreCompact: 'pre_compact',
  PostCompact: 'post_compact',
}

/**
 * What each report means. `AskUser` is this module's own name for `PreToolUse` of Codex's
 * question tool (`request_user_input`), which puts a question on screen and waits. A question
 * asked in prose is a turn that ended, `finished` like any other. An interrupt is a turn that is
 * over: the session is back at its prompt. Nothing is reported when a question is answered; a
 * person typing into a session that was waiting for them is that answer (live.ts).
 */
const SIGNALS: Record<string, State> = {
  UserPromptSubmit: 'working',
  PostToolUse: 'working',
  PermissionRequest: 'needs-you',
  AskUser: 'needs-you',
  Stop: 'finished',
  Interrupt: 'finished',
}

/** The events `tell.sh` is run at, each under its event, and the word it says. */
export const TELLS: readonly { event: HookEvent; matcher?: string; says: string }[] = [
  { event: 'SessionStart', says: 'SessionStart' },
  { event: 'UserPromptSubmit', says: 'UserPromptSubmit' },
  { event: 'PostToolUse', says: 'PostToolUse' },
  { event: 'PermissionRequest', says: 'PermissionRequest' },
  { event: 'PreToolUse', matcher: '^request_user_input', says: 'AskUser' },
  { event: 'Stop', says: 'Stop' },
  { event: 'Interrupt', says: 'Interrupt' },
]

/** A TOML string: JSON's spelling is TOML's basic string for everything this module writes. */
const tomlString = (text: string): string => JSON.stringify(text)

/** JSON with every object's keys sorted, as serde_json writes a value it has sorted (`version_for_toml`). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, one]) => one !== undefined)
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, one]) => `${JSON.stringify(key)}:${canonical(one)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * The hash Codex 0.164.0 trusts one hook handler by (`hook_hash` in codex-rs/hooks): the sha256 of
 * the sorted JSON of `{ event_name, matcher?, hooks: [handler] }`, the handler as Codex normalises
 * it — `type`, `command`, its `timeout` in seconds and `async: false`. Measured: the hash Codex
 * itself wrote when a hook was trusted in its `/hooks` screen is this one.
 */
export function hookHash(event: HookEvent, matcher: string | undefined, command: string, timeout: number): string {
  const identity = { event_name: HOOK_KEYS[event], ...(matcher !== undefined ? { matcher } : {}), hooks: [{ type: 'command', command, timeout, async: false }] }
  return `sha256:${createHash('sha256').update(canonical(identity)).digest('hex')}`
}

/**
 * The `-c` arguments that give one Codex process these hooks, and trust exactly these.
 *
 *  - `hooks.<Event>=[…]` is Codex's own inline hook table, in the session-flags layer: it adds to
 *    the person's hooks and replaces none (Codex runs every source's hooks).
 *  - `hooks.state={ "/<session-flags>/config.toml:<event>:<group>:<handler>" = { trusted_hash } }`
 *    trusts each of them by its hash, for this process only. Without it Codex asks the person to
 *    review "N hooks" before the session starts. Nothing is written to `config.toml`, and the
 *    person's own untrusted hooks stay untrusted: `--dangerously-bypass-hook-trust`, which would
 *    run those too, is never passed. (A dotted `-c hooks.state."…".trusted_hash=` does not work:
 *    the key holds dots, so the whole table is given as one inline value.)
 *
 * Interrupt hooks may take at most three seconds (Codex caps them).
 */
function hookArgs(groups: readonly HookGroup[]): string[] {
  const byEvent = new Map<HookEvent, HookGroup[]>()
  for (const group of groups) {
    if (!group.commands.length) continue
    byEvent.set(group.event, [...(byEvent.get(group.event) ?? []), group])
  }
  const args: string[] = []
  const state: string[] = []
  for (const [event, list] of byEvent) {
    const tables = list.map((group, at) => {
      const handlers = group.commands.map((one, index) => {
        const timeout = event === 'Interrupt' ? Math.min(3, Math.max(1, one.timeout)) : Math.max(1, one.timeout)
        state.push(`${tomlString(`/<session-flags>/config.toml:${HOOK_KEYS[event]}:${at}:${index}`)}={trusted_hash=${tomlString(hookHash(event, group.matcher, one.command, timeout))}}`)
        return `{type="command",command=${tomlString(one.command)},timeout=${timeout}}`
      })
      return `{${group.matcher !== undefined ? `matcher=${tomlString(group.matcher)},` : ''}hooks=[${handlers.join(',')}]}`
    })
    args.push('-c', `hooks.${event}=[${tables.join(',')}]`)
  }
  if (state.length) args.push('-c', `hooks.state={${state.join(',')}}`)
  return args
}

/* ------------------------------------------------------------------------ *
 * Which process holds which conversation
 * ------------------------------------------------------------------------ */

const LOCK = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.lock$/

/** `lsof -F pn` output: the pid of each process and the files it has open, as `p<pid>` and `n<path>` lines. */
export function readLsof(text: string): Map<string, number> {
  const out = new Map<string, number>()
  let pid: number | null = null
  for (const raw of text.split('\n')) {
    if (raw.startsWith('p')) {
      const n = Number(raw.slice(1))
      pid = Number.isSafeInteger(n) && n > 1 ? n : null
    } else if (raw.startsWith('n') && pid !== null) {
      const id = LOCK.exec(raw.slice(1).split('/').pop() ?? '')?.[1]
      if (id && !out.has(id)) out.set(id, pid)
    }
  }
  return out
}

/** The lsof this machine has, by its full path, so that nothing a project puts on PATH is run in its place. */
const LSOF = ['/usr/sbin/lsof', '/usr/bin/lsof']

/**
 * Every conversation a Codex process holds now, in any folder: one per lock file some process has
 * open. `lsof` reads; nothing is started. A lock file nobody holds is left over from a process that
 * ended and is not a conversation running. A failure is `failed`, never an empty list.
 */
async function active(_file: string, env: NodeJS.ProcessEnv = process.env): Promise<Running> {
  const dir = join(codexHome(env), 'thread-writer-locks')
  let names: string[]
  try {
    names = (await readdir(dir)).filter((one) => LOCK.test(one))
  } catch (error) {
    return (error as { code?: string }).code === 'ENOENT' ? { known: true, active: [] } : { known: false, why: 'failed' }
  }
  if (names.length === 0) return { known: true, active: [] }
  const lsof = LSOF.find(runnable)
  if (!lsof) return { known: false, why: 'failed' }
  const text = await new Promise<string | null>((done) => {
    execFile(lsof, ['-w', '-F', 'pn', '--', ...names.slice(0, 256).map((one) => join(dir, one))], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      /* lsof exits 1 when some of the files are open by nobody: what it printed is still the answer. */
      if (!error) return done(String(stdout ?? ''))
      return done((error as { code?: unknown }).code === 1 ? String(stdout ?? '') : null)
    })
  })
  if (text === null) return { known: false, why: 'failed' }
  const out: Active[] = []
  for (const [session, pid] of readLsof(text)) {
    out.push({ session, kind: 'interactive', called: 'a Codex process', handle: null, pid, cwd: (await folderOfRecord(session, env)) ?? '', startedAt: null, name: '', state: null, status: null })
  }
  return { known: true, active: out }
}

/* ------------------------------------------------------------------------ *
 * The arguments
 * ------------------------------------------------------------------------ */

/**
 * A new session: no arguments of its own — Codex chooses the id. Everything per run (`-c`) is
 * added by whoever starts it.
 *
 * ## Why not in the background
 *
 * Codex 0.164.0 can run conversations on a shared local daemon (`codex app-server daemon`), but
 * any `-c` on the command line puts the session in "embedded mode" instead (measured: "Running
 * without the shared background server: command-line configuration overrides … requires embedded
 * mode"). A session's hooks and doors are per-run overrides, so a session started here is a child
 * of this module's process and ends with it; the next open of its place resumes it by id.
 */
const fresh = (): string[] => []

/** A recorded session, with a sentence of this module's own as its first prompt when there is one. */
const resume = (id: string, _name?: string, said?: string): string[] => {
  if (!SESSION_ID.test(id)) throw new Error('that is not a session id')
  return ['resume', id, ...(said && !said.startsWith('-') ? [said] : [])]
}

export const PROGRAM: Program = {
  name: 'Codex',
  binary: BINARY,
  find,
  supports,
  newId: () => randomUUID(),
  isId: (id) => SESSION_ID.test(id),
  fresh,
  resume,
  settled,
  sessions,
  install,
  installEnvironment,
  explain,
  environment,
  hookArgs,
  signal: (event) => (Object.hasOwn(SIGNALS, event) ? SIGNALS[event]! : null),
  active,
}
