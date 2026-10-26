import { KEHIKOT_DIR, settingValueIssue, settingsDeclarationSchema, type SettingField } from 'kehikot-module-protocol'

/**
 * Codex's settings as a host shows them (protocol 2.15.0, `declares.settings`), kept in the
 * project's `.kehikot/codex/settings.json` — the same file the page's toggle writes, in the same
 * format. Pure; the door is in `doors.ts`, the arguments a setting becomes are `sessionFlags`.
 *
 * Each is the person's (`personOnly`): an agent is refused. Resuming a conversation a restart cut
 * off sends a sentence on the person's account; the model and its effort change what a session
 * costs; how often Codex asks before it acts is theirs to say.
 *
 * What is NOT a setting here, on purpose: the sandbox. A session opened here has the sandbox the
 * same `codex` would have in a terminal in that folder (the person's `config.toml`), and nothing
 * on this page or this door can widen it. The approval choice can only make Codex ask, or stop it
 * asking — never let a command out of the sandbox without asking (`--approve-for-me` and
 * `--dangerously-bypass-approvals-and-sandbox` are never passed).
 */

export const SETTINGS_FILE = `${KEHIKOT_DIR}/codex/settings.json`

/** The reasoning efforts Codex 0.164.0 takes (`model_reasoning_effort`), and none: the model's own default. */
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const

export const SETTINGS: SettingField[] = settingsDeclarationSchema.parse([
  {
    key: 'resumeCutOff',
    label: 'Resume conversations cut off by a restart',
    description: 'A conversation a restart stopped mid-turn is told what happened when you open it again, and carries on. Off: it waits for you.',
    type: 'boolean',
    default: true,
    personOnly: true,
  },
  {
    key: 'model',
    label: 'Model for new sessions',
    description: 'The model a session started or resumed here asks for, as Codex names it (for example gpt-5.5). Empty: what your Codex config says.',
    type: 'string',
    default: '',
    personOnly: true,
  },
  {
    key: 'effort',
    label: 'Reasoning effort',
    description: 'How hard the model thinks before it answers, for sessions started or resumed here. Your Codex config decides when this is left at its default.',
    type: 'choice',
    choices: [{ value: 'default', label: 'Codex config' }, ...EFFORTS.map((one) => ({ value: one, label: one }))],
    default: 'default',
    personOnly: true,
  },
  {
    key: 'approvals',
    label: 'When Codex asks before acting',
    description: 'Ask when it needs to: Codex asks before a command leaves its sandbox. Never ask: such a command fails and Codex is told. Neither lets anything out of the sandbox unasked.',
    type: 'choice',
    choices: [
      { value: 'default', label: 'Codex config' },
      { value: 'on-request', label: 'Ask when it needs to' },
      { value: 'never', label: 'Never ask' },
    ],
    default: 'default',
    personOnly: true,
  },
])

/** A project's settings for this module. */
export interface Settings {
  resumeCutOff: boolean
  model: string
  effort: string
  approvals: string
}

export const DEFAULTS: Settings = { resumeCutOff: true, model: '', effort: 'default', approvals: 'default' }

/** A model name as Codex takes one: no spaces, no quotes, nothing that is not a model id. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/

/** Why `value` cannot be setting `key`, or null. Beyond the protocol's type check: a model is one word. */
export function settingIssue(key: string, value: unknown): string | null {
  const field = SETTINGS.find((one) => one.key === key)
  if (!field) return `Codex has no setting called "${key.slice(0, 64)}".`
  const wrong = settingValueIssue(field, value)
  if (wrong) return `${field.label}: ${wrong}.`
  if (key === 'model' && value !== '' && !MODEL.test(String(value))) return 'A model is one word, as Codex names it (for example gpt-5.5).'
  return null
}

/** Settings off a file, each value the default where the file says nothing it could be. */
export function settingsOf(raw: unknown): Settings {
  const said = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (Object.hasOwn(said, key) && settingIssue(key, said[key]) === null) (out as Record<string, unknown>)[key] = said[key]
  }
  return out
}

/**
 * The `-c` arguments a project's settings give a session started or resumed here: the model, its
 * effort, and when to ask. Nothing for a setting left at its default — the person's own Codex
 * config then decides, as in any terminal.
 */
export function sessionFlags(settings: Settings): string[] {
  const out: string[] = []
  if (settings.model && MODEL.test(settings.model)) out.push('-c', `model=${JSON.stringify(settings.model)}`)
  if ((EFFORTS as readonly string[]).includes(settings.effort)) out.push('-c', `model_reasoning_effort=${JSON.stringify(settings.effort)}`)
  if (settings.approvals === 'on-request' || settings.approvals === 'never') out.push('-c', `approval_policy=${JSON.stringify(settings.approvals)}`)
  return out
}
