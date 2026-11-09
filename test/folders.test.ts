import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { extraFolders, folderFlags, folderIssue, foldersIssue, foldersOf, sameFolders } from '../folders.ts'

/** "Other folders sessions may work in", checked folder by folder (folders.ts). */

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})
const folder = (name = 'repo') => {
  const at = join(realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-folders-'))), name)
  mkdirSync(at, { recursive: true })
  made.push(at)
  return at
}
const HOME = process.env.HOME!

describe('which folders a session may be given', () => {
  test('an existing folder is taken, and a blank line is nothing', () => {
    const ok = folder()
    expect(folderIssue(ok, { exists: true })).toBeNull()
    expect(foldersIssue([ok, '  '])).toBeNull()
    expect(foldersIssue([])).toBeNull()
  })

  test('the disk, the home folder, a folder holding it and wide roots are refused with a sentence', () => {
    expect(folderIssue('/', { exists: true })).toContain('whole disk')
    expect(folderIssue(HOME, { exists: true })).toContain('home folder')
    expect(folderIssue(`${HOME}/`, { exists: true })).toContain('home folder')
    expect(folderIssue(join(HOME, '..'), { exists: true })).toContain('holds your home folder')
    for (const one of ['/Users', '/Volumes', '/var', '/tmp']) expect(folderIssue(one, { exists: true })).not.toBeNull()
  })

  test('system folders and where accounts and keys are kept are refused, with everything in them', () => {
    for (const one of ['/System/Library', '/usr/bin', '/etc', '/Library/Preferences', '/Applications']) expect(folderIssue(one, { exists: true })).toContain('system folder')
    for (const one of ['.claude', '.codex', '.gemini', '.ssh/keys', '.aws', 'Library/Keychains']) expect(folderIssue(join(HOME, one), { exists: true })).toContain('sessions are not given it')
  })

  test('a path that is not absolute, not there or not a folder is refused', () => {
    const ok = folder()
    expect(folderIssue('relative/path', { exists: true })).toContain('not an absolute path')
    expect(folderIssue(join(ok, 'not-there'), { exists: true })).toContain('There is no folder')
    const file = join(ok, 'a-file')
    writeFileSync(file, 'x')
    expect(folderIssue(file, { exists: true })).toContain('not a folder')
    expect(foldersIssue([ok, '/'])).toContain('whole disk')
    expect(foldersIssue('not a list')).not.toBeNull()
    expect(foldersIssue([ok, 7])).not.toBeNull()
  })

  test('a link is judged by where it leads', () => {
    const link = join(folder('links'), 'to-etc')
    symlinkSync('/etc', link)
    expect(folderIssue(link, { exists: true })).toContain('system folder')
  })
})

describe('the list as kept, and what a session is given', () => {
  test('read off a file: tidied, once each, refused spellings dropped, a folder away for now kept', () => {
    const here = folder('here')
    const away = join(here, '..', 'away')
    expect(foldersOf([` ${here}/ `, here, away, '/', HOME, 'x', ''])).toEqual([here, away])
    expect(foldersOf('nope')).toEqual([])
    expect(foldersOf([here, 7])).toEqual([])
  })

  test('a folder away for now is not given until it is back; the project and folders in it are never added again', () => {
    const project = folder('project')
    const here = folder('here')
    const away = join(here, '..', 'away')
    mkdirSync(join(project, 'sub'))
    expect(extraFolders([here, away, project, join(project, 'sub')], project)).toEqual([here])
    mkdirSync(away)
    expect(extraFolders([here, away], project)).toEqual([here, away])
  })

  test('each folder is one more --add-dir', () => {
    expect(folderFlags(['/a/one', '/b/two'])).toEqual(['--add-dir', '/a/one', '--add-dir', '/b/two'])
    expect(folderFlags([])).toEqual([])
    expect(sameFolders(['/a'], ['/a'])).toBe(true)
    expect(sameFolders(['/a', '/b'], ['/b', '/a'])).toBe(false)
  })
})
