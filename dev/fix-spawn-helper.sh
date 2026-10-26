#!/usr/bin/env bash
#
# Give node-pty's spawn-helper back the executable bit that installing removes.
#
# On macOS node-pty does not exec your shell directly: it execs a small helper
# binary which sets up the tty and then execs the shell. The prebuilt helper
# ships in the tarball with mode 0755 and arrives on disk as 0644, because the
# installer does not carry the bit across.
#
# The failure is `posix_spawnp failed.` and nothing else. No missing-file error,
# because the file is right there; no permission error anybody would recognise,
# because it surfaces as a spawn failure two layers down. Every fence passes,
# the ticket is accepted, the socket opens, and then no shell appears — which
# reads as "the terminal is broken" rather than "one file lost a permission
# bit".
#
# ## Why this is a postinstall and not only a line in run.sh
#
# It WAS only in run.sh, and it came back. `bun install` re-extracts
# node_modules and drops the bit again, and anything that then starts the server
# without going through run.sh — a bare `bun run vite`, an editor task, another
# agent — gets a terminal that cannot open a shell. The bit is lost by
# installing, so it is repaired by installing. run.sh keeps its copy as a belt:
# the two are cheap, idempotent, and cover different ways of arriving here.
#
# Silent when there is nothing to do, and never fatal: a layout change upstream
# should not stop the module starting, it should stop the SHELL starting, which
# the page already reports in words.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

for helper in \
  node_modules/node-pty/prebuilds/*/spawn-helper \
  node_modules/node-pty/build/Release/spawn-helper
do
  if [ -f "$helper" ] && [ ! -x "$helper" ]; then
    chmod +x "$helper"
    echo "codex: restored the executable bit on $helper" >&2
  fi
done
