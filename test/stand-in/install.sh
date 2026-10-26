#!/bin/sh
# A stand-in for the vendor's installer: prints, waits a little, and puts the stand-in `codex`
# where a global npm install would land on this test's PATH: `$HOME/.local/bin/codex`. `fail` as
# the first argument makes it the installer that does not finish. Never run against a real home.
here=$(cd "$(dirname "$0")" && pwd)
echo "stand-in installer: downloading…"
sleep 1
if [ "$1" = "fail" ]; then
  echo "stand-in installer: the download failed (this is the failing variant)"
  exit 7
fi
mkdir -p "$HOME/.local/bin"
cp "$here/codex" "$HOME/.local/bin/codex"
cp "$here/codex.ts" "$HOME/.local/bin/codex.ts"
chmod +x "$HOME/.local/bin/codex"
echo "stand-in installer: installed to $HOME/.local/bin/codex"
