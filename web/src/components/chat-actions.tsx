import { useCallback } from 'react'
import { toast } from 'sonner'
import { errorText, getJSON, post } from '@/lib/api'
import { isBusy, type ChatDetail, type ChatSummary } from '@/lib/types'
import { useDialogs } from '@/hooks/use-dialogs'
import { useHub } from '@/hooks/use-hub'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Deletes a chat after confirmation. A chat that is still working is stopped first.
export function useDeleteChat() {
  const { confirm } = useDialogs()
  const { refresh } = useHub()
  return useCallback(async (c: ChatSummary): Promise<boolean> => {
    const busy = isBusy(c.status)
    const ok = await confirm({
      title: c.branch ? 'Delete this chat and its branch?' : 'Delete this chat?',
      description: (busy ? 'It is still working and will be stopped first. ' : '') + (c.branch
        ? 'Changes that were not applied to the project are lost. The project folder itself is not changed.'
        : 'Its history is removed from the hub. Project files are not changed.'),
      confirmText: busy ? 'Stop and delete' : 'Delete',
      destructive: true,
    })
    if (!ok) return false
    try {
      if (busy) {
        toast.loading('Stopping…', { id: `del-${c.id}` })
        await post(`/api/chats/${c.id}/abort`).catch(() => {})
        for (let i = 0; i < 40; i++) {
          await sleep(500)
          const d = await getJSON<ChatDetail>(`/api/chats/${c.id}`).catch(() => null)
          if (!d || !isBusy(d.chat.status)) break
        }
      }
      await post(`/api/chats/${c.id}/delete`)
      toast.success('Chat deleted', { id: `del-${c.id}` })
      refresh()
      return true
    } catch (e) {
      toast.error(errorText(e, 'Could not delete the chat.'), { id: `del-${c.id}` })
      return false
    }
  }, [confirm, refresh])
}
