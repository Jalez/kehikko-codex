import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, normalize, sep } from 'node:path'

import { settingValueIssue } from 'kehikot-module-protocol'

/**
 * "Other folders sessions may work in": the folders beside a project that its sessions are given as
 * more of their workspace, one `--add-dir <folder>` each. A session runs in its project's folder,
 * and the program asks before it reads a file outside its workspace; a folder listed here is read as
 * the project is. Edits and commands there ask as they do in the project.
 *
 * The person's own list (the setting is `personOnly`), kept in the project's settings file and
 * checked folder by folder (`folderIssue`): an existing directory, never `/`, the home folder or a
 * folder holding it, a wide root, a system folder, or where the person's agents and shell keep
 * their accounts and keys. Pure but for reading whether a folder is there; shared in spirit with
 * the Antigravity and Codex modules, which check the same way.
 */

export const FOLDERS_KEY = 'folders'

/** Folders that, with everything inside them, are the system's: never a session's workspace. */
const SYSTEM = ['/System', '/Library', '/bin', '/sbin', '/usr', '/etc', '/dev', '/cores', '/Applications', '/private/etc', '/private/var/db', '/private/var/root']
/** Folders too wide to hand over whole, though what is inside them may be fine. */
const WIDE = ['/', '/Users', '/Volumes', '/private', '/private/var', '/var', '/tmp', '/private/tmp', '/opt', '/Network']
/** Folders in the home folder, with everything inside them, that hold an agent's account or the person's keys. */
const SECRET = ['.claude', '.codex', '.gemini', '.ssh', '.gnupg', '.aws', '.config/gcloud', '.kube', '.docker', 'Library']

const within = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep)
const homeFolder = (): string => normalize(process.env.HOME || homedir())
/** A path as it is kept: normalized, no trailing slash. */
const tidy = (path: string): string => normalize(path).replace(/(.)\/+$/, '$1')

/** Why a path cannot be one of the folders, judged by its spelling alone; null when it can. */
function spelledIssue(path: string, home: string): string | null {
  if (!path || !isAbsolute(path)) return `“${path.slice(0, 120)}” is not an absolute path: start it with /.`
  const at = tidy(path)
  if (at === '/') return 'The whole disk cannot be given to a session.'
  if (at === home) return 'Your whole home folder cannot be given to a session: name the folders in it.'
  if (within(home, at)) return `${at} holds your home folder: name the folders you mean instead.`
  if (WIDE.includes(at)) return `${at} is too wide to give a session: name the folders in it you mean.`
  if (SYSTEM.some((one) => within(at, one))) return `${at} is a system folder; sessions are not given those.`
  const secret = SECRET.find((one) => within(at, `${home}${sep}${one}`))
  if (secret) return `${at} is where your ${secret === 'Library' ? 'apps keep their data' : 'keys or accounts are kept'}; sessions are not given it.`
  return null
}

/**
 * Why `path` cannot be one of the folders, or null. With `exists`, also that it is a directory on
 * this machine now, judged by both its spelling and where it leads (a link to a system folder is
 * that system folder). Without, by its spelling alone: how a saved list is read, so that a folder
 * away for a while is not dropped from the person's list.
 */
export function folderIssue(path: string, options: { exists?: boolean; home?: string } = {}): string | null {
  const home = options.home ?? homeFolder()
  const spelled = spelledIssue(path, home)
  if (spelled || !options.exists) return spelled
  let real: string
  try {
    real = realpathSync(path)
    if (!statSync(real).isDirectory()) return `${path} is not a folder.`
  } catch {
    return `There is no folder at ${path}.`
  }
  let realHome = home
  try {
    realHome = realpathSync(home)
  } catch {
    /* No home folder on disk: judged by its spelling. */
  }
  return real === tidy(path) ? null : spelledIssue(real, realHome)
}

/** Why `value` cannot be the list of folders, or null: a list of lines, each blank or a folder `folderIssue` takes now. */
export function foldersIssue(value: unknown): string | null {
  const wrong = settingValueIssue({ type: 'list' }, value)
  if (wrong) return `Other folders sessions may work in: ${wrong}.`
  for (const one of value as string[]) {
    if (!one.trim()) continue
    const issue = folderIssue(one.trim(), { exists: true })
    if (issue) return issue
  }
  return null
}

/** The folders off a file: trimmed, each one that could be one by its spelling, in order, once. A folder away for now stays listed. */
export function foldersOf(raw: unknown): string[] {
  if (!Array.isArray(raw) || settingValueIssue({ type: 'list' }, raw) !== null) return []
  const out: string[] = []
  for (const one of raw as string[]) {
    const at = tidy(one.trim())
    if (one.trim() && folderIssue(one.trim()) === null && !out.includes(at)) out.push(at)
  }
  return out
}

/**
 * The folders a session of `projectPath` is given beside its project, now: each listed folder that
 * is a directory on this machine and passes `folderIssue`, never the project itself or a folder in
 * it (already its workspace). A folder away for now is left out, and given again when it is back.
 */
export function extraFolders(folders: readonly string[], projectPath: string): string[] {
  const project = tidy(projectPath)
  return folders.filter((one) => folderIssue(one, { exists: true }) === null && !within(one, project))
}

/** The arguments for those folders: one `--add-dir` each. */
export const folderFlags = (folders: readonly string[]): string[] => folders.flatMap((one) => ['--add-dir', one])

/** Whether two lists of folders are the same, in order. */
export const sameFolders = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((one, n) => one === b[n])
