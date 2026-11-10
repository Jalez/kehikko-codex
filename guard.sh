#!/bin/sh
#
# What a session this module started runs before each shell command, its own or a subagent's: asks
# this module whether a module placed on the session's kehikko guards the command (protocol 2.61.0,
# see guards.ts), and prints what Codex is to do — run the module's command instead
# (`permissionDecision: allow` with `updatedInput`) or refuse with the module's reason
# (`permissionDecision: deny`).
#
#   /bin/sh guard.sh PreToolUse
#
# One of the hooks this module gives a Codex session for that one process (`-c hooks.PreToolUse`,
# matcher `^Bash$`: Codex names its shell tools `Bash` to a hook; see `hookArgs` in program.ts),
# copied into the session's own folder (`sessionKit` in skills.ts) beside context.sh and the same
# `kehikot/token`, `kehikot/stable`, `kehikot/origin` and `kehikot/registration`.
#
#   - Unlike context.sh, the hook's input leaves this script: the command is what is decided on. It
#     goes on a pipe to this module's own server on this computer, never on a command line, and the
#     module keeps none of it.
#   - The token goes to curl on a file descriptor, never on a command line.
#   - Loopback only, no proxy.
#   - Where it asks, in order: Kehikot's stable address for this module (`kehikot/stable`, the host's
#     `/m/<this module>`, which follows the module wherever it binds), what its registration names
#     now, and the origin it served on when the session started.
#   - Kehikot restarting is not a reason to skip the guards. While nothing answers (no connection,
#     or the host saying the module is not up: 502, 503, 504) it asks again every second for up to
#     20 seconds (the hook's timeout is 30, `GUARD_TIMEOUT` in skills.ts), so a heavy command is still
#     sent to the queue once Kehikot is back. Only then does the command run as written, with a note
#     (`additionalContext`, which Codex hands the model from a PreToolUse hook that decides nothing)
#     telling the agent it ran unguarded and how to queue heavy work itself. While Kehikot stays away
#     (`kehikot/away`, five minutes) the next commands ask once and do not wait again.
#   - Every outcome is exit 0; an answer that is not this module's is nothing — the command then
#     runs as written.
#   - `KEHIKOT_DIRECT` set in the session's own environment is said (`direct=1`): it passes every guard.

event=${1-}
[ "$event" = PreToolUse ] || exit 0

here=$(/usr/bin/dirname "$0")/kehikot
token=$(/bin/cat "$here/token" 2>/dev/null)
origin=$(/bin/cat "$here/origin" 2>/dev/null)
stable=$(/bin/cat "$here/stable" 2>/dev/null)
case $token in '' | *[!A-Za-z0-9_-]*) exit 0 ;; esac
[ ${#token} -le 64 ] || exit 0

curl=/usr/bin/curl
sed=/usr/bin/sed
[ -x "$curl" ] && [ -x "$sed" ] || exit 0

input=$(/usr/bin/head -c 262144 2>/dev/null)
session=$(printf '%s' "$input" | /usr/bin/tr -d '\n\r' | "$sed" -n 's/.*"session_id" *: *"\([0-9a-f-]\{36\}\)".*/\1/p')
case $session in '' | *[!0-9a-f-]*) exit 0 ;; esac

direct=0
case ${KEHIKOT_DIRECT-} in '' | 0) ;; *) direct=1 ;; esac

# How long Kehikot is waited for, in seconds (KEHIKOT_GUARD_WAIT, for a test); not again while it stays away.
wait=${KEHIKOT_GUARD_WAIT-20}
case $wait in '' | *[!0-9]*) wait=20 ;; esac
[ -n "$(/usr/bin/find "$here/away" -mmin -5 2>/dev/null)" ] && wait=0

# One ask: the answer's body in $said, its HTTP status in $code (000: nothing answered).
ask() {
  code=000
  said=
  case $1 in http://127.0.0.1:[0-9]*) ;; *) return 0 ;; esac
  out=$(printf '%s' "$input" |
    "$curl" -q --config /dev/fd/3 --silent --max-time 3 --connect-timeout 1 --noproxy '*' \
      --header 'content-type: application/json' --data-binary @- --write-out '\n%{http_code}' \
      "$1/api/guard?session=$session&direct=$direct" 2>/dev/null 3<<END
header = "x-module-ticket: $token"
END
)
  code=$(printf '%s' "$out" | /usr/bin/tail -n 1)
  said=$(printf '%s' "$out" | "$sed" '$d')
  case $code in [0-9][0-9][0-9]) ;; *) code=000 ;; esac
}

# What the module's registration names now: a module that came back on another port is followed.
registered() {
  [ -f "$here/registration" ] || return 0
  reg=$(/bin/cat "$here/registration" 2>/dev/null)
  [ -f "$reg" ] && "$sed" -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$reg" | /usr/bin/head -n 1
}

start=$(/bin/date +%s)
while :; do
  away=0
  tried=
  for url in "$stable" "$(registered)" "$origin"; do
    [ -n "$url" ] || continue
    case " $tried " in *" $url "*) continue ;; esac
    tried="$tried $url"
    ask "$url"
    case $code in
      200)
        /bin/rm -f "$here/away"
        case $said in '{"hookSpecificOutput":{"hookEventName":"PreToolUse"'*) printf '%s\n' "$said" ;; esac
        exit 0
        ;;
      204)
        /bin/rm -f "$here/away"
        exit 0
        ;;
      000 | 502 | 503 | 504) away=1 ;;
    esac
  done
  # Everyone asked answered, none with a guard's answer: the command runs as written.
  [ "$away" = 1 ] || exit 0
  [ $(($(/bin/date +%s) - start)) -lt "$wait" ] || break
  /bin/sleep 1
done

: >"$here/away" 2>/dev/null
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Kehikot did not answer (it may be restarting), so this command ran without the guards of the modules on your kehikko. Until it is back, run heavy work (tests, typechecks, builds, big installs) through Queue yourself: its CLI, the kehikot-queue program its wait lines name, run as `kehikot-queue run -- <command>` in the background, waits for Queue to come back and exits with the command'"'"'s exit code."}}'
exit 0
