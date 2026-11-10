import './index.css'

/* For its side effect: installs the mailbox before React mounts, so a host's
   greeting that arrives early is held rather than lost. */
import 'kehikot-module-protocol/client'
import { mountPage } from 'kehikot-module-protocol/client/mount'
import { start } from './starts.tsx'

/* The app is loaded by `start`, which draws a page that still answers the host,
   and says what failed, when loading or drawing it throws (`src/starts.tsx`). */
void start(
  (page) => mountPage('root', page, { reportErrors: false }),
  async () => {
    const [{ keepFramesComing }, app] = await Promise.all([import('./view/frames.ts'), import('./app.tsx')])
    /* Before anything on this page asks for a frame. WebKit serves a framed page
       one animation frame every ten seconds in some states, and xterm draws only
       inside one; from here on a frame that is owed is drawn from a one-shot
       timer instead. `src/view/frames.ts` is Terminal's, with its measurements. */
    keepFramesComing()
    return app
  },
)
