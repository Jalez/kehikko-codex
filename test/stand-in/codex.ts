/**
 * A stand-in for the Codex CLI, for tests: it takes the arguments this module passes, keeps a
 * record where Codex 0.164.0 keeps one, holds its lock file while it runs, and runs the hooks it
 * is given at the moments the real one was measured to (program.ts).
 *
 *   --help, features list     what `supports` reads. STANDIN_OLD=1: no `resume`; STANDIN_NOHOOKS=1: hooks off.
 *   [resume <id> [line]] [-c k=v]…   a session. A new one has no id until its first line, as the real one.
 *
 * Hooks given with `-c hooks.<Event>=[…]` run only when `-c hooks.state` trusts each by its hash,
 * as the real one does; an untrusted one prints "Hooks need review" and is not run. Typed lines:
 *
 *   a line                 SessionStart (first line of a conversation), UserPromptSubmit, the echo, Stop
 *   /ask                   UserPromptSubmit, PreToolUse, PermissionRequest; the next line answers: PostToolUse, Stop
 *   /work                  UserPromptSubmit and no Stop, dots until /interrupt (Interrupt)
 *   /compact               PreCompact, a compaction in the record, PostCompact
 *   /clear                 the next line starts a new conversation (SessionStart source clear)
 *   /mcp <server> <tool>   calls that door's tool, as Codex would
 *   /exit                  ends
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, appendFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const out = (text: string) => process.stdout.write(text.replace(/\n/g, '\r\n'))

if (argv[0] === '--help') {
  out('Codex CLI\n\nUsage: codex [OPTIONS] [PROMPT]\n\nCommands:\n')
  if (!process.env.STANDIN_OLD) out('  resume   Resume a previous interactive session\n')
  out('  features Inspect feature flags\n\nOptions:\n  -c, --config <key=value>  Override a configuration value\n')
  out('      --dangerously-bypass-hook-trust  Run enabled hooks without requiring persisted hook trust\n')
  process.exit(0)
}
if (argv[0] === 'features' && argv[1] === 'list') {
  out(`goals                                    stable             true\nhooks                                    stable             ${process.env.STANDIN_NOHOOKS ? 'false' : 'true'}\n`)
  process.exit(0)
}

const home = process.env.CODEX_HOME || join(process.env.HOME ?? '/tmp', '.codex')
const configs: string[] = []
const rest: string[] = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-c') configs.push(argv[++i] ?? '')
  else rest.push(argv[i]!)
}

/* What the module's `-c` values say: hooks, their trust, and doors. Parsed for the shapes it writes. */
type Hook = { event: string; group: number; index: number; matcher?: string; command: string; timeout: number }
const KEYS: Record<string, string> = { SessionStart: 'session_start', UserPromptSubmit: 'user_prompt_submit', PreToolUse: 'pre_tool_use', PermissionRequest: 'permission_request', PostToolUse: 'post_tool_use', Stop: 'stop', Interrupt: 'interrupt', PreCompact: 'pre_compact', PostCompact: 'post_compact', SubagentStart: 'subagent_start', SubagentStop: 'subagent_stop' }
const hooks: Hook[] = []
const trusted = new Map<string, string>()
const doors = new Map<string, string>()
for (const one of configs) {
  const hook = /^hooks\.([A-Za-z]+)=\[(.*)\]$/.exec(one)
  if (hook && hook[1] !== 'state') {
    const groups = hook[2]!.split(/(?<=\]\}),(?=\{)/)
    groups.forEach((group, at) => {
      const matcher = /^\{matcher=("(?:[^"\\]|\\.)*"),/.exec(group)?.[1]
      let index = 0
      for (const handler of group.matchAll(/\{type="command",command=("(?:[^"\\]|\\.)*"),timeout=(\d+)\}/g)) {
        hooks.push({ event: hook[1]!, group: at, index: index++, ...(matcher ? { matcher: JSON.parse(matcher) } : {}), command: JSON.parse(handler[1]!), timeout: Number(handler[2]) })
      }
    })
  }
  if (one.startsWith('hooks.state={')) {
    for (const each of one.matchAll(/("(?:[^"\\]|\\.)*")=\{trusted_hash=("(?:[^"\\]|\\.)*")\}/g)) trusted.set(JSON.parse(each[1]!), JSON.parse(each[2]!))
  }
  const door = /^mcp_servers\.([A-Za-z0-9_-]+)=\{url=("(?:[^"\\]|\\.)*")\}$/.exec(one)
  if (door) doors.set(door[1]!, JSON.parse(door[2]!))
}
const sorted = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(sorted).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sorted((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const hashOf = (hook: Hook) => `sha256:${createHash('sha256').update(sorted({ event_name: KEYS[hook.event], ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}), hooks: [{ type: 'command', command: hook.command, timeout: hook.timeout, async: false }] })).digest('hex')}`
const review = hooks.filter((hook) => trusted.get(`/<session-flags>/config.toml:${KEYS[hook.event]}:${hook.group}:${hook.index}`) !== hashOf(hook))
if (review.length) out(`Hooks need review: ${review.length} hook${review.length === 1 ? ' is' : 's are'} new or changed (not run)\n`)
const runnable = hooks.filter((hook) => !review.includes(hook))

let session: string | null = null
let source = 'startup'
let line: string | undefined
if (rest[0] === 'resume') {
  session = rest[1] ?? null
  line = rest[2]
  const file = session ? rolloutOf(session) : null
  if (!file) {
    out(`No saved session found with ID ${session}\n`)
    process.exit(1)
  }
  source = 'resume'
}

function rolloutOf(id: string): string | null {
  const root = join(home, 'sessions')
  if (!existsSync(root)) return null
  for (const y of readdirSync(root)) for (const m of readdirSync(join(root, y))) for (const d of readdirSync(join(root, y, m))) {
    const name = readdirSync(join(root, y, m, d)).find((one) => one.endsWith(`-${id}.jsonl`))
    if (name) return join(root, y, m, d, name)
  }
  return null
}

let file: string | null = session ? rolloutOf(session) : null
let lock: number | null = null
let started = false
const row = (type: string, payload: unknown) => file && appendFileSync(file, `${JSON.stringify({ timestamp: new Date().toISOString(), type, payload })}\n`)
const holdLock = () => {
  if (lock !== null) closeSync(lock)
  const dir = join(home, 'thread-writer-locks')
  mkdirSync(dir, { recursive: true })
  lock = openSync(join(dir, `${session}.lock`), 'a')
}
const begin = () => {
  if (!session) {
    session = randomUUID()
    const day = new Date().toISOString().slice(0, 10).split('-')
    const dir = join(home, 'sessions', ...day)
    mkdirSync(dir, { recursive: true })
    file = join(dir, `rollout-${new Date().toISOString().replace(/[:.]/g, '-')}-${session}.jsonl`)
    writeFileSync(file, `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: session, cwd: process.cwd(), source: 'cli', thread_source: 'user', base_instructions: 'x'.repeat(2000) } })}\n`)
  }
  holdLock()
}

async function fire(event: string, more: Record<string, unknown> = {}, tool?: string): Promise<void> {
  for (const hook of runnable.filter((one) => one.event === event && (!one.matcher || (tool !== undefined && new RegExp(one.matcher).test(tool))))) {
    const input = JSON.stringify({ session_id: session, transcript_path: file, cwd: process.cwd(), hook_event_name: event, model: 'gpt-5.5', ...more })
    const child = Bun.spawn(['/bin/sh', '-c', hook.command], { stdin: new Blob([input]), stdout: 'pipe', stderr: 'ignore', env: process.env, cwd: process.cwd() })
    const said = await new Response(child.stdout).text()
    await child.exited
    try {
      const context = (JSON.parse(said) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext
      if (context) {
        out(`context(${event}): ${context.split('\n')[0]}\n`)
        row('response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: context }] })
      }
    } catch {
      /* Plain output, or nothing. */
    }
  }
}

let tokens = 9000
const turn = async (said: string, open = false) => {
  const first = !started
  begin()
  if (first || source === 'clear' || source === 'compact') {
    await fire('SessionStart', { source })
    started = true
    source = 'startup'
  }
  row('event_msg', { type: 'task_started', turn_attribution: { turn_trigger: 'user' } })
  row('turn_context', { model: 'gpt-5.5' })
  row('event_msg', { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: said }] } })
  await fire('UserPromptSubmit', { prompt: said })
  tokens += 1500
  row('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: tokens - 50, cached_input_tokens: 4000, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: tokens }, model_context_window: 258400 } })
  if (open) return
  row('event_msg', { type: 'task_complete' })
  await fire('Stop', { stop_hook_active: false })
}

out(`stand-in codex: ${session ? `RESUMED session ${session}` : 'NEW session'}\n`)
out(`args: ${JSON.stringify(rest)} hooks=${runnable.length} doors=${[...doors.keys()].join(',')}\n`)
out(`cwd: ${process.cwd()}\n`)
if (session) holdLock()
if (line) await turn(line)

let dots: ReturnType<typeof setInterval> | null = null
let asking = false
const quiet = () => {
  if (dots) clearInterval(dots)
  dots = null
}
process.on('SIGHUP', () => {
  out('stand-in codex: hung up\n')
  process.exit(0)
})
process.on('exit', () => {
  if (session) rmSync(join(home, 'thread-writer-locks', `${session}.lock`), { force: true })
})

let buffer = ''
out('> ')
for await (const chunk of process.stdin) {
  buffer += String(chunk)
  let at: number
  while ((at = buffer.search(/[\r\n]/)) >= 0) {
    const said = buffer.slice(0, at)
    buffer = buffer.slice(at + 1)
    if (!said) continue
    if (asking) {
      asking = false
      out(`answered: ${said}\n`)
      await fire('PostToolUse', { tool_name: 'exec_command' }, 'exec_command')
      row('event_msg', { type: 'task_complete' })
      await fire('Stop')
    } else if (said === '/exit') {
      quiet()
      out('bye\n')
      process.exit(0)
    } else if (said === '/interrupt' || said === '\x1b') {
      quiet()
      row('event_msg', { type: 'turn_aborted', reason: 'interrupted' })
      await fire('Interrupt')
      out('interrupted\n')
    } else if (said === '/work') {
      await turn(said, true)
      dots = setInterval(() => out('.'), 1000)
    } else if (said === '/ask') {
      await turn(said, true)
      await fire('PreToolUse', { tool_name: 'exec_command' }, 'exec_command')
      await fire('PermissionRequest', { tool_name: 'exec_command' }, 'exec_command')
      out('stand-in codex: may I? (the next line is the answer)\n')
      asking = true
    } else if (said === '/question') {
      await turn(said, true)
      await fire('PreToolUse', { tool_name: 'request_user_input' }, 'request_user_input')
      out('stand-in codex: a question (the next line is the answer)\n')
      asking = true
    } else if (said === '/compact') {
      begin()
      await fire('PreCompact', { trigger: 'manual' })
      row('event_msg', { type: 'task_started' })
      row('compacted', { message: 'summary' })
      tokens = 3000
      row('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: 3000, cached_input_tokens: 0, output_tokens: 0, total_tokens: 3000 }, model_context_window: 258400 } })
      row('event_msg', { type: 'task_complete' })
      await fire('PostCompact', { trigger: 'manual' })
      source = 'compact'
      out('compacted\n')
    } else if (said === '/clear') {
      if (lock !== null) closeSync(lock)
      if (session) rmSync(join(home, 'thread-writer-locks', `${session}.lock`), { force: true })
      session = null
      file = null
      lock = null
      source = 'clear'
      started = true
      out('cleared\n')
    } else if (said.startsWith('/mcp ')) {
      const [, server, tool, ...args] = said.split(' ')
      const url = doors.get(server ?? '')
      if (!url) out(`no MCP server ${server}\n`)
      else {
        try {
          const call = (body: unknown, id?: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(id ? { 'mcp-session-id': id } : {}) }, body: JSON.stringify(body) })
          const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stand-in codex', version: '0' } } })
          const sid = init.headers.get('mcp-session-id') ?? undefined
          const answer = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args.length ? JSON.parse(args.join(' ')) : {} } }, sid)
          out(`mcp ${server} ${tool}: ${(await answer.text()).slice(0, 2000)}\n`)
        } catch (error) {
          out(`mcp ${server} ${tool} failed: ${error instanceof Error ? error.message : String(error)}\n`)
        }
      }
    } else {
      await turn(said)
      out(`you said: ${said}\n`)
    }
    out('> ')
  }
}
