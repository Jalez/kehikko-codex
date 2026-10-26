import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { HERE_COMMAND, NONE_CONNECTED } from './conversations.ts'

/** Put text on the clipboard: the async API where the frame may use it, else a selection copied the old way. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* A frame without the clipboard permission: the old way below. */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const done = document.execCommand?.('copy') ?? false
    area.remove()
    return Boolean(done)
  } catch {
    return false
  }
}

/**
 * The one line above the terminal while no conversation is connected to this kehikko
 * (`view/conversations.ts`): what is true, what to type and where, and the command to copy.
 * One row at any width it fits in, wrapping under that; never an Inbox item.
 */
export function NoConversationBar({ copy = copyText }: { copy?: (text: string) => Promise<boolean> }) {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  const [before, after] = NONE_CONNECTED.split(HERE_COMMAND) as [string, string]
  return (
    <div className="flex items-center gap-2 border-b px-2 py-1 text-[11px]" role="status" data-no-conversation>
      <span className="text-muted-foreground min-w-0 flex-1">
        {before}
        <code className="text-foreground">{HERE_COMMAND}</code>
        {after}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-6 shrink-0 px-2 text-xs"
        data-copy-command
        title={copied === 'failed' ? `Could not copy: select ${HERE_COMMAND} and copy it` : `Copy ${HERE_COMMAND}`}
        onClick={() => void copy(HERE_COMMAND).then((done) => setCopied(done ? 'yes' : 'failed'))}
      >
        {copied === 'yes' ? 'Copied' : `Copy ${HERE_COMMAND}`}
      </Button>
    </div>
  )
}
