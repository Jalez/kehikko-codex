import { Component, StrictMode, type ComponentType, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'
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
  useHost(ID)
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

  componentDidCatch(error: unknown) {
    console.error('codex: the page failed while drawing, and shows why instead', error)
  }

  render() {
    return this.state.failed ? <Broken error={this.state.error} /> : this.props.children
  }
}

/** Load the app and draw it into `root`; draw `Broken` when the load fails. */
export async function start(root: Root, load: () => Promise<{ App: ComponentType }>): Promise<void> {
  try {
    const { App } = await load()
    root.render(
      <StrictMode>
        <Guard>
          <App />
        </Guard>
      </StrictMode>,
    )
  } catch (error) {
    console.error('codex: the page failed to load, and shows why instead', error)
    root.render(<Broken error={error} />)
  }
}
