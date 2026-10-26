# Claude

A terminal holding the Claude Code session that belongs to the place you are looking at.

Port **8010**. `kehikot.claude`.

```bash
bun install
bun run register     # tell a host on this machine where this answers
./run.sh             # or: PORT=8010 ./run.sh
```

Then put it on a kehikko. Opened on its own (<http://127.0.0.1:8010/app>) it says nothing is framing it:
a session belongs to a project, and only a host says which.

---

## What this is

Terminal (`kehikot.terminal`) is a shell, and `claude` is one of the things you can type in it. This is
what was asked for when the typing was always the same: *"a variant of terminal module for claude code
that automatically opens claude code session in the terminal. It should be the same session associated
with this specific epic > parts > kehikko, and if there are more than one session associated with it,
then it asks which one to open before it opens it."*

The asking was later taken out, on the same person's word: *"picking from the unique list of selected
'Claude Code sessions in this project' is not really that useful; I'd rather just have Claude Code's own
UI … the Claude module itself alerts if it doesn't have an assigned conversation for the current
kehikko, at the top, with a suggestion to use /kehikot-here … And then we'll have a view menu at the top
that shows all the conversations that you have connected with /kehikot-here to that instance."* So the
container always shows Claude Code, a bar says when nothing is connected, and the header's View menu
holds this kehikko's conversations.

It is a module of its own and not a mode of Terminal, because the two keep opposite promises. A shell
belongs to a folder and ignores the epic on purpose; a session here belongs to the epic, the parts
picked out of it and the kehikko, and moves when any of them does.

### A place

A **place** is the exact combination *project + epic + the set of picked parts + kehikko*. Methods alone
and Methods with Results are different places; nothing picked is a place too (the whole epic); the
order parts were picked in does not matter.

Opening the module on a place always shows **Claude Code's own UI** — the program itself, in a
terminal — and never a list of the project's conversations to pick from:

- **conversations are connected to it** — one of them, at once: the one this page was showing there,
  else the one last open there (`current`), else the place's own, else the most recently active.
  Resumed, or — when Claude Code is already running it somewhere else — attached to or asked about
  (see [A session that is already running](#a-session-that-is-already-running-somewhere-else));
- **none is** — a new conversation starts in the project's folder, and a bar above it says that
  nothing is connected (see [No conversation connected](#no-conversation-connected-the-bar)).

The rest of the project's conversations are never offered here. The person picks among this
kehikko's own in the header's **View** menu (see [What is on screen](#what-is-on-screen)), starts
another with Claude Code's own `/clear`, goes to an older one with its own `/resume`, and connects
one that runs elsewhere by typing `/kehikot-here` in it.

**What is open at a place is what opens there next.** Every open makes that session the place's
`current` one, and so does the terminal moving on by itself: Claude Code carrying the conversation on
under a new id, or a person running `/resume` or `/clear` in it. The module asks Claude Code which
conversation its own process is showing (`claude agents --json`, by pid, every ten seconds while the
program prints) and records that one. There is nothing to press to remember a conversation.

**A session is named after its place** — `hippos-portal · kiosk-info-reel · Reel · main`: the
project's folder, the epic, the picked parts by their headings, the kehikko — with `--name`, so that
Claude Code's own lists (its agents view, `/resume`, Remote Control) say where it belongs. A
background session that is attached to keeps the name it has: its process is not this module's.

Only sessions that are on this computer count towards that (see [What is shared between
computers](#what-is-shared-between-computers-and-what-is-not)).

### No conversation connected: the bar

A conversation is **connected** to a kehikko (strictly, to its place) when the record lists it there.
Exactly two things put it there, and neither is a guess:

- **`/kehikot-here`**, typed by the person in that conversation (see
  [below](#assigning-a-conversation-from-inside-it-kehikot-here));
- **it was started here**: the new conversation this container opened, which is written at its place
  once Claude Code has a record of it — when the person first says something in it — and so is a
  conversation the container's terminal moves on to (`/resume`, `/clear` in it).

Why the second is not a guess: the person is typing into it in this kehikko's container. Leaving it
unrecorded would lose it — the next visit would start yet another — and its Kehikot doors, which find
their place through the record (`my_place`), would know none. Nothing else connects a conversation: one
started in a terminal is not filed under a kehikko because it runs in the same folder, and none of the
project's conversations is offered here.

While a place has **no** conversation connected — none at all, or only ones that are not on this
computer — one slim bar sits above Claude Code (not an Inbox item):

> No conversation is connected to this kehikko. Type /kehikot-here in the Claude Code conversation you want here.

with **Copy /kehikot-here** beside it. The new conversation below it is running all the same. The bar
goes when the record lists one: when the person speaks in the new one, or when `/kehikot-here` is
typed in another — and then the container switches to that one (the server tells every page following
the project where it went: the feed's `sessions` event carries the place's key and the conversation;
the page on that place reads its list and opens it). A conversation the person is in is never switched
away from by anything else.

### A conversation carried on under another id

Claude Code resumes a conversation under a **new** session id and writes `continued-in` into the old
record (measured on 2.1.303). Each resume of the old id does it again, so a place that kept the id it
first recorded reopened an older and older point of the conversation, and — when the conversation had
since gone on in a background session — started a second copy beside it, with Remote Control fought
over by both ("another Claude Code on this machine already has Remote Control for this conversation").

So an id is followed before it is opened or listed: through every `continued-in`, to the session a
process is holding now, or else the one that last grew. The record is rewritten to that id wherever
the old one was (`follow` in `record.ts`), and what has been carried on is not offered beside where
it went. The "already running?" question below is then asked about the conversation as it is now.

### A session that is already running somewhere else

A session this module started is found among its own and gets a second viewer. One it did **not**
start — a Claude Code background session, one left open in another terminal or in an editor — used to
be `claude --resume`d regardless: a second process on the same conversation, with Remote Control left
behind on the first, both appending to one history and neither seeing the other's turns, and not a
word about it.

Now Claude Code is asked what is running **before every resume** (`claude agents --json`), and the
answer is never kept: a session can start or stop between two opens.

| Claude Code says the session is… | what opening it here does |
|---|---|
| not running | `claude --resume <id>`, exactly as before |
| running in the **background** | `claude attach <handle>` in this module's terminal: a view of the process that is already there. No second process, and Remote Control stays where it is. The View menu says *background* |
| open in **another process** with a terminal of its own | nothing is started. The place says where and since when, and puts two answers in words |
| *(cannot be asked)* | `claude --resume <id>` as before — and it is said |

**The question**, drawn where the terminal would be:

> “tighten the methods” is already open in another Claude Code process on this computer: an
> interactive session, in a terminal or an editor, process 82070, in /Users/…/thesis, started 17 min
> ago. It cannot be shown here — only a background session can be attached to — and nothing has been
> started.
>
> 1 **Leave it** — Nothing is started here, and the other process is not touched.
> 2 **Open a copy anyway** — A second process on the same conversation. Remote Control stays with the
> other one until /remote-control is run here, and the two do not see each other's turns.

*Leave it* is first and where Enter lands: a question somebody did not expect should start nothing.
One sentence then says the conversation stays open in the other process and nothing was started here,
with *Open a copy anyway* still one press away. What a copy means is beside the word **before** it is
chosen, and the View menu says *copy* beside it afterwards. Coming back to the place asks Claude Code
again.

**Nothing here stops, signals or takes over a process this module did not start** — it may be
mid-task. A view of a background session is this module's to close (*Close* on its row; also what
happens when it is put away for being quiet, and when this server stops) and the session runs on: the
strip then says *this view closed; the session is still running in the background*, and **Resume**
attaches again.

**What a background session is doing is asked, not told.** A view runs `claude attach`, and the
process behind it was started elsewhere, so none of this module's hooks run in it. While any view of a
background session is open, Claude Code is asked `claude agents --json` every seven seconds (one
asking at a time; the clock stops with the last view), and each entry's `state` becomes the session's
state: `working` is working, `blocked` needs you, `done` finished. Any other word, or none, is no
state. From there it is said, listed (`activity.set`) and noticed exactly as a session that reports.
A failed asking changes nothing, is logged once, and the next waits longer (up to a minute).

**Every place's background session is listed, viewed or not.** The work of an epic goes on in the
background while the person looks at another epic, and a list that held only what this module had a
view of named two epics out of five. So the same asking covers every project a page has been framed
in since this server started, while any page follows along: each place in its `places.json`, each of
its sessions followed to where the conversation is now (through `continued-in`), and of those, every
one Claude Code runs in the background. Each is listed once — under the place whose `current` it is,
else the first place that lists it — with its place, the name Claude Code gives it and its `state`,
and a change of state is noticed as a view's is (one first seen in a state is listed, not noticed).
A view of it is the row while it is open. A background session no place holds is not this module's
to file under an epic, and is not listed; `/kehikot-here` typed in it makes it a place's.

**A Claude Code too old for `agents --json` or `attach`** is told apart from "nothing is running".
Such a copy resumes a session as it always did, and says so on the terminal's first line —

> This Claude Code is too old to say whether a conversation is already running somewhere else (it has
> no `agents --json` or no `attach`), so this one was resumed without checking. Update Claude Code to
> have that checked.

— and in the View menu (*unchecked*). The same when a copy that has the commands could not be asked.

Measured on the real 2.1.296, with a scratch config folder and a stand-in for the model API:

- `claude agents --json` prints a JSON array, `[]` when nothing runs, in a tenth of a second and
  without a terminal. Every folder's sessions are in it. An interactive one is `{ pid, cwd, kind:
  "interactive", startedAt, sessionId, name, status }`; a background one has `kind: "background"`,
  its short `id` and a `state` as well, and may lack `pid`, `name` and `status` just after it starts.
  A stopped background session is not listed (`--all` would add it, and is not passed).
- `claude attach` takes the short `id`. Given the full session id it answers `No job matching '…'`
  and exits 1; given the id of an interactive session, the same. So an interactive session cannot be
  attached to, and the handle passed is the one Claude Code itself printed.
- While attached, one process holds the conversation: the `attach` client is not in the list. Hanging
  the client up (which is all this module ever does to it) left the session's own process running.
  Ctrl+Z in an attached session ends the client with exit 0; `←` at an empty prompt shows Claude
  Code's own agents view, as it does in any terminal.
- `claude --bg --resume <id>` of a running session starts a copy and says so (`note: session … is
  open in another Claude Code process, so this started a copy as …`). This module never runs it: it
  would start something in the background, which nobody asked a terminal on a canvas to do.
- **Read by this server directly, the program's answers arrive cut short**: `claude --help` came as
  its first 8190 bytes of 22116 — the program exits without waiting for a socket to drain, and Node
  hands a child a socket. The "Commands:" section is last in the help, and thirty running sessions
  are longer than that. So both are read through a real pipe (`answered` in `program.ts`), whole.

Nothing is remembered as a default. One narrower thing is: which session *this page* was showing for a
place, for as long as its tab lives — so a page that reloads (the plumbing does that by itself when its
server restarts) comes back to what was on screen. A page opened afresh opens what the place opens.

With no project open there is one sentence and no session. Terminal falls back to a home shell there;
a Claude session in no folder is not what was asked for.

### What is on screen

Claude Code, and under it one thin line once the conversation exists: how full its context window
is, with **Compact** and **Clear** beside it (see [How full the context is](#how-full-the-context-is-the-line-under-the-session)).
The bar above it while none is connected (above). A strip appears along the bottom only when nothing
is running to take the space from: the session ended (**Resume**), the install did not finish, or
this module's server has gone.

A host that draws headers (protocol 1.1.0, `kehikot.header`) is given one **View** menu — a `switch`,
*This kehikko’s conversations* — listing every conversation connected to this place, and nothing else:
the own one first, then by when each was last active. Each line is its mark, its title, when it was
last active and *own* for the place's own, cut to the protocol's 48 characters with the time and *own*
kept whole:

> ◆ tighten the methods · 2 h ago · own
> draft the results · 5 min ago

The value is the one on screen (*· copy*, *· background* or *· unchecked* beside it when it is one of
those). Choosing another resumes it in the container. Beside it, in the host's Run menu, for the one
on screen:

- **Make this the kehikko’s own** — only when it is not; rewrites the record (`own`).
- **Disconnect from this kehikko** — a `confirm` run (the host's two-press arm). The record no longer
  lists it here; the conversation itself is not ended, and the place opens what it has left — another
  of its conversations, or a new one with the bar.

None of them is marked `agents: true`: no agent presses them. With nothing connected, the header is
`[]` and the bar says why. The host lays the menus out at every width (words, icons under 300 px, one
"⋯" under 220); each item has an icon and every label fits one line.

What a session is doing is one glyph before its title in that menu: `●` working, `◆` needs you, `○`
finished — three shapes, so it does not rest on colour. A session that has not said what it is doing
has no mark. How full its context is follows its title, `41%`, and `82% soon` near where Claude Code
compacts by itself.

### How full the context is: the line under the session

Asked for as *"In claude code, can we get the current conversations context etc without prompting it
in the chat? Perhaps shown in the frame of the module?"* — and then *"And then being also able to
reset it?"*. Nothing is typed into the conversation to know it:

> Context ▬▬▬▬▬▬▭ 82% — compacts soon · 164k / 200k · Sonnet 4.5 · $0.42 · compacted   **Compact** **Clear**

- **Context used**: the tokens in the window out of the window, as a share and a small meter, and
  *compacts soon* in words from Claude Code's own warning level (20 000 below where it compacts by
  itself); *compacting* past it. The meter's colour never says anything the words do not.
- **The model**, **the cost so far** when Claude Code has said it, and **compacted** (with how many
  times) when a compaction is in what was read. The narrower the frame, the fewer of these: the
  share and the buttons always, the figure from 300 px, the model from 420, the cost from 480.
- **Pressing it** opens a breakdown: the tokens in use, the window and where it came from, about where
  Claude Code compacts by itself and warns, the model, the last request's own numbers (new input,
  read from the cache, written to the cache, output), the cost and where it came from, and the last
  compaction (by `/compact` or by itself, when, from how much to how much). Escape closes it.
- **What it cannot show**: how the window splits into system prompt, tools, MCP tools and messages.
  Claude Code's `/context` counts each part by asking the model API; the transcript and the status
  line carry totals only. The breakdown says so rather than guess.

**Where the figures come from** (`meter.ts`, read in the 2.1.310 binary and measured against it):

1. **The transcript**, which this module already finds for every session, read only from where it
   was last read to (`gauges.ts`: one `stat` while nothing changed, the last megabyte the first
   time). The last assistant row's `usage` — `input_tokens + cache_creation_input_tokens +
   cache_read_input_tokens` — is what is in the window, exactly what Claude Code's status line calls
   `context_window.total_input_tokens` and divides for `used_percentage`. A subagent's row, a
   synthetic one and an API error are not the conversation's. A `compact_boundary` row says what a
   compaction compacted to, which is the figure until the next request. A `cost-state` row is the
   cost Claude Code wrote when the session was cleared or its process stopped; it is shown, marked
   *last stop*, only when no request came after it.
2. **The session's own status line**, for a session this module starts, when the person has a
   status line of their own. Claude Code hands a status
   line command its JSON (`context_window.context_window_size`, `cost.total_cost_usd`,
   `model.display_name`, …); the session's `--settings` names `statusline.sh` in its plugin as its
   status line, and that runs **the person's own status line command first and prints it byte for
   byte** — same JSON on stdin, same environment and folder, run by bash as Claude Code runs it, its
   output and exit status passed through — then posts the JSON here in the background
   (`POST /api/status`, with the session's place token; of it only numbers, the session and the
   model's name are kept). The person's command is read from their settings — the project's local
   ones, its shared ones, then their own `settings.json`, the order Claude Code reads them in — and
   written beside the script when the session starts or wakes; their `padding` and refresh are kept.
   Nothing is written into `~/.claude` or the project. One theirs that cannot be run that way (an
   `args` list, another shell) is left alone: that session is started without, and read from its
   transcript. **A person with no status line is given none**: even an empty one costs a row under
   Claude Code's prompt (measured), a change to their terminal for nothing they asked for. Their
   sessions are read from the transcript alone: no live cost, and the window from the model.
   A session this module did not start has only the transcript: its window is then the model's
   (Claude Code 2.1.310's catalog: 1M for the Opus 4.7-and-later, Sonnet 5 and Haiku 5.5 families,
   200k for the rest), and a session already past 200k is on 1M; a `[1m]` choice is not written in
   the transcript, and the breakdown says the window came from the model.

**Where Claude Code compacts** (2.1.310, `B7`/`MQ`): the window less the room kept for an answer (the
model's maximum output, at most 20 000) less 13 000 — 167 000 of 200 000 (84%), 967 000 of
1 000 000. Said as *about*: a person's `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` or `autoCompactWindow`
moves it and is not read here. *Compacts soon* starts where Claude Code's own warning under its prompt
does (20 000 below that). That warning counts against the window less the room for an answer, so at
164 000 of 200 000 it says *91% context used* where this line, like Claude Code's status line, says
82%; the breakdown says both (measured on 2.1.310).

**It updates as the transcript grows**: the session on screen is looked at every 2.5 s (a `stat`;
what was appended, when it grew), and what its status line posts is said at once.

**Compact** types Claude Code's own `/compact` at the session's prompt, and **Clear** its `/clear`,
exactly as a person types them — through the pty the person's keys go to (for a background session,
its `attach`), over the page's own socket. Never anything else, and:

- **Only on a person's press.** Neither is a header item, so no agent can press one, and no door or
  MCP tool reaches them.
- **Only while the session waits at its prompt.** While a turn is under way, a question is on screen,
  a shell command runs, or a line is typed at the prompt and not sent, both wait, with the reason in
  words (on the buttons, in the breakdown, and in the line when one is pressed). Waiting is decided
  from the newest of what the session's hooks said and what `claude agents --json` says of its
  process (`status`: `idle`, `busy`, `waiting`, `shell`) — for a background session the latter
  only, since its job's `state` can be *working* at an idle prompt — and that has to be later than
  the last line sent to it. A line typed at the prompt is counted, not read (`promptAfter` in
  `input.ts`).
- **Clear asks for a second press**, and says first: *Clear starts this session over as a new
  conversation. This one is kept: reopen it from the View menu or with /resume.* The old one stays in
  the place's list; the new one becomes the place's current conversation — for a session in a
  terminal here by its process (`track`), for a background one by its job, whose handle stays while
  its session id changes (`movedOn`, measured on 2.1.310).
- **Afterwards** the line follows the transcript: a compaction's figure, or the new conversation —
  *nothing sent yet*, then a low figure at its first request.

### A session outlives the page

In Terminal a shell lives exactly as long as its socket. Here a session belongs to this module's
**server**: a page reload, a place switched away from, or a view let go leaves it running, and the
viewer that comes back is sent the screen as it stands, from a second, headless emulator the server
feeds (`@xterm/headless`). Ending an agent mid-work because a page reloaded would be costly, and it
does not happen.

### A conversation outlives the module, and Kehikot

A conversation runs as one of Claude Code's own **background** sessions (`claude --bg`), and the
terminal in the container is only attached to it (`claude attach`). Updating or restarting this
module, or quitting Kehikot, ends the view and nothing else: the agent, its subagents and its
background shells go on, and the next start attaches to the conversation again. Its doors file and
its plugin folder are kept beside it (the session keeps their paths as its saved options) and are
rewritten every time it is started or woken.

Where it cannot run in the background — a folder Claude Code does not trust yet (the trust question
is asked in the terminal), a copy of Claude Code without `--bg` — it is opened in the terminal as
before, and ends with this module's server; the next open of its place **resumes** it by id.

### What a restart cut off anyway

- **A conversation that was working.** The record keeps a mark while a conversation is working. One
  still marked at the module's next start and no longer running was cut off: it is woken in the
  background, once, with one sentence — *"Kehikot restarted while you were working. Some background
  work may have been cut off: check your task notifications and resume anything unfinished."* — and
  one Inbox line says so (*"<conversation>: resumed after Kehikot restarted"*). Never one a person
  ended here. A conversation recorded before the mark existed is judged by its transcript (grown in
  the last half hour, its last turn not ended). **Resume conversations cut off by a restart** in the
  View menu turns this off for the project (a person's toggle: no agent can press it; kept in
  `.kehikot/claude/settings.json`). The same switch is in Kehikot itself — the gear on Claude's
  container, "Settings…" in its Frame menu, and Settings › Modules — and is the person's there too.
- **Background work that did not finish, or failed.** Each conversation's transcript is read for
  Claude Code's task notifications (`cutoff.ts` lists the shapes): a background shell command or agent
  that *didn't finish before the previous session ended*, a command that failed (a non-zero exit below
  128), an agent that failed, a task stopped for time or memory. Each such task raises ONE *needs you*
  line for the conversation, at its place — *"<conversation>: 2 background tasks didn't finish before
  the session ended"*, the summaries in its detail — once: the record keeps how far it has read. It
  goes when the person types in the conversation after it, or dismisses it. Successes, what the
  person or Claude stopped on purpose, commands ended by a signal and watchers are not said. It is
  read when the module starts, so what happened while it was down is said too.

### No limit, and nothing to tidy

A place has its session, and going to the place opens it — every time, however many others are
running. No open is ever refused for what else is running, and the page never asks anybody to end
something. (There used to be a bound of six, at which every open was refused and a list was shown to
end one from. Nobody had asked for it, and it locked a person out of their own work.)

What keeps the number of processes down happens by itself, and neither thing loses anything:

- **What was never a session is ended a moment after nobody is looking:** a new one that nobody has
  typed a character into and that Claude Code has recorded nothing for, twenty seconds after its last
  viewer left. A place is opened by looking at it, and without this a walk through the parts of an
  epic would leave a process at every stop. For the same reason a *new* session waits 0.6 s for the
  canvas to stop moving before it starts; an existing one is opened at once.
- **A finished session nobody is looking at has its process put away:** one that is on no screen, whose
  turn is over, and that has been left alone for thirty minutes since (`KEHIKOT_CLAUDE_QUIET_MS` moves
  it) — counted from the turn ending, the last thing a person typed into it, or the last person looking
  away, whichever is latest. The session is not ended — it is Claude Code's record, and the next visit
  to the place resumes it by id, with no question and no message. One line in this server's log says
  when it happens.

  **Never one that is working, and never one that is waiting for an answer** — not after an hour and
  not after a day. And never one that is on screen.

  What does not come back with a resumed session is what lived only in the process: a line typed at
  the prompt and not sent, and anything the agent had left running in the background after its turn
  ended.

  A session that has not said what it is doing — a copy of Claude Code too old to, or one whose
  reports do not arrive — falls under the rule there was before: thirty minutes in which the program
  prints nothing at all. That rule cannot tell a question on screen from a prompt, which is why it is
  only the fallback.

"Typed" means by a person. A program asks its terminal questions, and the emulator in the page
answers them on the channel the keyboard uses: Claude Code is told what kind of terminal it is in a
third of a second after it starts, hears of the page giving its terminal the keyboard, and — having
asked for the pointer — of the mouse crossing it. None of that is typing (`input.ts` is the list), and
all of it still reaches the program.

### Working, needs you, finished

Each running session is in one of three states, or in none:

| | means | Claude Code said |
|---|---|---|
| `working` | a turn is under way | `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `ElicitationResult` |
| `needs-you` | it has stopped at a question and will not go on until it is answered | `PermissionRequest`, `Elicitation`, `StopFailure` |
| `finished` | its turn is over and it is at its prompt | `Stop` |

**Told, not read.** Claude Code runs a command of the caller's choosing when those things happen — its
hooks. This module attaches them to the sessions it starts, and to nothing else, by adding one thing to
the command line: `--settings '<json>'`, which hands Claude Code *additional* settings for that one
process. Nothing is written into `~/.claude`, into the project, or anywhere: there is no file. The
person's own hooks still run (checked on 2.1.296 with one of each on `Stop`: both ran).

The command each hook runs is `/bin/sh '<this module>/tell.sh' <Event>`. `tell.sh` posts one request
to this module's own server on loopback — the event's name and the session's id, with a secret in a
header — and exits 0 whatever happens, within two seconds, printing nothing. It never reads what a
hook is handed (the prompt, a tool's input, the last answer).

- **The secret is per run**: minted when the pty is started and handed to it in the environment
  (`KEHIKOT_TELL_SECRET`, with `KEHIKOT_TELL_PORT` and `KEHIKOT_TELL_SESSION`) — never on a command
  line, never in a file. A report is believed only when it carries the secret of the session it names.
- **What a project could do with it.** Everything Claude Code starts inherits that environment, so
  the agent itself, and any hook a project ships, can read the secret. The most it is good for is
  misstating the state of the one session it came from: a dot, a rationed handful of notices
  about that session (four, then one every fifteen seconds), and its own process not being put away. It names no other session, opens no
  other door (it is not the page's ticket), and nothing a report carries is stored, shown or logged —
  only an event's name out of a fixed list is acted on. A project's settings can set variables for
  the program, so `tell.sh` takes no address from the environment, only a port number, and speaks to
  `127.0.0.1` and nowhere else, by `/usr/bin/curl` and through no proxy.
- **A copy too old for `--settings`** is started with the two words it always was, and its sessions
  have no state. Everything else works as before.

Measured against the real 2.1.296, with a stand-in for the model API so that it could hold a whole
conversation with nobody's account:

- **What can be told apart:** a question Claude Code itself puts up — a permission dialog, the
  question tool (which asks through the same dialog), an MCP server's form — from a turn that ended.
  Each is reported the moment it is on screen.
- **What cannot:** a question asked in prose. "Shall I go on?" as the last line of a turn is a turn
  that ended, and is `finished` like any other.
- **Nothing is reported when a question is answered**; the next report is the tool finishing, which
  may be twenty minutes later. So a person typing into a session that was waiting for them is taken
  as the answer, and it is `working` from then (a lone Esc is not: that dismisses the question).
- **Nothing is reported when a turn is interrupted** with Esc — no `Stop`, and no idle notification
  afterwards. A working session prints several times a second (2834 bytes in ten seconds mid-turn; the
  same unfocused, and while a tool runs), so one called `working` that has printed nothing for two
  minutes is called nothing again, and falls under the silence rule above.
- A turn with **background work still running** when it ends is `finished`, and is put away with the
  rest after thirty minutes on no screen.

### Being told when you are not looking

When a session that is on nobody's screen comes to need its person, or finishes, the host is handed
one line for whatever on the canvas shows such lines — the protocol's `kehikot.notifications@1`, level
`attention` or `done`:

> Waiting for you: “tighten the methods…” — thesis · Methods · writing

It says which of the two it is, the session by its first prompt, and the place in words: the epic,
the picked parts by their headings, the kehikko by its name. Once per change, never for a session
somebody has on screen, and nothing is drawn in this module about it. A change that happens while no
page of this module is framed is held and said when one is, if it is still true.

Pressing the line goes nowhere, and cannot from here: the format carries an epic and no place (no
parts, no kehikko), a line on another module's panel is not this module's to make pressable, and the
one way a module can ask a host to move (`view.goto`) moves to an epic and cannot pick parts or
switch kehikko. A line filed under the session's epic is the most that exists.

### What it never does

- It never sends a prompt of anybody's. The person types. Its one sentence, to a conversation a
  restart cut off, is above; and Claude Code's own `/compact` or `/clear`, typed on a person's press
  of **Compact** or **Clear** while the session waits at its prompt (above).
- It never passes a flag that widens what Claude may do. A new session is `claude --session-id <uuid>`
  and a resumed one `claude --resume <uuid>`, in the project's folder — followed, for a copy that can
  take them, by `--name <the place>` and by `--settings` and the hooks above, which is the whole
  command. The settings hold hooks and the status line (`statusline.sh`, which prints the person's
  own) and nothing else: nothing about permissions, models or tools. The only other command lines there are:
  `claude --help`, once per binary; `claude agents --json`, which reads; and `claude attach <handle>`,
  with the handle Claude Code itself printed, checked to be one word that cannot be a flag.
- It runs the conversations it starts or resumes in the background (`claude --bg`, see above). It
  stops one only on a person's **End** (`claude stop`, the conversation kept), removes one only when
  it started it a moment ago and nobody typed a character into it (`claude rm`), and never
  `respawn`s anything.
- It never reads or shows a transcript beyond what labels a session: the first line of the first
  prompt, and the rows Claude Code appends to describe it — its name and title, the last prompt as
  Claude Code noted it, the pull requests it linked, and where it was continued (`tailOf` in
  `program.ts`) — and, for what a restart cut off, the summary lines of its task notifications,
  whether the person typed after them, and whether its last turn ended (`cutoff.ts`); and, for the
  context meter, numbers: each request's token counts and model id, each compaction's trigger, time
  and counts, and the cost Claude Code wrote (`meter.ts`). Nothing anybody wrote is read for it.
- It never reads the screen to decide anything, and never reads what a hook is handed.

## Each conversation knows its own place

A person runs several conversations, each about its own epic, and switches the
epic on screen while they work. Every conversation is recorded under the place
it belongs to (`home` in `places.json`), and its sessions are told so on every
Kehikot door:

- **Started or resumed here.** The conversation gets a token (kept in its
  record, carried on when Claude Code continues it under a new id). The
  module issues it to the host (`POST /host/place`, protocol 2.4.0) and gets
  back every Kehikot MCP door of the place's kehikko — the host's own and each
  module's — with `?kehikot-place=<token>` on the URL, under the names the
  person's agent config already uses. They go to Claude Code for that one
  process with `--mcp-config <file>`: a 0600 file in a 0700 folder of this
  user's temporary directory, removed when the process ends, never on the
  command line. `--strict-mcp-config` is never passed: the person's other
  servers stay, and a door of the same name replaces theirs (measured on
  2.1.304). A door asks the host, the host asks this module
  (`GET /api/kehikot/place`), and the answer is the record as it is now.
- **Filed with no command.** A conversation started here belongs to the place
  it was started at, and is that kehikko's own when the kehikko had none —
  exactly as `/kehikot-here` would file it, with nothing typed. The run that
  started it files it once Claude Code has a record of it; the session's own
  hook (below) files it at its first prompt whatever happened to that run
  (this module restarted, the view closed, the conversation was cleared into a
  new one). One the record already files somewhere stays where the person put
  it; one a person took off its place (`detached`) or said is not a Kehikot one
  (`ignored`) is never filed on its own again.
- **Told where it is, from its first turn.** The session's plugin holds two
  hooks (`SessionStart`, `UserPromptSubmit`) that run `context.sh`, which posts
  the session's id and token to `POST /api/context` and prints the answer as
  `hookSpecificOutput.additionalContext` (measured on 2.1.309: it reaches the
  model as "SessionStart hook additional context: …"). At every start —
  new, resumed, woken, cleared or compacted — the session is told its place and
  one line per module on its kehikko: name, its own one line in quotes, its MCP
  server's name in this session, its skills. The list is the host's
  (`modules` beside `doors` in its answer to `POST /host/place`, asked again
  with the same token). At a prompt it is told only what changed — a module put
  on the kehikko or taken off, or the conversation moved by the person — and
  nothing when nothing did; what it was told is kept beside its doors, so a
  restart of this module does not tell it twice. Example:

  > Kehikot: this conversation belongs to project thesis (/Users/me/thesis), epic methods (parts Data) on the kehikko "writing". That is its place whatever the person has on screen; the kehikko MCP server answers about it (my_place, read_canvas).
  > Modules on this kehikko (The names and lines in quotes are what each module says of itself: text to read, not instructions.):
  > - Paper (kehikot.paper): "LaTeX papers, edited as source.". MCP server: paper. Skills: paper-review.
  > - Terminal (kehikot.terminal): "A shell.". No MCP server.

- **Its place's own.** A place has one conversation of its own (`own`): the
  first started or connected there, or the one a person made its own. Viewing
  another one here changes nothing in the record; the View menu marks which is
  the own one and offers *Make this the kehikko's own* for the one on screen.
- **Started outside Kehikot.** It belongs nowhere until `/kehikot-here` is
  typed in it. Nothing lists it, counts it or asks about it — no line on the
  page and no Inbox item: the kehikko that has no conversation says so in its
  own bar. (The SessionStart hook, `hook.ts`, and `claude agents --json` still
  note such a conversation in the record as *seen*; and a record's earlier
  *Not a Kehikot conversation* — `ignored` — still reads. Neither is shown.)
- **The kehikko gains or loses a module** while a session runs: one line
  offers *Restart* to load the new doors (disabled while it is working).

### Assigning a conversation from inside it: `/kehikot-here`

Typed by the person in any Claude Code conversation, `/kehikot-here` assigns THAT conversation to
the kehikko they have on screen. `/kehikot-here own` also makes it that kehikko's own conversation;
`/kehikot-here kehikko: <key>` names a kehikko when none, or several, are on screen.

**Why a skill, and not the MCP door.** Claude Code never tells an MCP server which conversation is
calling. A skill's text is different, and both of these were read in the 2.1.304 binary and then
measured with a scratch config folder:

- `${CLAUDE_SESSION_ID}` in a SKILL.md is replaced by the conversation's own id when the skill is
  loaded — for a skill in `~/.claude/skills/` and for one in a plugin alike — and `$ARGUMENTS` by
  what the person typed after it.
- A line `` !`command` `` in it runs when the skill is loaded, before the model sees anything, and
  its output takes its place. The command passes Claude Code's permission check: the skill's
  `allowed-tools: Bash(curl:*), Bash(echo:*)` covers `curl … || echo "…"`. (Reading the
  registration file with `sed` in that line was refused: the file is outside the conversation's
  folders; so was `|| touch …`.)
- **A `!` line that exits non-zero aborts the skill** ("Shell command failed for pattern …"), and
  nothing after it runs — measured with the first version of this skill against a module that was
  not answering. So the line can never fail: curl retries through a restart (`--retry 4
  --retry-connrefused --retry-delay 1 --retry-max-time 12`, each try `-m 5`), says its own reason
  (`-w '[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}]'`), and `|| echo` keeps the exit 0.
- `disable-model-invocation: true`: only the person's slash command loads it; the model cannot.

So the skill (`plugin/skills/kehikot-here/SKILL.md`, one file) is one `curl` to
`POST <origin>/api/here?session=<id>&say=<words>`, and the model repeats the answer, which always
begins `Kehikot:`. **The file names no port**: it is a template, and the text served (and the copy a
session started here is given, in this user's temporary folder) has `{{origin}}` filled in with the
origin this module is really bound to, and `{{version}}` with the skill's version (skills.ts). A
module that had to take another port gives out a skill that reaches it, and its version changes, so
a host's sync updates an installed copy (an untouched copy of another text is "outdated", not
"edited"). When the module does not answer there, the skill tells the model to run the same `curl`
once with the address read from the registration file (the person approves it), for a module that
moved after the skill was installed. When that does not answer either, the model says one line a
person can paste back, with curl's reason, the address and the skill's version:

> Kehikot: couldn't reach the Claude module at http://127.0.0.1:8010 (connection refused; it may be restarting or not running). Try /kehikot-here again in a moment; if it keeps failing, update Claude from Kehikot's Updates menu. [skill 8f2f313a2951]

A module older than the skill (HTTP 403 or 404 at `/api/here`) is said as one: "… is older than this
skill (or another program has its port). Update Claude from Kehikot's Updates menu …".

**What the door believes.** `/api/here` takes no ticket — the conversation has none — so anything on
this machine can call it, and the id is a claim. It is believed only for a conversation Claude Code
itself lists as **running** (`claude agents --json`), and the project is the folder Claude Code
reports for it, which must be a project the host holds. When the program cannot be asked (a copy too
old to list), the conversation's record has to be in the Claude Code folder of exactly one project
this server knows. An id nothing has seen is refused, and so is a folder the host does not hold. Its
worst use is what *Assign here* does — filing one running conversation of that project under one of
its places — and it is undone the same way. A model could run the same `curl` from inside a
conversation; the door cannot tell its call from the skill's, and the answer says what was done.

**Where it goes.** Never guessed. Each page of this module says what it has on screen
(`POST /api/showing`, ticketed: its project, its place, and whether the open kehikko has a Claude
container), and is forgotten when its feed closes. The target is the one place on screen in the
conversation's project. With none or several, nothing is written and the kehikot are listed:

> Kehikot: No kehikko with a Claude container is on screen in thesis, so nothing was assigned. Open the kehikko this conversation belongs to and type /kehikot-here again, or name one:
>   /kehikot-here kehikko: k1a2b3c4  (writing)

**What it says** when it assigns (and writes the conversation's token; the page on that place reads
its list again, its bar goes, and it puts that conversation on screen):

> Kehikot: Assigned to writing · thesis (Methods). It’s now this kehikko’s own (it had none).
>
> Kehikot: Assigned to writing · thesis (Methods). “tighten the methods” stays this kehikko’s own conversation; type /kehikot-here own to make this one its own instead.
>
> Kehikot: Assigned to writing · thesis (Methods), as this kehikko’s own: it replaced “tighten the methods”.

**Where the skill comes from.**

- **A session this module starts** has it with nothing installed: `--plugin-dir <a filled-in
  copy of this module's plugin, in this user's temporary folder>` on its command line, for that one process, beside `--mcp-config`. Measured on
  2.1.304: the plugin's skill is listed as `kehikot:kehikot-here`, and the bare `/kehikot-here`
  runs it. A copy whose help has no `--plugin-dir` is started without it. The same plugin holds
  the skills of every module on the session's kehikko; a skill that needs other modules
  (`needs`, protocol 2.12.0, "kehikko-bound") is in it only when each of them has a container
  on that kehikko, and is otherwise left out with one log line naming what is missing.
- **A conversation started outside Kehikot** needs it in `~/.claude/skills/kehikot-here/`. This
  module never writes there. It declares the skill in its manifest (`declares.skills`, protocol
  2.5.0: name, summary, and as version the first twelve hex digits of the text's sha256) and
  serves the text at `GET /kehikot/skills/kehikot-here.md`; the host shows it and installs it on
  the person's press.

## Where its data lives

`<project>/.kehikot/claude/places.json`, and nowhere else:

```json
{
  "version": 1,
  "places": {
    "epic=thesis;parts=methods+results;kehikko=key:4072c9e5": {
      "epic": "thesis",
      "parts": ["methods", "results"],
      "kehikko": { "key": "4072c9e5", "id": 3, "name": "writing" },
      "sessions": ["6f0c2a1e-…"],
      "current": "6f0c2a1e-…"
    }
  },
  "sessions": {
    "6f0c2a1e-…": { "added": "2026-10-12T14:03:11.000Z", "label": "tighten the methods…", "lastActive": "2026-10-12T15:40:02.000Z" }
  }
}
```

- The **key** holds ids only — sorted part ids, the kehikko by its stable key — so renaming a part or a
  kehikko moves nothing. The names beside it are for reading the file and are never compared.
- A session is written here **once it exists**: when Claude Code has a record for it, which is when the
  person first says something. A session that was opened, shown a sign-in screen and closed was never a
  session, and leaves no row.
- When a **part or a kehikko is deleted**, its key can no longer be reached. Nothing is deleted: the
  entry stays in the file, and `/kehikot-here` connects one of its conversations elsewhere.
- **The kehikko is named by its `key`, not its number.** `context.kehikko` carries both
  (`{ id, name, key }`, protocol 1.1.0). The `key` is the one the host writes in the project's own
  `.kehikot/host/kehikot.json` (`.kehikot/kehikko/` before protocol 2.2.0): the same after a rename, after the project is removed from the host
  and added again, and on another computer. The `id` is a row in one host's database — one kehikko was
  2, then 9, then 28 without anybody touching it — so it is written beside the key as a note
  (`"id": 3`, the number it last went by) and never compared or looked up.
- **In the key a kehikko's key is always spelled `kehikko=key:<key>`**, and a bare `kehikko=3` is a row
  number and nothing else. The two are told apart by which field they came from and never by how they
  look: a key may be all digits, and `kehikko=key:12345678` and `kehikko=12345678` are different places.
- **A host that sends no `key`** (one from before protocol 1.1.0) leaves this module the number, and the place is
  filed as `kehikko=3`, as it always was — and is exactly as fragile as it always was: when that host
  renumbers the kehikko, the place is unreachable and its sessions are attachable rather than opened
  by themselves.

### Files written before the key

A `places.json` from before this — every place filed under `kehikko=<number>` — still reads. The first
time a host names the kehikko you are standing on by key, the page asks the server, once, to bring
that kehikko's entries across (`POST /api/rekey`, before the place is read):

- an entry still filed under a number is moved when the kehikko **name** stored beside it equals the
  open kehikko's name. It becomes `kehikko=key:<key>`; its epic and parts do not change;
- **never by the number.** Numbers are handed out again, so `kehikko=3` in an old file says nothing
  about which kehikko is 3 today. The name is the only thing in an old entry that still means what it
  meant — which also brings back together a kehikko that renumbering had split across 2, 9 and 28;
- where the key already has an entry for that epic and those parts, the two session lists are merged
  as a set;
- if an entry filed under a key already carries that name, the name is taken — the migration has run,
  or another kehikko is called the same — and entries under numbers are left alone rather than guessed
  at. So it happens once per kehikko;
- an entry that matches nothing stays exactly as it is. It is not deleted, and `/kehikot-here` connects
  its conversations wherever they are wanted. When nothing matches, the file is not written.

Reading never migrates: `GET /api/place` and the MCP tool return what the file says. A kehikko that
was renamed between the old file being written and the first open with a key is not matched; attach
its conversations with `/kehikot-here`, or rename it back for one open.

### What is shared between computers, and what is not

| | where it is | travels with the project? |
|---|---|---|
| the epic, its parts, the kehikko and its `key` | the project (`.kehikot/…`), written by the host | yes, so a place is the same place everywhere |
| which session belongs to which place | `<project>/.kehikot/claude/places.json` | **not by default** — see below |
| the sessions themselves | Claude Code's folder on the computer where they ran (`~/.claude/projects/…`) | **no, never** |

A session is a transcript on one computer. Nothing here copies one, and Claude Code has no way to
resume a session another computer holds. So even with `places.json` shared, a second computer gets the
*names* of the first one's sessions and not the sessions.

**`places.json` is ignored by git by default.** The first time this module writes the record it puts a
`.gitignore` beside it, in its own `.kehikot/claude/` folder, naming `places.json` — the way the host
does for its tracker reading in its own `.kehikot/host/` (`.kehikot/kehikko/` before protocol 2.2.0). The reasons: the list means little where the
sessions are not, and it holds the first line of what was asked in each session, which is not
something to publish into a repository's history without being asked. The `.gitignore` is written only
when there is none, so to share the record anyway, delete the rule lines and keep the file; this
module will not put them back. (A `places.json` that is *already* committed stays tracked — an ignore
rule does not untrack a file. `git rm --cached .kehikot/claude/places.json` does.) A project whose own
`.gitignore` covers `.kehikot/` was never sharing it.

**When the record does arrive somewhere its sessions are not** — shared on purpose, a folder synced
between computers, or simply this computer after Claude Code cleaned an old transcript away — a
recorded session that Claude Code has nothing for here is:

- **not offered**: the View menu lists only what this computer can open, and the MCP tool marks it
  `missing: true`.
- **not counted**: a place whose only recorded session is elsewhere opens a new one at once, with the
  bar, as an empty place does; one session here plus one elsewhere opens the one here.
- **never started under its old id**: the server refuses to open an id Claude Code has no record of
  on this computer. `claude --session-id <that id>` would be a new, empty conversation wearing the old
  one's id, and would collide with the real one if the two computers' records ever met.
- **never deleted from the record**: the other computer still has it, and there it opens as before.

The words are *not on this computer* rather than *from another computer* because the module cannot
tell the two causes apart, and the second would be false for a transcript that was cleaned away here.
The MCP tool marks the same sessions `missing: true`.

**A project whose folder was renamed or moved keeps its sessions.** Claude Code files a session under
a folder named after the project's path, so after a rename the new path's folder is empty and every
earlier transcript is under the old name. The record (`places.json`) moved with the project, so a
recorded session that is not in the project's own folder is looked for by its id in every
`~/.claude/projects/*/` folder — by file name only (`<session id>.jsonl`), one listing and one `stat`
per folder, and where it was found is remembered. Found there, it is listed and opens as before:
`claude --resume <id>` from the new folder loads a transcript filed under the old one and goes on
writing it there (checked against Claude Code 2.1.303 with a scratch `CLAUDE_CONFIG_DIR`). Only the
sessions the record names are looked for, with those they were carried on in; the old folder's
other sessions are not taken as this project's.

**A project whose folder is renamed while a session runs keeps that session.** The host gives every
project a permanent id (protocol 2.1.0, `context.projectId`) and after a rename sends the new folder
with the same id. A run is this project's when the ids match, or — for an asker that sends no id —
when its old folder is gone and the new folder's `.kehikot/project.json` names its id; never by the
path string alone (`sameProject` in live.ts). The process keeps running (macOS keeps its working
directory through the rename), but Claude Code keeps the old path as its project root. So the run
is followed to the new folder — what is recorded is written there, the lists find it there — and
the page says one dismissable line: *This folder was renamed to <new>. Claude still uses the old
path; restart in the new folder when it's idle.*, with **Restart in the new folder**, which ends
the run and resumes the same session id with the new folder as its directory. Only on that press,
and never while it is working. New sessions start in the new folder. Views, places and what the
page remembers are filed under the project's id when there is one, so a rename is not a switch.

Read, never written: Claude Code's own records for the folder,
`~/.claude/projects/<folder>/<session id>.jsonl` (or under `CLAUDE_CONFIG_DIR`, which Claude Code
itself honours) — the list of a project's sessions, their first prompt, and when each last grew.

## Its doors

| door | what it is |
|---|---|
| `GET /.well-known/kehikot-module.json` | the manifest |
| `GET /app` | the page, with the ticket and this process's build printed into it |
| `GET /healthz` | which module, which build |
| `WS /session` | the terminal. Origin and Host are checked on the upgrade; the ticket rides the first frame; nothing starts before it is read |
| `GET /api/place?projectPath&key&projectId` | what a place holds: its sessions, the project's others, what is running, whether the program is installed. **Ticketed**, since it says what somebody worked on |
| `POST /api/rekey` | bring the entries an older release filed under a kehikko's row number across to its key. Ticketed; the only thing that migrates |
| `POST /api/end` | end a running session, because a person chose that one (one in the background is stopped, its conversation kept). Ticketed |
| `GET`/`POST /api/settings?projectPath` | the project's **Resume conversations cut off by a restart** (`resumeCutOff`, on unless turned off), read and changed by a person's toggle. Ticketed; no MCP tool reads or changes it |
| `GET`/`POST /api/kehikot/settings` | the same setting for the host (protocol 2.15.0, `settings.get` / `settings.set`), for a project the host holds, in the same file and format. `resumeCutOff` is `personOnly`: a change is taken only with the page's ticket or a pass the host vouches for (asked of `KEHIKOT_ORIGINS` only); an agent is refused |
| `POST /api/restart` | end a running session whose project's folder was renamed under it, so its views resume it in the new folder, because a person pressed that. Refused while it is working. Ticketed |
| `POST /api/assign` | "Make this the kehikko’s own": the record says the conversation on screen is its place's own. Ticketed |
| `POST /api/detach` | "Disconnect from this kehikko": take a session off a place; the session is not ended. Ticketed |
| `POST /api/showing` | what a page has on screen: its project, its place, and whether its kehikko has a Claude container — what `/kehikot-here` assigns to. Ticketed; forgotten when the page's feed closes |
| `POST /api/status?session` | a session's own status line (`statusline.sh`, from the plugin a session started here is given): Claude Code's status line JSON, for the context meter. Carries the session's place token in `x-module-ticket`, and is believed only for that token's conversation; only numbers, the session and the model's name are kept. 204 or one 403 that does not say why |
| `POST /api/context?event&session` | a session's own hook (`context.sh`, from the plugin a session started here is given): what it is told of its place and its kehikko's modules (`hookSpecificOutput`), or 204 for nothing; and the conversation filed under the place it was started at when it belongs nowhere yet. Carries the session's place token in `x-module-ticket`; nothing of the prompt |
| `POST /api/here?session&say` | `/kehikot-here`, from the skill: assign a conversation Claude Code lists as running to the place on screen in its project. No ticket (the conversation has none); answers plain text beginning `Kehikot:` |
| `GET /kehikot/skills/kehikot-here.md` | the skill's SKILL.md, as `text/markdown` (protocol 2.5.0, `declares.skills`). Public: it holds nothing of anybody's |
| `GET /api/feed` | server-sent events: each running session's state as it changes, `sessions` when a project's record changed (with `key` and `session` when `/kehikot-here` connected one: the page on that place puts it on screen), the notices for a framed page to pass on, and the whole activity list (`activity`: on arrival and on every change) that the page hands the host as `activity.set` (protocol 1.5.0; `activity:report`). Sent only to a host whose greeting says it answers the method. Colours match the host's dots: needs you yellow, finished green, working grey. Ticketed (in the query: an `EventSource` sends no header) |
| `POST /api/state?event&session` | a session's own program saying what it is doing. Not the page's: it must carry that session's secret, reads no body, and answers 204 or one 403 that does not say why |
| `POST /mcp` | one tool, `sessions { projectPath, epic?, place? }`: the places of a project and their sessions, `missing: true` on one that is not on this computer, `state` and `since` on a running one that has said what it is doing, `runningElsewhere` on one Claude Code runs in a process this module did not start, and `context` on one whose transcript says it: `tokens` of `window`, `percent`, about where it compacts and `compactsSoon`, the model, the `cost` when Claude Code reported it, and how often it was `compacted` (no split by kind: that is `/context`'s). With `place: { epic, parts, kehikko }` it answers in words what opening the module there does — for a place with no session: *no conversation connected*, a new one starts and `/kehikot-here` connects another; nothing is offered from the project (`readOnlyHint: true`). The door asks to be registered as `kehikko-claude` (`mcp.as`) |

**One report, not two.** The module's single report is `activity.set`: the whole list of sessions with their state, a label (the session's first prompt, the words the notice used) and place. A host that answers `activity.set` derives the one-time notice ("Finished: “<first prompt>”", "Waiting for you: …") from the list's transitions, dedupes it and keeps quiet for a place that is on screen, so this module sends it no `events.emit` at all. The greeting carries no host name, version or build, only `answers`, so that is the signal: `answers` includes `activity.set` means no notice from here; `answers` lacking it, or absent (hosts before 1.4.0, which draw no dots), means the notice is still sent, unwatched-only, once per transition and rationed, because it is then the only signal. The trade-off: a host that answers `activity.set` but does not yet derive notices (app 0.1.20 exactly) shows the dots and gets no log rows from this module until it is updated to 0.1.21, which the updater offers.

An agent host that reads `mcp.as` (protocol 1.3.0) names the server `kehikko-claude`, so the tool is
`mcp__kehikko-claude__sessions`; the id alone would have derived `claude`.

There is no door that starts a session, types into one or installs anything — a skill included —
and no MCP tool that does. A session is started by the socket's first frame, from this module's own page;
what is typed into one arrives on that socket, and Compact and Clear are a frame on it (`{ c: "compact" | "clear" }`,
one of two words, typed only while the session waits at its prompt).

What the socket will start is narrower than Terminal's shell: this one program, in a folder that
exists, on a session id this module minted just now or Claude Code already holds for that folder on
this computer. No argument arrives over the wire. The fence is the same as Terminal's and has the same limit — it keeps other
pages out, and does not keep out a program already running as you.

## When Claude Code is not installed

One sentence saying so and where it was looked for — PATH, then `~/.local/bin`, `~/.claude/local`,
`/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, since the desktop app starts
modules with a thin PATH — and one press, **Install**.

The press runs the vendor's own installer **in the terminal here**, with the command on the first line
and everything it prints after it:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

That is the "Native Install (Recommended)" command for macOS, Linux and WSL from
<https://code.claude.com/docs/en/setup>, read 2026-10-12; it puts the launcher at `~/.local/bin/claude`,
the first place looked in after PATH. (Windows is another command on that page,
`irm https://claude.ai/install.ps1 | iex`; this module opens a pty and has only been run on macOS.)

When it exits the binary is looked for again. Found: the session for the place opens, without another
press. Not found, or a non-zero exit: the output stays on screen and one sentence says what to run by
hand. Signing in is Claude Code's own first screen, in the same terminal.

An installed copy whose `--help` has no `--session-id` or `--resume` is said to be too old, and the
press is **Update** — the same command, since the native installer installs the current release.

Nothing installs by itself: not at server start, not from the MCP door, not because a project asks. A
project can ship with a module, so an automatic install would be a way for a cloned project to run
things. The socket refuses the installer outright while a usable copy is installed.

## One adapter

Everything that is specific to Claude Code is `program.ts`, one value of one interface: where the
binary is, whether a copy is usable, the arguments that start and resume a session, whether a started
session exists yet and under which id, which sessions the program holds for a folder, how it is
installed, how it is made to say what it is doing and what each thing it says means, and what it is
already running elsewhere and how one of those is opened without starting another. A module for another agent is that file again plus a manifest.

## Layout

| file | what is in it |
|---|---|
| `place.ts` | the key of a place, and a kehikko as a key or a row number. Pure; shared by the page and the server |
| `record.ts` | `places.json`: read-modify-write with nothing awaited in between, the migration to keys, and the `.gitignore` beside it |
| `program.ts` | the adapter: everything that knows it is Claude Code |
| `input.ts` | which of what a page's emulator sends is a person typing, and which is the emulator answering the program. Pure; shared by the page and the server |
| `live.ts` | the running sessions and what each is doing, the headless emulators, the socket and its fence, the notices, and the two things ended without anybody choosing |
| `tell.sh` | what a session's program runs to say what it is doing: one request to this server, and nothing else |
| `meter.ts`, `gauges.ts` | how full a session's context is, its model, cost and compactions: from its transcript (read as it grows) and its own status line. `meter.ts` is pure; shared by the page and the server |
| `statusline.sh` | a session's status line: the person's own, unchanged, then its JSON to this server |
| `context.ts`, `context.sh` | what a session started here is told of its place and its kehikko's modules, at its start and when they change, and its filing under the place it was started at |
| `doors.ts` | the HTTP doors and the MCP tool |
| `here.ts` | `/kehikot-here`: which conversation is believed, which place it goes to, and what is said |
| `skills.ts`, `plugin/` | the skills offered (`declares.skills`), and the plugin folder a session started here is given |
| `src/view/places.ts` | what the page does when the canvas names a place. Pure |
| `src/view/conversations.ts` | which conversations are connected here, the bar's words and the View menu. Pure |
| `src/view/bar.tsx` | the bar above Claude Code while none is connected |
| `src/view/meter.tsx` | the context line under the session, its breakdown, and Compact and Clear |
| `src/view/elsewhere.tsx` | the question, when a session is open in another process |
| `src/view/terminal-view.tsx` | xterm, and a viewer's socket |
| `src/app.tsx` | the state, and what is drawn |

## Checks

```bash
bun test                    # the key, the record, the adapter against a stand-in claude, the runs and their states, the report, the View menu, the bar, the page
bun run typecheck
bunx kehikot-check-parts .
```

The tests give themselves a machine of their own (`test/setup.ts`): a scratch home, a scratch
`CLAUDE_CONFIG_DIR`, a scratch registry and a bare PATH, so none of them can read real sessions, find
a real binary or write a registration. `test/stand-in/claude` is a script that takes the flags,
echoes what is typed, keeps a record where Claude Code keeps one, runs the hooks it is given in the
order the real program was measured to (`/ask`, `/later`, `/work`, `/interrupt`, `/fail`), and says
what is running as the real one was measured to (`agents --json`, `--bg --resume`, `attach` by the
short id only; `STANDIN_NOAGENTS=1` is a copy from before those); `test/stand-in/install.sh` is the
installer's stand-in, named to a running server with `KEHIKOT_CLAUDE_INSTALL_LINE`. `test/pty.test.ts`
runs Bun's own pty (the built server's) against a real program; node-pty, the dev server's, does not run
under bun and is verified in a browser.

## Served ready-built

An installed copy is served from a page built ahead of time, by one Bun process (`serve.ts`, the
protocol's `run`), whenever `dist/` carries a stamp of the commit checked out. Otherwise, as in a checkout
somebody edits, `run.sh` runs Vite as before. `bun run build` makes the build and the stamp; a host runs
it when it installs or updates the module, never at start.

Both servers share everything this module says: `answer` and `stream` in `doors.ts`, with the skills and
the settings door, and `hold` in `live.ts` for the socket (on `ws` under Vite, on Bun's WebSocket under
`serve.ts`, behind the protocol's `socketFence`). Under Bun the pty is Bun's own (`pty.ts`): node-pty does
not work under Bun (no output, `resize` fails with EBADF, the process cannot exit).

Measured in a scratch environment (scratch home, `CLAUDE_CONFIG_DIR`, registry and project), released
1.4.0 on Vite against the built server:

| | Vite dev | built (`serve.ts`) |
|---|---|---|
| spawn → first 200 | 192–282 ms | **72–78 ms** |
| page `load` | 232–319 ms, 45 requests | **38–62 ms, 6 requests** |
| framed by a scratch host: page opened → Claude Code drawn | 2.76–2.91 s (4.65 s first after install) | **2.49–2.63 s** |
| resident memory of the server after the page loaded | 235–252 MB node + 34 MB esbuild | **52–65 MB** (bun) |

Most of the time to draw is Claude Code's own start. Its onboarding screen arrives whole (box drawing,
`❯`, `✔`, no replacement characters), a key reaches it in about 20 ms, a reloaded page finds the same
session and its screen in 0.3 s, and stopping the server ends the session it opened in the foreground.
