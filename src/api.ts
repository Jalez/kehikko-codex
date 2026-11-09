import { answered, ask, follow, ticket } from 'kehikot-module-protocol/client'

import type { Listing } from '../doors.ts'
import type { ActivityRow, Metered, Notice, SessionsChanged, Stated } from '../live.ts'

/**
 * This module's own `/api`, as the page calls it. `ask` carries the ticket —
 * on the read as well, since the read says what somebody has been working on
 * (see doors.ts) — and turns every failure into one sentence.
 */
/** What a conversation was told: the last full notes, and each change since (context.ts `Said`). */
export interface Told {
  start: { at: number; text: string }
  changes: { at: number; text: string }[]
}

export interface Api {
  /** What this place holds: its sessions, the project's others, what is running, and whether the program is there. */
  place(projectPath: string, key: string, projectId?: string | null): Promise<Listing>
  /**
   * Bring what an older release filed under a kehikko's row number across to
   * its key. Asked once per kehikko, before the first read of a place on it.
   */
  rekey(projectPath: string, kehikko: { key: string; name: string; id?: number }): Promise<void>
  /** End a running session, because a person chose that one. */
  end(session: string): Promise<void>
  /**
   * Resume a running session in its project's new folder, because a person pressed that after the
   * folder was renamed: the server ends it and its views open it again. Refused while it is working.
   */
  restart?(session: string, why?: 'moved' | 'doors' | 'folders'): Promise<void>
  /** A person's say: make the conversation on screen this place's own (`own`). Rewrites the record. */
  assign?(projectPath: string, key: string, session: string, own: boolean, kehikkoName?: string): Promise<void>
  /** Which doors a running session would be given now that it was not; null when not known. */
  doors?(session: string): Promise<{ added: string[]; removed: string[] } | null>
  /**
   * Say what this page has on screen — its place, and whether the open kehikko has a Codex
   * container — or `null` for nothing. What `$kehikot-here` typed in a conversation assigns to.
   */
  showing?(page: string, at: { projectPath: string; key: string; kehikkoName: string; partNames: string[]; onScreen: boolean } | null): Promise<void>
  /** Take a session off a place ("Disconnect from this kehikko"). The session itself is kept. */
  detach(projectPath: string, key: string, session: string): Promise<void>
  /**
   * What a conversation of this project was last told by its hooks (its place, the modules around it
   * and the installed ones absent from it), and each change told since: "What this conversation was
   * told". Null when nothing was kept for it.
   */
  told?(projectPath: string, session: string): Promise<Told | null>
  /** This project's settings for this module: whether conversations a restart cut off are resumed. */
  settings?(projectPath: string): Promise<{ resumeCutOff: boolean }>
  /** A person's press: change it. */
  setResume?(projectPath: string, resumeCutOff: boolean): Promise<{ resumeCutOff: boolean }>
  /**
   * Follow what changes while the page is open: every running session's
   * state, and — when `notices` says a host is there to pass them to — the
   * notices raised for a person who is not looking, and the whole activity
   * list (on arrival and on every change). `attached` is told each time
   * the feed (re)opens: what the page shows is said again then, since the
   * server keeps it only while a feed is open. Returns the function that
   * stops following.
   */
  feed?(notices: boolean, heard: { state(stated: Stated): void; notice(notice: Notice): void; activity?(items: ActivityRow[]): void; sessions?(event?: SessionsChanged): void; context?(said: Metered): void; attached?(): void }, project?: string | null, page?: string): () => void
}

export const api: Api = {
  async place(projectPath, key, projectId) {
    return answered(await ask<Listing>('./api/place', { query: { projectPath, key, ...(projectId ? { projectId } : {}) }, ticket: true }))
  },
  async rekey(projectPath, kehikko) {
    answered(await ask('./api/rekey', { body: { projectPath, kehikko } }))
  },
  async end(session) {
    answered(await ask('./api/end', { body: { session } }))
  },
  async restart(session, why = 'moved') {
    answered(await ask('./api/restart', { body: { session, why } }))
  },
  async assign(projectPath, key, session, own, kehikkoName) {
    answered(await ask('./api/assign', { body: { projectPath, key, session, own, ...(kehikkoName ? { names: { kehikko: kehikkoName } } : {}) } }))
  },
  async doors(session) {
    return answered(await ask<{ ok: true; changed: { added: string[]; removed: string[] } | null }>('./api/doors', { query: { session }, ticket: true })).changed
  },
  async showing(page, at) {
    answered(await ask('./api/showing', { body: at ? { page, ...at } : { page } }))
  },
  async detach(projectPath, key, session) {
    answered(await ask('./api/detach', { body: { projectPath, key, session } }))
  },
  async told(projectPath, session) {
    return answered(await ask<{ ok: true; told: Told | null }>('./api/told', { query: { projectPath, session }, ticket: true })).told
  },
  async settings(projectPath) {
    return answered(await ask<{ ok: true; settings: { resumeCutOff: boolean } }>('./api/settings', { query: { projectPath }, ticket: true })).settings
  },
  async setResume(projectPath, resumeCutOff) {
    return answered(await ask<{ ok: true; settings: { resumeCutOff: boolean } }>('./api/settings', { body: { projectPath, resumeCutOff } })).settings
  },
  feed(notices, heard, project, page) {
    return follow<Stated | Notice | { items: ActivityRow[] } | SessionsChanged | Metered>(
      './api/feed',
      (event, name) => name === 'notice'
          ? heard.notice(event as Notice)
          : name === 'activity'
            ? heard.activity?.((event as { items: ActivityRow[] }).items)
            : name === 'sessions'
              ? heard.sessions?.(event as SessionsChanged)
              : name === 'context'
                ? heard.context?.(event as Metered)
                : heard.state(event as Stated),
      /* An EventSource sends no header, so the ticket rides the query (see `stream` in doors.ts). */
      /* The activity list is of the project the page is framed in only: a host files it under that one. */
      { query: { ticket: ticket() ?? '', notices: notices ? '1' : '0', ...(project ? { project } : {}), ...(page ? { page } : {}) }, events: ['notice', 'activity', 'sessions', 'context'], onAttachment: (attachment) => {
        if (attachment === 'attached') heard.attached?.()
      } },
    )
  },
}
