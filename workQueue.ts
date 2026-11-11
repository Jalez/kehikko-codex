import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { WORK_KINDS, WORK_QUEUE, providerOf, serviceDescriptor, workRunLine, type ServiceProvider, type WorkQueue } from 'kehikot-module-protocol'
import { askHost } from 'kehikot-module-protocol/serve'

/**
 * The work queue on this computer, as the host names it (protocol 2.81.0, `services.find` for
 * `work.queue`): whichever module provides it, by the words of its own descriptor. This module never
 * names a queue of its own accord — with none provided, nothing it says mentions one.
 *
 * Asked again when what was found is older than `WORK_QUEUE_FRESH_MS`, never twice at once. No answer
 * keeps what was found before; an answer of none forgets it. The last one found is kept on disk too,
 * so a process that starts while the host is still away still knows it for the note after a restart.
 */

/** Asks the host who provides `work.queue`: the providers, `[]` for none, null when no host answered. */
export type FindProviders = () => Promise<readonly ServiceProvider[] | null>

/** How long a work queue found is used before the host is asked again. */
export const WORK_QUEUE_FRESH_MS = 5 * 60_000

/** The host's answer, from this module's server. A host before 2.81.0 provides no services: none. */
export function askedProviders(module: string): FindProviders {
  return async () => {
    const found = await askHost('services.find', { service: WORK_QUEUE }, { module })
    if (found.ok) return found.data.providers
    return found.declined === 'host-too-old' ? [] : null
  }
}

export class WorkQueueLookup {
  private queue: WorkQueue | null
  private at = 0
  private asking: Promise<WorkQueue | null> | null = null
  private readonly listeners = new Set<(queue: WorkQueue | null) => void>()

  constructor(
    private readonly find: FindProviders,
    private readonly file: string | null = null,
    private readonly now: () => number = Date.now,
  ) {
    this.queue = file ? readKeptWorkQueue(file) : null
  }

  /** The work queue as last found, without waiting; asked again in the background when that is old. */
  current(): WorkQueue | null {
    if (this.stale()) void this.ask()
    return this.queue
  }

  /** The work queue, asked again first when what was found is old. Never throws. */
  async fresh(): Promise<WorkQueue | null> {
    return this.stale() ? this.ask() : this.queue
  }

  /** Called when the work queue found changes. */
  onChange(listener: (queue: WorkQueue | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private stale(): boolean {
    return this.at === 0 || this.now() - this.at >= WORK_QUEUE_FRESH_MS
  }

  private ask(): Promise<WorkQueue | null> {
    this.asking ??= this.find()
      .catch(() => null)
      .then((providers) => {
        this.asking = null
        /* No answer: what was found before stands, and it is asked again next time. */
        if (providers === null) return this.queue
        this.at = this.now()
        const next = providerOf(WORK_QUEUE, providers)?.descriptor ?? null
        if (JSON.stringify(next) !== JSON.stringify(this.queue)) {
          this.queue = next
          if (this.file) writeKeptWorkQueue(this.file, next)
          for (const listener of this.listeners) listener(next)
        }
        return this.queue
      })
    return this.asking
  }
}

/** The work queue kept on disk; null when none is, or it does not parse. Never throws. */
export function readKeptWorkQueue(file: string): WorkQueue | null {
  try {
    return serviceDescriptor(WORK_QUEUE, JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function writeKeptWorkQueue(file: string, queue: WorkQueue | null): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(queue), { mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    /* Kept in memory only. */
  }
}

/** Where a command goes in what an agent is told. */
export const SOME_COMMAND = '<command>'

/** The queue's line for heavy work, a placeholder where the command goes: its test line, else the first kind it takes. */
export function heavyRunLine(queue: WorkQueue): string {
  for (const kind of ['test', ...WORK_KINDS] as const) {
    const line = workRunLine(queue, kind, SOME_COMMAND)
    if (line) return line
  }
  /* The schema refuses a queue that takes no kind of work. */
  return SOME_COMMAND
}

/** How to run heavy work through the queue from the shell, in one sentence from its descriptor. */
export function shellQueueSaid(queue: WorkQueue): string {
  return `run tests, typechecks, builds and big installs through ${queue.name} from the shell instead: \`${heavyRunLine(queue)}\` as a background command, from the folder the command belongs in.`
}

/**
 * The one note a session is told at its first prompt after a restart: the tools may be gone, the
 * shell path for heavy work when a work queue is provided, and `reconnect` — how the person brings
 * the tools back in this agent's CLI, or null where it has no way.
 */
export function restartNote(queue: WorkQueue | null, reconnect: string | null): string {
  return [
    'Kehikot restarted since your last turn, so the MCP tools of Kehikot and its modules may have disconnected from this session.',
    queue
      ? `If any you had are missing or fail${queue.tool ? ` (${queue.tool} and the others)` : ''}, do not skip what they were for and do not run heavy commands directly: ${shellQueueSaid(queue)}`
      : 'If any you had are missing or fail, do not skip what they were for.',
    ...(reconnect ? [reconnect] : []),
  ].join(' ')
}

/** What an agent is told when Kehikot did not answer its guard hook and the call ran unguarded. */
export function unguardedSaid(queue: WorkQueue | null, what = 'this command'): string {
  const ran = `Kehikot did not answer (it may be restarting), so ${what} ran without the guards of the modules on your kehikko.`
  return queue ? `${ran} Until it is back, run heavy work (tests, typechecks, builds, big installs) through ${queue.name} yourself: \`${heavyRunLine(queue)}\` in the background, from the folder the command belongs in.` : ran
}
