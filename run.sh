#!/usr/bin/env bash
#
# What a host runs to start this module: no arguments, foreground, `exec`.
#
#   - No arguments, because a registration names a directory and this script,
#     never a command line a host would hand to a shell.
#   - No port here. It is PREFERRED_PORT in manifest.ts, and `serves()` in
#     vite.config.ts acts on it: takes it when free, honours $PORT from a host,
#     and moves (rewriting the registration) when something else has it.
#   - `exec` in the foreground, so the pid a host holds is the one that stops it.
#
# It does not register. That is `bun run register`, a person's decision.
#
# What this process is: it serves a page, and for that page it runs ONE
# program in a pty — Codex, in the open project's folder — as you, with
# no sandbox between. It binds to 127.0.0.1 only. Do not put it behind a
# tunnel or a reverse proxy.
set -euo pipefail
cd "$(dirname "$0")"

# Install when nothing is installed, AND whenever bun.lock or package.json is
# newer than the last install here — the same rule as the host's own run.sh. A
# pull that moves the protocol pin leaves the old package in node_modules, and
# a page that imports a name the old package does not have draws nothing.
# `--frozen-lockfile`, so a start installs exactly what bun.lock says and never
# rewrites it behind somebody's back. The stamp is written only after an
# install that succeeded.
INSTALLED=node_modules/.kehikot-installed
VITE_FORCE=
if [ ! -d node_modules ] || [ ! -f "$INSTALLED" ] || [ bun.lock -nt "$INSTALLED" ] || [ package.json -nt "$INSTALLED" ]; then
  echo "installing…" >&2
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile >&2 || { echo "bun install --frozen-lockfile failed: bun.lock does not match package.json. Run \`bun install\` and commit bun.lock." >&2; exit 1; }
  else
    bun install >&2
  fi
  touch "$INSTALLED"
  # Rebuild Vite's pre-bundle rather than trust one made from the old packages.
  VITE_FORCE=--force
fi

# node-pty execs a small helper to set up the tty, and `bun install` does not
# keep its executable bit: every fence passes, the socket opens, and nothing
# starts, with `posix_spawnp failed.` as the only word about it. Put right on
# every start, since the next install undoes it (dev/fix-spawn-helper.sh).
./dev/fix-spawn-helper.sh || true

# The built page, when its stamp is this checkout's HEAD (`bun run build`,
# which a host runs at install and update, never at start). Read here, in the
# shell, so choosing costs a `git rev-parse` and not a process. A checkout
# somebody edits has no stamp, or one of an older commit, and gets Vite; a
# stale build is never served (`serve.ts` refuses one too, with a 503).
BUILT=
if [ -f dist/.kehikot-built ] && [ -f dist/index.html ]; then
  read -r BUILT < dist/.kehikot-built || true
fi
if [ -n "$BUILT" ] && [ "$BUILT" = "$(git rev-parse HEAD 2>/dev/null)" ]; then
  exec bun run serve.ts
fi
if [ -n "$BUILT" ]; then
  echo "codex: dist/ is a build of ${BUILT:0:7}, not of this checkout, so Vite serves the page. \`bun run build\` would make it current." >&2
fi

exec bunx vite $VITE_FORCE
