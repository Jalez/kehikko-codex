# Codex — notes for agents

A Kehikot module: a terminal holding the Codex CLI session that belongs to a place (project, epic,
picked parts, kehikko). The sibling of the Claude module (`kehikot.claude`): the same record, page
and doors, with `program.ts` answering for Codex. README.md says what it does and why, and what
Codex can and cannot do here.

## The rules

- **Nothing in `~/.codex` is written.** Everything a session is given is per run: `-c` overrides
  for its hooks, their trust (`hooks.state`), its MCP doors, the project's settings and the Kehikot
  skills it is NOT given (`skills.config`, switched off); its context hook in a 0700 folder under
  this user's temporary directory (`sessionKit`), removed with the session. Never `config.toml`,
  never `--dangerously-bypass-hook-trust`, never a flag that touches the sandbox or approvals
  beyond the person's own "When Codex asks before acting".
- **Skills go in `~/.agents/skills`, by `agentSkills.ts` alone.** Codex has no per-run skills
  folder. Only a folder carrying this module's marker (`by: 'kehikot.codex'`) is written or
  removed; one the person made or changed never is. A session holds what it was given (`holders`)
  until it ends; a kehikko-bound skill is installed only while a conversation whose kehikko meets
  its needs holds it, and opens with a check of its place (`guarded`).
- **A hook's trust is its hash** (`hookHash` in program.ts, Codex's `hook_hash`). Change a hook's
  command or timeout and the hash follows; `test/tell.test.ts` runs the stand-in, which refuses a
  hook whose hash does not match, as Codex does.
- **Project data** lives only in `<project>/.kehikot/codex/` (`record.ts`, the protocol's
  `moduleDir`/`moduleFile`).
- **Tests never reach the real machine**: `test/setup.ts` points HOME, `CODEX_HOME`, the registry
  and PATH at scratch. `test/stand-in/codex` (a Bun script) imitates the CLI as measured on 0.164.0.
- **Never a browser on this Mac**; DOM tests use happy-dom.

## Releasing

Kehikot installs and updates this module from its GitHub releases, not from `main`.

1. Bump `version` in `package.json` (semver). It is the only place the version is written.
2. Write `notes/<version>.md`: what a person notices (see `notes/README.md`).
3. Open a PR with both; merge it.
4. Tag the merge commit on `main` and push it:
   `git tag -a v<version> -m v<version> <merge-commit> && git push origin v<version>`.
5. `.github/workflows/release.yml` checks, typechecks, tests and publishes "Codex <version>".

## Ready-built

`run.sh` serves the built page (`serve.ts`, the protocol's `run`) when `dist/.kehikot-built` names
the commit checked out, and Vite otherwise. `bun run build` makes it; a host runs that at install
and update, never at start. Under Bun the pty is Bun's own (`pty.ts`).
