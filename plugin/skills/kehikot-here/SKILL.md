---
name: kehikot-here
description: Assign this Codex conversation to the kehikko on screen in Kehikot. Only a person runs it, by typing $kehikot-here (add "own" to make it that kehikko's own conversation, or "kehikko: <key>" to name one).
---

The person typed `$kehikot-here` to assign THIS conversation to the kehikko they have on screen in Kehikot. SAY is the words they wrote after `$kehikot-here` — `own`, `kehikko: <key>`, both, or nothing.

1. Run this one command with your shell tool, once, asking to run it outside the sandbox (`sandbox_permissions: "require_escalated"`, justification: "Tell Kehikot on this computer which conversation this is"): it talks to Kehikot's Codex module at 127.0.0.1, which the sandbox blocks. Put SAY in place of `SAY`, inside the single quotes; leave the quotes empty when they wrote nothing. `$CODEX_THREAD_ID` is this conversation's own id, which Codex sets for every command it runs: do not replace it.

   ```sh
   curl -s -m 5 --retry 4 --retry-connrefused --retry-delay 1 --retry-max-time 12 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}]\n' -X POST -G --data-urlencode "session=$CODEX_THREAD_ID" --data-urlencode 'say=SAY' {{origin}}/api/here || echo "[no answer from {{origin}}]"
   ```

2. If what it prints begins with "Kehikot:" and the report says HTTP 200, tell the person that answer, word for word, without the bracketed report, and stop. Do nothing else: the module has done what was asked, or said why not and what to type instead.
3. Otherwise the module is restarting, is not running, is older than this skill, or moved to another port. Run this one command, once, the same way: it asks the address the module registered. If what it prints begins with "Kehikot:" and its report says HTTP 200, tell the person that answer, word for word, without the bracketed report, and stop.

   ```sh
   curl -s -m 5 --retry 4 --retry-connrefused --retry-delay 1 --retry-max-time 12 -w '\n[curl exit %{exitcode}: %{errormsg}; HTTP %{http_code}; %{url_effective}]\n' -X POST -G --data-urlencode "session=$CODEX_THREAD_ID" --data-urlencode 'say=SAY' "$(sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$HOME/Library/Application Support/Kehikot/modules/kehikot.codex.json")/api/here"
   ```

4. If that did not give an answer (it failed, printed nothing useful, or the person did not allow it), tell the person ONE line, built from the first report, and stop:
   - curl exit 7 (could not connect), 28 (timed out), 52 or 56 (connection closed), or no answer at all: "Kehikot: couldn't reach the Codex module at {{origin}} (REASON; it may be restarting or not running). Try $kehikot-here again in a moment; if it keeps failing, update Codex from Kehikot's Updates menu. [skill {{version}}]" — REASON is "connection refused" for 7, "timed out" for 28, "connection closed" for 52 or 56, "no answer" otherwise.
   - curl exit 0 with HTTP 404, 403 or 405: "Kehikot: the Codex module at {{origin}} answered HTTP CODE to $kehikot-here, so it is older than this skill (or another program has its port). Update Codex from Kehikot's Updates menu, then type $kehikot-here again. [skill {{version}}]"
   - curl exit 6 or 7 with "Operation not permitted", or a sandbox refusal: "Kehikot: the sandbox kept this conversation from reaching Kehikot at {{origin}}. Type $kehikot-here again and allow the command to run outside the sandbox. [skill {{version}}]"
   - anything else: "Kehikot: the Codex module at {{origin}} did not assign this conversation (curl exit N, HTTP CODE: ERROR). Try $kehikot-here again in a moment; if it keeps failing, update Codex from Kehikot's Updates menu. [skill {{version}}]" — with curl's numbers and error message from the report.

Never run either command again on your own, with another session id, or with other words: only the person assigns a conversation, by typing `$kehikot-here`.

Once this conversation has a place: when you or a subagent finish researching something (investigating, comparing, auditing, reading up), say so with `tell_finished({ event: "research-complete", label })` on the Codex module's MCP server (kehikko-codex), and the person gets a "Research complete" notice.
