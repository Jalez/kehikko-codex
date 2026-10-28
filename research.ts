import { open as openFile } from 'node:fs/promises'

import { firstPrompt, recordFile } from './program.ts'

/**
 * "Research complete": the Inbox event this module declares (protocol 2.31.0, `events` in the
 * manifest), and the one rule for when a subagent's finish is one.
 *
 * ## How a finished piece of research is told
 *
 *  - **The session's own agent** calls `tell_finished({ event: 'research-complete', label })` on
 *    this module's MCP door (`doors.ts`). The door knows the conversation by the place token on its
 *    URL, so only that conversation's agent (or a subagent of it, which calls the same doors) can
 *    tag its item. The tag waits for the turn to end (`Stop`), and the finished item then names the
 *    event and carries the label.
 *  - **A subagent** that finishes (`SubagentStop`, through `tell.sh`) is one when it called the
 *    tool while it ran (the tag is newer than its `SubagentStart`), or when it is research
 *    (`isResearch`). It is then an item of its own. Any other subagent finishing says nothing.
 *
 * ## What Codex says of a subagent
 *
 * Codex (codex-rs `SubagentStopCommandInput`) hands a subagent's hooks its `agent_id` — the child
 * thread's id — and `agent_type`, its role (`default`, `explorer`, `worker`, or one the person
 * configured). No description. So a subagent is research when its role is `explorer` ("specific
 * codebase questions"), or when the first line of the task it was given reads as research; that
 * line is its label. It is read from the subagent's own record the way a conversation's first
 * prompt is (`firstPrompt`), and nothing else of the record is.
 */

export { EVENTS, EVENT_IDS, RESEARCH_EVENT } from './events.ts'

const RESEARCH_WORDS =
  /\b(research\w*|investigat\w*|find(?:ing)? out|look(?:ing)? into|compar\w*|audit\w*|survey\w*|explor\w*|analy[sz]\w*|stud(?:y|ies|ying)|review\w*|evaluat\w*|assess\w*|read(?:ing)? up)\b/i
/** Codex's own read-only role: its subagents answer questions about the code. */
const RESEARCH_ROLES = new Set(['explorer'])

/** Whether a finished subagent was research: an `explorer`, or a task whose first line has a research word. */
export function isResearch(agent: { agentType?: string | null; task?: string | null }): boolean {
  if (agent.agentType && RESEARCH_ROLES.has(agent.agentType)) return true
  return RESEARCH_WORDS.test((agent.task ?? '').trim())
}

/** An agent id as Codex gives one (a thread id); nothing else is used to find a record. */
export const AGENT_ID = /^[0-9a-f-]{36}$/
/** An agent type (a role) as a hook gives one. */
export const AGENT_TYPE = /^[A-Za-z0-9:._-]{1,64}$/

const HEAD_BYTES = 512 * 1024

/** The first line of the task a subagent was given, from the head of its own record; null when there is none. */
export async function subagentTask(agent: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (!AGENT_ID.test(agent)) return null
  const file = await recordFile('', agent, env)
  if (!file) return null
  const handle = await openFile(file, 'r').catch(() => null)
  if (!handle) return null
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return firstPrompt(buffer.subarray(0, bytesRead).toString('utf8')) || null
  } finally {
    await handle.close()
  }
}

/** What the session's agent said it finished, waiting for the turn or a subagent to end. */
export interface Told {
  event: string
  label: string
  at: number
}

/** A subagent's finished research, as an item of its own until the person opens the session. */
export interface Found {
  agent: string
  event: string
  label: string
  at: number
}

/** How many subagent items one session keeps at most; the oldest go first. */
export const FOUND_MOST = 8
