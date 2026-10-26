#!/usr/bin/env bun
import { run } from 'kehikot-module-protocol/run'
import { originFor } from 'kehikot-module-protocol/serve'

import { BUILD, MANIFEST, MOST_READ, TICKET, answer, ours, servingAt, stream } from './doors.ts'
import { sessionSockets, theRuns } from './live.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * This module over its BUILT page (`bun run build`), on the same doors, the
 * same port and the same session socket. `run.sh` starts this when `dist/`
 * carries a stamp of the commit checked out, and Vite otherwise.
 *
 * Nothing this module says is decided here: the doors are `answer` and
 * `stream` in `doors.ts` (skills and the settings door among them), mounted by
 * the protocol's `run` exactly as `doors()` mounts them on Vite; the socket is
 * `hold` in `live.ts`, on Bun's WebSocket here and on `ws` there. Under Bun the
 * pty is Bun's own (`pty.ts` says why node-pty cannot be).
 *
 * A build that is not this checkout's is never served: `run` answers the page
 * with a 503 saying which commit each is, and the command to run.
 */

const log = (line: string) => console.log(line)
let port = PREFERRED_PORT
const sessions = sessionSockets(() => port, log)

const running = await run({
  id: ID,
  prefer: PREFERRED_PORT,
  dir: import.meta.dirname,
  manifest: MANIFEST,
  answer,
  stream,
  build: BUILD,
  ticket: TICKET,
  maxBodyBytes: MOST_READ,
  ours,
  sockets: sessions.sockets,
  /* A view ends with this process; a conversation run in the background does not (`endAll`). */
  onStop: () => theRuns(log).endAll(),
})

port = running.port
/* The skills name the origin this module is really on, not the one it preferred (skills.ts). */
servingAt(originFor(port))
sessions.listening(port)
