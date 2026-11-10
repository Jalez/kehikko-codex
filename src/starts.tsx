import { Component, useEffect, type ComponentType, type ReactNode } from 'react'
import { reportPageError } from 'kehikot-module-protocol/client'
import { useHost } from 'kehikot-module-protocol/client/react'

import { ID } from '../ids.ts'

/**
 * How the page starts, so that it answers its host whatever goes wrong while it does.
 *
 * The greeting is answered from inside the app: `useHost` connects in an effect. So a page whose
 * app fails — an import that throws while the page's modules are evaluated, or a render that throws
 * on the first greeting — answered nothing, and the host could say only that the page was served and
 * chose not to answer. Here the app is loaded after the protocol's mailbox is listening (`main.tsx`
 * imports the client first), and when loading or drawing it fails, `Broken` is drawn instead: it
 * answers the greeting itself and says, in words, what failed.
 */

/** Why the page could not start, as one sentence for the person. Text, never markup. */
export function whyBroken(error: unknown): string {
  const said = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return said.trim().slice(0, 400) || 'It failed without saying why.'
}

/** In place of the app: answers the host, so the container is not silent, and says what failed. */
export function Broken({ error }: { error: unknown }) {
  const { ready } = useHost(ID)
  /* What it shows is drawn at once (protocol 2.70.0): the host's cover comes off over the words. */
  useEffect(() => ready(), [ready])
  return (
    <div role="alert" data-broken className="text-muted-foreground flex h-full flex-col justify-center gap-1 p-3 text-xs">
      <p className="text-foreground font-medium">Codex’s page could not start.</p>
      <p className="break-words">{whyBroken(error)}</p>
      <p>Reload the container. If it happens again, update the module or tell whoever keeps it.</p>
    </div>
  )
}

/** The app, or `Broken` once anything under it throws while drawing or in an effect. */
export class Guard extends Component<{ children: ReactNode }, { error: unknown; failed: boolean }> {
  state = { error: null as unknown, failed: false }

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error('codex: the page failed while drawing, and shows why instead', error)
    /* Said to the host too (protocol 2.59.0), so its log and its condition can name it. */
    reportPageError(error, 'render', info.componentStack ?? undefined)
  }

  render() {
    return this.state.failed ? <Broken error={this.state.error} /> : this.props.children
  }
}

/**
 * Load the app and draw it with `mount`; draw `Broken` when the load fails. `main.tsx` mounts through the
 * protocol's `mountPage` (2.70.0: StrictMode, and a missing root said to the host), without its
 * `ReportErrors`, since `Guard` is this page's boundary and says more.
 */
export async function start(mount: (page: ReactNode) => unknown, load: () => Promise<{ App: ComponentType }>): Promise<void> {
  try {
    const { App } = await load()
    mount(
      <Guard>
        <App />
      </Guard>,
    )
  } catch (error) {
    console.error('codex: the page failed to load, and shows why instead', error)
    reportPageError(error, 'error')
    mount(<Broken error={error} />)
  }
}
