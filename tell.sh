#!/bin/sh
#
# What a session's program runs to say what it is doing: one word to this
# module's own server, over loopback, and nothing else.
#
#   /bin/sh tell.sh <event>
#
# It is run by Codex in the pty, as one of the hooks this module gives the
# session for that one process (see `hookArgs` in program.ts and "Told, not
# read" in live.ts), and it is written to be the least a thing run from inside
# somebody's agent can be:
#
#   - It says the EVENT'S NAME, which is this script's own argument, the RUN,
#     which this module put in the environment when it started the pty, and the
#     conversation's id, which Codex hands every hook as `session_id` (a new
#     conversation's id is Codex's own choice, and `/clear` makes another).
#     Of what Codex supplies on standard input — the prompt, the tool's input,
#     the last answer — nothing else is read, carried, stored or shown, but a
#     subagent's thread id and role on SubagentStart and SubagentStop.
#   - Nothing is interpolated into a command. The values come from this
#     module's own environment and the id is checked for its exact spelling;
#     the secret never appears on a command line: it goes to curl on a pipe, so
#     `ps` does not show it.
#   - It can only ever speak to this computer. Only a port number is taken
#     from the environment, digits or nothing, and no proxy is used.
#   - It never holds the program up and never says anything to it: two
#     seconds at most, every outcome is exit 0, and nothing is printed —
#     what a hook prints is read by Codex as context for the model.
#
# A server that is gone, a curl that is missing, a variable that is absent:
# all the same, silently nothing. The session then has no state.

event=${1-}
port=${KEHIKOT_TELL_PORT-}
secret=${KEHIKOT_TELL_SECRET-}
session=${KEHIKOT_TELL_SESSION-}

case $event in '' | *[!A-Za-z]*) exit 0 ;; esac
case $port in '' | *[!0-9]*) exit 0 ;; esac
case $secret in '' | *[!0-9a-f]*) exit 0 ;; esac
case $session in '' | *[!0-9a-f-]*) exit 0 ;; esac
[ ${#port} -le 5 ] && [ ${#secret} -le 128 ] && [ ${#session} -le 64 ] && [ ${#event} -le 40 ] || exit 0

# By its full name, so that nothing a project puts on PATH is run in its place.
curl=/usr/bin/curl
sed=/usr/bin/sed
[ -x "$curl" ] && [ -x "$sed" ] || exit 0

# The hook's input is one JSON object. Inside its strings a quote is escaped, so a quoted key
# followed by a colon is only ever a real key: the prompt cannot fake one. Only the id leaves.
thread=
agent=
kind=
if [ ! -t 0 ]; then
  input=$(/usr/bin/head -c 262144 2>/dev/null | /usr/bin/tr -d '\n\r')
  case $event in
    SubagentStart | SubagentStop)
      # A subagent's: its thread id and its role, never a session id — the subagent's thread is
      # not the conversation (research.ts).
      agent=$(printf '%s' "$input" | "$sed" -n 's/.*"agent_id" *: *"\([0-9a-f-]\{36\}\)".*/\1/p')
      kind=$(printf '%s' "$input" | "$sed" -n 's/.*"agent_type" *: *"\([A-Za-z0-9:._-]\{1,64\}\)".*/\1/p')
      case $agent in '' | *[!0-9a-f-]*) exit 0 ;; esac
      case $kind in *[!A-Za-z0-9:._-]*) kind= ;; esac
      ;;
    *)
      thread=$(printf '%s' "$input" | "$sed" -n 's/.*"session_id" *: *"\([0-9a-f-]\{36\}\)".*/\1/p')
      case $thread in *[!0-9a-f-]*) thread= ;; esac
      ;;
  esac
fi
extra=
[ -n "$thread" ] && extra="&thread=$thread"
[ -n "$agent" ] && extra="&agent=$agent"
[ -n "$kind" ] && extra="$extra&type=$kind"

printf 'header = "x-module-ticket: %s"\n' "$secret" |
  "$curl" -q --config - --silent --max-time 2 --connect-timeout 1 --noproxy '*' --output /dev/null \
    --request POST "http://127.0.0.1:$port/api/state?event=$event&session=$session$extra" >/dev/null 2>&1

exit 0
