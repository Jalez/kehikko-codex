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
# `kehikot/token`, `kehikot/origin` and `kehikot/registration`.
#
#   - Unlike context.sh, the hook's input leaves this script: the command is what is decided on. It
#     goes on a pipe to this module's own server on this computer, never on a command line, and the
#     module keeps none of it.
#   - The token goes to curl on a file descriptor, never on a command line.
#   - Loopback only, no proxy.
#   - It never fails the command for want of an answer: three seconds at most, every outcome is exit
#     0, and anything that is not this module's answer is nothing — the command then runs as written.
#   - `KEHIKOT_DIRECT` set in the session's own environment is said (`direct=1`): it passes every guard.

event=${1-}
[ "$event" = PreToolUse ] || exit 0

here=$(/usr/bin/dirname "$0")/kehikot
token=$(/bin/cat "$here/token" 2>/dev/null)
origin=$(/bin/cat "$here/origin" 2>/dev/null)
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

ask() {
  case $1 in http://127.0.0.1:[0-9]*) ;; *) return 1 ;; esac
  printf '%s' "$input" |
    "$curl" -q --config /dev/fd/3 --silent --fail --max-time 3 --connect-timeout 1 --noproxy '*' \
      --header 'content-type: application/json' --data-binary @- \
      "$1/api/guard?session=$session&direct=$direct" 2>/dev/null 3<<END
header = "x-module-ticket: $token"
END
}

said=$(ask "$origin")
asked=$?
# No answer from there: the module may have moved to another port since this session started, and its
# registration says where. An answer with nothing in it is an answer.
if [ "$asked" -ne 0 ] && [ -f "$here/registration" ]; then
  reg=$(/bin/cat "$here/registration" 2>/dev/null)
  if [ -f "$reg" ]; then
    url=$("$sed" -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$reg" | /usr/bin/head -n 1)
    [ -n "$url" ] && [ "$url" != "$origin" ] && said=$(ask "$url")
  fi
fi

case $said in '{"hookSpecificOutput":{"hookEventName":"PreToolUse"'*) printf '%s\n' "$said" ;; esac
exit 0
