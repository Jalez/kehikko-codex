# Codex

A terminal holding the Codex CLI session that belongs to the place you are looking at.

Port **8100**. `kehikot.codex`. The sibling of the Claude module (`kehikot.claude`): the same
record, page, doors and promises, with `program.ts` answering for OpenAI's Codex CLI instead of
Claude Code. Everything here was measured against Codex CLI **0.164.0** with a scratch
`CODEX_HOME` and a stand-in for the model API; no account was used.

```bash
bun install
./run.sh             # or: PORT=8100 ./run.sh
```

Then put it on a kehikko. Opened on its own (<http://127.0.0.1:8100/app>) it says nothing is
framing it: a session belongs to a project, and only a host says which.

---

## What it does

- **A session per place.** A place is project + epic + the picked parts + kehikko. Opening the
  module there shows Codex's own UI in a terminal: the place's conversation, resumed by id
  (`codex resume <id>`), or a new one. The View menu lists this kehikko's conversations; Codex's
  own `/resume` and `/clear` work in it, and the record follows (the session's own hooks name the
  conversation it is on).
- **Filed with no command.** A conversation started here is filed under its place the moment
  Codex has a record of it (its first prompt) and is that kehikko's own when the kehikko had none.
  `$kehikot-here`, typed in a Codex conversation, assigns that conversation to the kehikko on
  screen.
- **It knows where it is.** At its start — new, resumed, cleared or compacted — a session is told
  its place, one line per module on the kehikko (name, its own line, its MCP server, its skills)
  and the skills Kehikot loaded for it; at a prompt it is told only what changed (a module put on
  the kehikko or taken off, or the conversation moved).
- **The kehikko's MCP doors** — the host's own and each module's, each carrying the
  conversation's place token — are given to the session for that one process.
- **Skills.** The skills of every module on the kehikko, kehikko-bound ones only when what they
  need is there, written into the session's own folder in Codex's skill format and listed to it
  the way Codex lists its own. The manifest says `agentSessions: { loadsSkills: true }`, so the
  host routes kehikko-bound skills here.
- **Working, needs you, finished**, from Codex's own hooks, in the Inbox (`activity.set`) and the
  View menu; a notice when a session nobody is looking at needs its person or finishes.
- **Interrupted work.** A conversation a restart cut off mid-turn is a "needs you" line in the
  Inbox, and — unless "Resume conversations cut off by a restart" is off — is told what happened
  when its place is next opened.
- **The context meter** under the session: the window in use, from the transcript, with
  **Compact** (`/compact`) and **Clear** (`/clear`) typed only on a person's press, only while
  Codex waits at its prompt.
- **Settings** (Kehikot › Settings, or the gear on the container): resume conversations cut off
  by a restart; the model; the reasoning effort; when Codex asks before acting. Each a person's.
- **`sessions`**, an MCP tool that reads: which sessions belong to which place, their state and
  their context.

## What Codex supports, as found

Found by reading `codex --help`, `codex features list`, the docs at developers.openai.com (now
learn.chatgpt.com) and the source of openai/codex at `970111f`, and by running the CLI in a pty
against a stand-in for the Responses API.

| | Codex CLI 0.164.0 |
|---|---|
| **Where it lives** | Not on this machine's PATH. npm (`@openai/codex`: a Node launcher, `bin/codex.js`, in front of a Rust binary in `@openai/codex-<platform>/vendor/<triple>/bin/codex`), Homebrew cask, or inside the Codex desktop app. The module's Install button never needs admin rights: `brew install --cask codex` when Homebrew is here, otherwise `npm install -g --prefix ~/.local @openai/codex` (the plain `npm install -g` fails with EACCES where npm's prefix is root-owned, e.g. `/usr/local`); it runs in a terminal the person watches, and a failure is said in a sentence with the full output behind "See the log". `find` looks in PATH, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, npm's own global prefix (`npm prefix -g`) and `Codex.app/Contents/Resources`, and runs the Rust binary behind an npm launcher directly, so no `node` has to be on the desktop app's thin PATH. |
| **Per-run configuration** | `-c key=value` (TOML values) layers a "session flags" config over `~/.codex/config.toml` without writing it. A dotted key cannot hold a dot, so a table whose keys have dots is given whole (`-c hooks.state={…}`). Any `-c` puts the session in *embedded mode*: it runs in the CLI's own process, not on Codex's shared background server. |
| **MCP** | `[mcp_servers.<name>]` in config.toml, `codex mcp add`, or per run `-c mcp_servers.<name>={url="…"}` (streamable HTTP). Measured: a per-run server connects and `/mcp` lists it beside the person's own. |
| **Skills** | A folder with `SKILL.md`: `name` and `description` front matter (the open agent-skills format, the same as Claude Code's); optional `agents/openai.yaml` (`policy.allow_implicit_invocation: false`). Found in `$CODEX_HOME/skills` (deprecated), `~/.agents/skills`, `<repo>/.agents/skills` up to the repo root, `/etc/codex/skills`, plugins and the bundled ones. **No per-run skill folder**: no `--plugin-dir`; `skills.config` only enables or disables a skill already found. No `$ARGUMENTS`, no `${…SESSION_ID}` substitution, no load-time `` !`command` `` lines. Invoked with `$name` or by matching its description. |
| **Hooks** | Claude Code's events and JSON nearly one for one: `SessionStart` (`source`: startup, resume, clear, compact), `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `Interrupt`, `PreCompact`, `PostCompact`, `SubagentStart/Stop`, `SessionEnd`. Each is handed `session_id`, `transcript_path`, `cwd`. `hookSpecificOutput.additionalContext` from SessionStart and UserPromptSubmit reaches the model as a developer message. **Non-managed hooks need trust**: `hooks.state."<source>:<event>:<group>:<handler>".trusted_hash` must equal the hook's hash (sha256 of its normalised definition), else Codex asks the person to review them. Measured: the hash can be given per run in `-c hooks.state`, which trusts exactly this module's hooks for one process. |
| **Sessions** | `codex` (a new one: Codex chooses a UUIDv7 id, and writes nothing until the first prompt), `codex resume <id> [prompt]`, `codex fork`, `codex archive`. Transcripts at `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`; `$CODEX_HOME/thread-writer-locks/<id>.lock` is held open by the process writing a conversation, and a second `resume` of a held one says "open in another app" and offers retry or fork. `codex exec` is the non-interactive mode. `codex agents` is a TUI over the background server, with no JSON. |
| **Notify / status line** | `notify = [cmd]` runs on a turn's end with a JSON argument (the hooks cover it and more). `tui.status_line` is a list of built-in footer items, not a command: there is no status line to read the live figures from. |
| **Compact / Clear** | `/compact`, and `/clear` (clears the terminal and starts a new chat; `/new` does the same without clearing). |
| **Tokens** | Every request writes an `event_msg` `token_count`: `last_token_usage` (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`) and `model_context_window` (the usable window: 258 400 of gpt-5.5's 272 000). `total_tokens` of the last request is what Codex calls the tokens in the window. A compaction is a `compacted` row followed by a fresh `token_count`. Codex compacts by itself at 90 % of the whole window unless `model_auto_compact_token_limit` says less. No cost is written. |
| **Environment** | `CODEX_THREAD_ID` is the conversation's id in every command Codex runs. The default sandbox (workspace-write) blocks network, loopback included: a command that talks to Kehikot must ask to run outside it. |

## The Claude module, feature by feature

| Claude 1.8 | Codex 0.1 | |
|---|---|---|
| Terminal sessions in the container, several, a reload reconnects to the same screen | **done** | the same server-owned runs and headless screen; Bun's pty when ready-built, node-pty under Vite |
| Sessions filed per place, auto-assigned, the kehikko's own | **done** | filed when Codex's first hook names the conversation (Codex chooses the id) |
| Resume after restarts and updates | **adapted** | resumed by id when the place is next opened. A conversation does **not** keep running through a restart: per-run settings put Codex in embedded mode, so it ends with the module (Claude's run in Claude Code's background and are re-attached) |
| A conversation open in another process | **adapted** | asked of the lock file (`lsof`); "Open it here anyway" lets Codex itself offer retry or fork. No attach: Codex has no attachable background session |
| Kehikot's MCP doors per session | **done** | `-c mcp_servers.<name>=…` per run. The place token is in the process's arguments: Codex reads per-run servers from nowhere else that is not `~/.codex` (the token is a pointer, not a credential) |
| Skills loaded per session, kehikko-bound by `needs` | **adapted** | Codex has no per-run skill folder, so the skills are written to the session's own folder and listed to it in Codex's own `<skills_instructions>` shape through its SessionStart hook; Codex's `$` menu does not show them (type `$name`). Claude Code skill syntax is translated (`forCodex`) |
| `/kehikot-here` | **adapted** | `$kehikot-here`: the model runs one `curl` with `$CODEX_THREAD_ID`, outside the sandbox, which the person approves. Not declared in the manifest, because a host installs declared skills into Claude Code's folder; a conversation started outside Kehikot needs the skill in `~/.agents/skills` (served at `/kehikot/skills/kehikot-here.md`) |
| Context at start and changes at the next prompt | **done** | the same `context.sh` and answers; SessionStart comes at a new conversation's first prompt |
| Working / needs you / finished, notices, Inbox | **done** | Codex's hooks, trusted per run by hash. Better than Claude's on two points: an Esc interrupt is reported (`Interrupt`), and Codex's question tool (`request_user_input`, by a `PreToolUse` matcher; measured with the stand-in CLI only) is "needs you". Codex runs `PermissionRequest` hooks just before it draws the question |
| Interrupted-work alert after a restart | **adapted** | the cut-off turn is the Inbox line, and the conversation is told on its next open (Claude wakes it in the background at once). Codex writes nothing about background terminals a session's end killed, so there are no "background tasks didn't finish" lines |
| Context meter | **done** | from `token_count`; exact window from Codex itself. No cost (Codex writes none), no live status line (Codex has no status-line command) |
| Compact and Clear | **done** | `/compact`, `/clear`, on a press, only at the prompt |
| Settings | **done, more** | resume after a restart, model, reasoning effort, approvals (`on-request` / `never`); never the sandbox |
| `sessions` MCP tool | **done** | |
| Ready-built, run.sh stamp check | **done** | |
| Icon | **adapted** | `lucide:bot`: the protocol has no OpenAI mark (`BRAND_MODULE_ICONS`) |
| "Report sessions started outside Kehikot" (a SessionStart hook in the person's settings) | **not done** | it would write into `~/.codex/config.toml`, and a hook there needs the person's trust in Codex's own `/hooks` screen |
| Session names in the agent's lists (`--name`) | **not possible** | Codex takes no name at start (`/rename` is typed in the session) |

## Where its data lives

`<project>/.kehikot/codex/places.json` (which session belongs to which place; ignored by git by
default, with a `.gitignore` beside it) and `<project>/.kehikot/codex/settings.json`. Nothing in
`~/.codex` is written; Codex's own records there are read (`sessions/`, `thread-writer-locks/`).
A session's folder (its skills, its context hook and its token, 0700/0600) is in this user's
temporary directory, under `kehikot-codex-<uid>/`, and is removed when the session ends.

## What it never does

- It never sends a prompt of anybody's. Its one sentence — "Kehikot restarted while you were
  working…" — goes, once, to a conversation a restart cut off, when its place is next opened,
  behind the person's setting; and `/compact` or `/clear`, on a person's press.
- It never widens what Codex may do: no `--dangerously-bypass-approvals-and-sandbox`, no
  `--approve-for-me`, no `--dangerously-bypass-hook-trust` (which would run the person's own
  untrusted hooks too), no sandbox setting. The approvals setting can only make Codex ask, or
  make a command that would leave the sandbox fail.
- It never writes `~/.codex/config.toml`, a profile, a plugin or a skill there.
- It never reads what a hook is handed beyond the conversation's id, and never reads a transcript
  beyond what labels a session (what the person typed first and last), the turn markers and the
  token counts.

## Doors

The Claude module's doors, the same paths (`/app`, `/healthz`, `WS /session`, `/api/place`,
`/api/rekey`, `/api/end`, `/api/settings`, `/api/kehikot/settings`, `/api/restart`,
`/api/assign`, `/api/detach`, `/api/showing`, `/api/context`, `/api/state`, `/api/here`,
`/api/feed`, `/mcp`, `/kehikot/skills/kehikot-here.md`), less `/api/status` (no status line) and
`/api/hook`. `/api/state` takes `thread`, the conversation Codex says the hook ran in.

## Layout

| file | what is in it |
|---|---|
| `program.ts` | everything that knows it is Codex: where it is, what it can do, its records, its hooks and their trust, its locks |
| `skills.ts`, `plugin/skills/kehikot-here` | the skills a session is given, in Codex's format, and the translation from Claude Code's |
| `meter.ts`, `gauges.ts` | the context meter, from `token_count` rows read as the transcript grows |
| `cutoff.ts` | a turn cut off, and whether the person moved on |
| `settings.ts` | the settings, and the `-c` arguments they become |
| `doorConfig.ts` | the doors the host gives a session, as `-c mcp_servers.*` |
| `live.ts`, `record.ts`, `context.ts`, `here.ts`, `doors.ts`, `place.ts`, `input.ts`, `src/` | as in the Claude module |
| `tell.sh`, `context.sh` | what a session's hooks run |
| `test/stand-in/codex` | a Bun stand-in for the CLI: it refuses a hook whose trust hash does not match, as Codex does |

## Checks

```bash
bun test
bun run typecheck
```

The tests give themselves a machine of their own (`test/setup.ts`): a scratch home,
`CODEX_HOME`, registry and PATH.

## Served ready-built

`run.sh` serves the built page (`serve.ts`, the protocol's `run`) when `dist/` carries a stamp of
the commit checked out, and Vite otherwise. `bun run build` makes the build and the stamp; a host
runs it when it installs or updates the module, never at start.
