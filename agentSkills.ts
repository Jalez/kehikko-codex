import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MODULE_ID, WELL_KNOWN, moduleSkillsSchema, skillPath } from 'kehikot-module-protocol'
import { readRegistration, registryDir } from 'kehikot-module-protocol/serve'

import { ID } from './manifest.ts'
import { home } from './program.ts'

/**
 * Kehikot's skills, installed where Codex reads them: `~/.agents/skills/<name>/`.
 *
 * ## Why there, and why this module
 *
 * Codex has no skills folder for one process (no `--plugin-dir`; `skills.config` only turns a
 * skill it already found on or off). It reads `$CODEX_HOME/skills` (deprecated, and `~/.codex` is
 * never written here), `~/.agents/skills`, the repository's `.agents/skills`, `/etc/codex/skills`
 * and plugins. `~/.agents/skills` is the user-wide folder that is not Codex's own configuration, so
 * a skill put there is in Codex's `$` menu and can be invoked. This module puts them there itself
 * (protocol 2.23.0, `declares.agentSessions.installsSkills`): it has the translation from Claude
 * Code's skill syntax (`forCodex` in skills.ts), and the host routes the kehikko's skills to it.
 *
 * ## Whose a folder is
 *
 * The same rules as the host's install into `~/.claude/skills`:
 *
 * - **Only a folder carrying this module's marker** (`MARKER`, `by: 'kehikot.codex'`) is ever
 *   written or removed. Anything else under a name — a skill the person made, one another program
 *   put there, one with a host's marker — is the person's: a skill of Kehikot's by that name is not
 *   installed, and the session is told why (`taken`).
 * - **A folder the person changed** (a file's text is not what was written, or a file was added)
 *   is never overwritten or removed (`edited`).
 * - **Versioned by content**: the marker records the sha256 of every file written, and the version
 *   is the first twelve hex digits over all of them. A different text replaces an untouched install.
 * - **Removed when no longer offered.** Each install says why it is there: the conversations that
 *   hold it (`holders`: a session's folder and this process's pid, alive while both are), and
 *   whether the host keeps it for every conversation (`everywhere`, from its Settings). One that
 *   neither holds is removed.
 *
 * An `everywhere` install can outlive its module between sessions — a session start is not when a
 * module is removed — so `resyncEverywhere` below re-syncs them against the modules as they are
 * now: at start and every so often, each such install is checked through its marker's module's
 * registration, refreshed from the origin the module answers at, and removed when the module is
 * gone or no longer offers the skill.
 *
 * ## Kehikko-bound skills
 *
 * A skill that needs other modules on its kehikko (protocol 2.12.0) is installed only while a
 * conversation whose kehikko meets those needs holds it, and removed when the last one ends. While
 * it is there, every other Codex conversation started here is given it switched OFF for that one
 * process (`-c skills.config=[{path=…, enabled=false}]`, `disabledArgs`): the leak that is left is a
 * Codex conversation started outside Kehikot in that window, and the skill's own text checks its
 * place first (`guarded` in skills.ts).
 *
 * Every function here is synchronous, so that two sessions starting in one process never interleave.
 */

/** The file beside SKILL.md that says this module installed the folder. */
export const MARKER = '.kehikot-skill.json'
const SKILL_FILE = 'SKILL.md'
const YAML_FILE = join('agents', 'openai.yaml')

/** Where Codex reads a person's own skills, user-wide, and where this module installs: `~/.agents/skills`. */
export function agentsSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(home(env), '.agents', 'skills')
}

/** One conversation holding an install: its folder and the process that started it. */
export interface Holder {
  dir: string
  pid: number
}

/** What the marker records. */
export interface AgentMarker {
  /** Who installed it: always this module. */
  by: typeof ID
  /** The module that offers the skill (the host's own id for the host's). */
  module: string
  name: string
  /** The first twelve hex digits of the sha256 over every file written. */
  version: string
  /** Each file written, by its path in the folder, and the sha256 of its text. */
  files: Record<string, string>
  /** Kept for every conversation, because the host's Settings say so. */
  everywhere: boolean
  /** The conversations that hold it now. */
  holders: Holder[]
  /** Kehikko-bound: only where its needs are met. */
  bound: boolean
  at: string
}

/** One skill to install, as Codex is given it. */
export interface Wanted {
  name: string
  /** The module that offers it. */
  module: string
  /** The SKILL.md, in Codex's format. */
  text: string
  /** `agents/openai.yaml`, or null for none. */
  yaml: string | null
  bound: boolean
  /** The host keeps it for every conversation. */
  everywhere: boolean
}

/** What is under one name, read for this module. */
export type Local =
  | { kind: 'absent' }
  | { kind: 'taken' }
  | { kind: 'edited'; marker: AgentMarker }
  | { kind: 'ours'; marker: AgentMarker }

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** The files a skill is, by their path in its folder. */
export function filesOf(skill: Pick<Wanted, 'text' | 'yaml'>): Record<string, string> {
  return { [SKILL_FILE]: skill.text, ...(skill.yaml === null ? {} : { [YAML_FILE]: skill.yaml }) }
}

/** The version of a skill's files: the first twelve hex digits of the sha256 over all of them, in order. */
export function versionOf(files: Record<string, string>): string {
  return sha256(Object.keys(files).sort().map((path) => `${path}\u0000${files[path]}\u0000`).join('')).slice(0, 12)
}

function readMarker(dir: string): AgentMarker | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as Partial<AgentMarker>
    if (raw.by !== ID || typeof raw.name !== 'string' || typeof raw.module !== 'string' || !raw.files || typeof raw.files !== 'object') return null
    const files: Record<string, string> = {}
    for (const [path, hash] of Object.entries(raw.files)) if (typeof hash === 'string') files[path] = hash
    const holders = Array.isArray(raw.holders)
      ? raw.holders.flatMap((one): Holder[] => (one && typeof one.dir === 'string' && Number.isInteger(one.pid) ? [{ dir: one.dir, pid: one.pid }] : []))
      : []
    return { by: ID, module: raw.module, name: raw.name, version: String(raw.version ?? ''), files, everywhere: raw.everywhere === true, holders, bound: raw.bound === true, at: String(raw.at ?? '') }
  } catch {
    return null
  }
}

/** Every file in a folder, by its path, the marker left out. */
function filesIn(dir: string, under = ''): string[] | null {
  try {
    return readdirSync(join(dir, under), { withFileTypes: true }).flatMap((entry) => {
      const path = under ? join(under, entry.name) : entry.name
      if (!under && entry.name === MARKER) return []
      if (entry.isDirectory()) return filesIn(dir, path) ?? [`${path}/`]
      return [path]
    })
  } catch {
    return null
  }
}

/** What is installed under `name` in `root`, as far as this module is concerned. */
export function readLocal(root: string, name: string): Local {
  const dir = join(root, name)
  if (!existsSync(dir)) return { kind: 'absent' }
  if (!statSync(dir).isDirectory()) return { kind: 'taken' }
  const marker = readMarker(dir)
  if (!marker || marker.name !== name) return { kind: 'taken' }
  const there = filesIn(dir)
  if (!there) return { kind: 'edited', marker }
  const written = Object.keys(marker.files)
  if (there.length !== written.length || there.some((path) => !Object.hasOwn(marker.files, path))) return { kind: 'edited', marker }
  for (const path of written) {
    let text: string
    try {
      text = readFileSync(join(dir, path), 'utf8')
    } catch {
      return { kind: 'edited', marker }
    }
    if (sha256(text) !== marker.files[path]) return { kind: 'edited', marker }
  }
  return { kind: 'ours', marker }
}

/** Whether a conversation still holds an install: its folder is there and the process that started it runs. */
export function alive(holder: Holder): boolean {
  if (!existsSync(holder.dir)) return false
  try {
    process.kill(holder.pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const stamp = () => new Date().toISOString()

function writeMarker(dir: string, marker: AgentMarker): void {
  const tmp = join(dir, `${MARKER}.${randomBytes(6).toString('hex')}`)
  writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o644 })
  renameSync(tmp, join(dir, MARKER))
}

/** A whole folder written beside `root/<name>` and renamed into place. */
function writeFolder(root: string, skill: Wanted, marker: AgentMarker): void {
  const tmp = join(root, `.${skill.name}.kehikot-${randomBytes(6).toString('hex')}`)
  try {
    mkdirSync(tmp, { recursive: true })
    for (const [path, text] of Object.entries(filesOf(skill))) {
      mkdirSync(join(tmp, path, '..'), { recursive: true })
      writeFileSync(join(tmp, path), text, { mode: 0o644 })
    }
    writeFileSync(join(tmp, MARKER), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o644 })
    const final = join(root, skill.name)
    if (existsSync(final)) {
      /* An untouched install of ours, replaced whole: moved aside, the new one in, the old one gone. */
      const old = join(root, `.${skill.name}.kehikot-old-${randomBytes(6).toString('hex')}`)
      renameSync(final, old)
      renameSync(tmp, final)
      rmSync(old, { recursive: true, force: true })
    } else renameSync(tmp, final)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Remove an untouched install of ours, and only that. */
function removeFolder(root: string, name: string): boolean {
  const local = readLocal(root, name)
  if (local.kind !== 'ours') return false
  rmSync(join(root, name), { recursive: true, force: true })
  return true
}

/** What `keep` did for one session, skill by skill. */
export interface Kept {
  /** Installed, updated or already there: what this session can call. */
  callable: string[]
  /** Not installed: a folder of that name is the person's. */
  taken: string[]
  /** Not changed: the person changed Kehikot's copy, which is what Codex reads. */
  edited: string[]
  /** One line per change, for the log. */
  said: string[]
}

export interface KeepOptions {
  /** Where to install: `~/.agents/skills` by default. */
  root?: string
  /** Other folders Codex reads a person's skills from: a name taken there is not installed here either. Read, never written. */
  personal?: readonly string[]
  /** The conversation that holds what is wanted, or null for none (only the `everywhere` list is kept). */
  holder: Holder | null
  /**
   * The names the host keeps for every conversation now (`everywhere`, protocol 2.23.0), or null
   * when it did not say (an older host, or none answering): then what is kept everywhere stays.
   */
  everywhere: ReadonlySet<string> | null
}

/**
 * Install, update and hold what one session is given, and let go of what is no longer offered. The
 * only writer of `root`. `wanted` is the session's whole list; what its holder held before and no
 * longer wants is released.
 */
export function keep(wanted: readonly Wanted[], options: KeepOptions): Kept {
  const root = options.root ?? agentsSkillsDir()
  const kept: Kept = { callable: [], taken: [], edited: [], said: [] }
  mkdirSync(root, { recursive: true })
  const names = new Set(wanted.map((one) => one.name))
  for (const skill of wanted) {
    if ((options.personal ?? []).some((dir) => existsSync(join(dir, skill.name)))) {
      kept.taken.push(skill.name)
      continue
    }
    const local = readLocal(root, skill.name)
    if (local.kind === 'taken') {
      kept.taken.push(skill.name)
      continue
    }
    if (local.kind === 'edited') {
      kept.edited.push(skill.name)
      continue
    }
    const files = filesOf(skill)
    const hashes = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, sha256(text)]))
    const version = versionOf(files)
    const was = local.kind === 'ours' ? local.marker : null
    const holders = [...(was?.holders ?? []).filter((one) => alive(one) && one.dir !== options.holder?.dir), ...(options.holder ? [options.holder] : [])]
    const everywhere = options.everywhere ? options.everywhere.has(skill.name) : (was?.everywhere ?? false) || skill.everywhere
    const marker: AgentMarker = { by: ID, module: skill.module, name: skill.name, version, files: hashes, everywhere, holders, bound: skill.bound, at: stamp() }
    try {
      if (!was || was.version !== version || JSON.stringify(was.files) !== JSON.stringify(hashes)) {
        writeFolder(root, skill, marker)
        kept.said.push(`${was ? 'updated' : 'installed'} ${skill.name} (${skill.module}, ${version}) in ${root}`)
      } else writeMarker(join(root, skill.name), { ...marker, at: was.at })
      kept.callable.push(skill.name)
    } catch (error) {
      kept.said.push(`could not install ${skill.name} in ${root}: ${(error as Error).message}`)
    }
  }
  /* What this holder no longer wants, and what the host no longer keeps everywhere. */
  kept.said.push(...sweep(root, { drop: options.holder, keepFor: names, everywhere: options.everywhere }))
  return kept
}

/**
 * Let go: every holder that is gone (and `drop`, when given, unless it still wants a name in
 * `keepFor`) is taken off, `everywhere` is brought in line with the host's list when it is known,
 * and an install that nothing holds any more is removed. Lines for the log.
 */
export function sweep(
  root: string = agentsSkillsDir(),
  options: { drop?: Holder | null; keepFor?: ReadonlySet<string>; everywhere?: ReadonlySet<string> | null } = {},
): string[] {
  const said: string[] = []
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() && !entry.name.startsWith('.') ? [entry.name] : []))
  } catch {
    return said
  }
  for (const name of names.sort()) {
    const local = readLocal(root, name)
    if (local.kind !== 'ours') continue
    const { marker } = local
    const holders = marker.holders.filter((one) => alive(one) && !(options.drop && one.dir === options.drop.dir && !options.keepFor?.has(name)))
    const everywhere = options.everywhere ? options.everywhere.has(name) : marker.everywhere
    if (!holders.length && !everywhere) {
      if (removeFolder(root, name)) said.push(`removed ${name} from ${root}: no conversation holds it, and Kehikot does not keep it for every conversation`)
      continue
    }
    if (holders.length !== marker.holders.length || everywhere !== marker.everywhere) {
      try {
        writeMarker(join(root, name), { ...marker, holders, everywhere })
      } catch {
        /* Tried again at the next sweep. */
      }
    }
  }
  /* A half-written folder of ours from a process that stopped mid-write. */
  try {
    for (const entry of readdirSync(root)) if (/^\..+\.kehikot-(?:old-)?[0-9a-f]{12}$/.test(entry)) rmSync(join(root, entry), { recursive: true, force: true })
  } catch {
    /* Nothing to tidy. */
  }
  return said
}

/** The SKILL.md of every install of ours in `root` that is not in `offered`: what a session is given switched off. */
export function othersInstalled(offered: ReadonlySet<string>, root: string = agentsSkillsDir()): string[] {
  let names: string[]
  try {
    names = readdirSync(root).filter((name) => !name.startsWith('.'))
  } catch {
    return []
  }
  return names.filter((name) => !offered.has(name) && readLocal(root, name).kind === 'ours').sort().map((name) => join(root, name, SKILL_FILE))
}

/**
 * The `-c` argument that switches these skills off for one Codex process (measured on 0.164.0:
 * `skills.config` from the session-flags layer is added to the person's own entries, and a path
 * that is not there yet is no error). Empty for none.
 */
export function disabledArgs(paths: readonly string[]): string[] {
  if (!paths.length) return []
  return ['-c', `skills.config=[${paths.map((path) => `{path=${JSON.stringify(path)},enabled=false}`).join(',')}]`]
}

/** An origin on this computer: where a registered module answers. */
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/

/** One GET with a timeout, for the re-sync below; null when the origin does not answer. */
async function getText(origin: string, path: string, fetchFn: typeof fetch, timeoutMs: number): Promise<{ status: number; body: string } | null> {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), timeoutMs)
  try {
    const response = await fetchFn(`${origin}${path}`, { signal: control.signal })
    return { status: response.status, body: await response.text() }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface ResyncOptions {
  /** Where the installs are: `~/.agents/skills` by default. */
  root?: string
  /** Where module registrations are read: `registryDir()` by default. */
  registry?: string
  /** Injected by tests. */
  fetchFn?: typeof fetch
  /** Per request, milliseconds. */
  timeoutMs?: number
}

/**
 * Re-sync what is kept for every conversation against the modules as they are now — run at start
 * and every so often, because a session start is not when a module is removed.
 *
 * Each untouched install of ours kept `everywhere` whose conversations have all ended is looked
 * at through its marker's module. No registration for the module on this computer: the install
 * is removed, the module is uninstalled. A registration: the module is asked at its registered
 * origin, and a manifest that no longer declares the skill has the install removed, while a skill
 * text that changed replaces the install whole. A module that does not answer is left exactly as
 * it is — one unanswered ask is not a removal, and the host's own list is what takes a skill off
 * at the next session start. A conversation still holding an install, and anything not this
 * module's or the person's own, is never touched. Lines for the log.
 */
export async function resyncEverywhere(options: ResyncOptions = {}): Promise<string[]> {
  const root = options.root ?? agentsSkillsDir()
  const where = options.registry ?? registryDir()
  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? 3000
  const said: string[] = []
  let names: string[] = []
  try {
    names = readdirSync(root, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() && !entry.name.startsWith('.') ? [entry.name] : []))
  } catch {
    return said
  }
  for (const name of names.sort()) {
    const local = readLocal(root, name)
    if (local.kind !== 'ours' || !local.marker.everywhere || local.marker.holders.some(alive)) continue
    const { module, bound } = local.marker
    const registration = MODULE_ID.test(module) ? readRegistration(join(where, `${module}.json`)) : null
    if (!registration || !LOOPBACK.test(registration.url)) {
      if (removeFolder(root, name)) said.push(`removed ${name} from ${root}: ${module} is not registered on this computer`)
      continue
    }
    const manifest = await getText(registration.url, WELL_KNOWN, fetchFn, timeoutMs)
    if (!manifest || manifest.status !== 200) continue
    let declared: unknown = null
    try {
      declared = (JSON.parse(manifest.body) as { declares?: { skills?: unknown } }).declares?.skills ?? null
    } catch {
      continue
    }
    const parsed = moduleSkillsSchema.safeParse(declared ?? [])
    if (!parsed.success || !parsed.data.some((one) => one.name === name)) {
      if (removeFolder(root, name)) said.push(`removed ${name} from ${root}: ${module} no longer offers it`)
      continue
    }
    const got = await getText(registration.url, skillPath(name), fetchFn, timeoutMs)
    if (!got || got.status !== 200) continue
    /* The files beside the SKILL.md are ours too: kept as they were written. */
    const yaml = Object.hasOwn(local.marker.files, YAML_FILE) ? readFileSync(join(root, name, YAML_FILE), 'utf8') : null
    const wanted: Wanted = { name, module, text: got.body, yaml, bound, everywhere: true }
    const files = filesOf(wanted)
    const version = versionOf(files)
    if (version !== local.marker.version) {
      const hashes = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, sha256(text)]))
      writeFolder(root, wanted, { ...local.marker, version, files: hashes, holders: [], at: stamp() })
      said.push(`updated ${name} (${module}, ${version}) in ${root}`)
    }
  }
  said.push(...sweep(root))
  return said
}
