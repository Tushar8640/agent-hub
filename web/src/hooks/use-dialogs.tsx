// confirm() and prompt() replacements built on shadcn AlertDialog / Dialog, used as:
//   if (await confirm({ title, description, confirmText, destructive: true })) { ... }
//   const name = await prompt({ title, defaultValue })
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ConfirmOptions { title: string; description?: ReactNode; confirmText?: string; destructive?: boolean }
interface PromptOptions { title: string; description?: string; defaultValue?: string; confirmText?: string }

interface DialogsValue {
  confirm: (o: ConfirmOptions) => Promise<boolean>
  prompt: (o: PromptOptions) => Promise<string | null>
}
const DialogsContext = createContext<DialogsValue | null>(null)

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null)
  const [promptState, setPromptState] = useState<PromptOptions | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const resolver = useRef<((v: boolean) => void) | null>(null)
  const promptResolver = useRef<((v: string | null) => void) | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current = resolve
    setConfirmState(o)
  }), [])

  const prompt = useCallback((o: PromptOptions) => new Promise<string | null>(resolve => {
    promptResolver.current = resolve
    setPromptValue(o.defaultValue || '')
    setPromptState(o)
  }), [])

  const closeConfirm = (v: boolean) => { resolver.current?.(v); resolver.current = null; setConfirmState(null) }
  const closePrompt = (v: string | null) => { promptResolver.current?.(v); promptResolver.current = null; setPromptState(null) }

  return (
    <DialogsContext.Provider value={{ confirm, prompt }}>
      {children}
      <AlertDialog open={!!confirmState} onOpenChange={open => { if (!open) closeConfirm(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            {confirmState?.description && <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => closeConfirm(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant={confirmState?.destructive ? 'destructive' : 'default'} onClick={() => closeConfirm(true)}>
              {confirmState?.confirmText || 'OK'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={!!promptState} onOpenChange={open => { if (!open) closePrompt(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{promptState?.title}</DialogTitle>
            {promptState?.description && <DialogDescription>{promptState.description}</DialogDescription>}
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); closePrompt(promptValue) }} className="grid gap-4">
            <Input autoFocus value={promptValue} onChange={e => setPromptValue(e.target.value)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => closePrompt(null)}>Cancel</Button>
              <Button type="submit">{promptState?.confirmText || 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DialogsContext.Provider>
  )
}

export function useDialogs(): DialogsValue {
  const ctx = useContext(DialogsContext)
  if (!ctx) throw new Error('useDialogs must be used inside DialogsProvider')
  return ctx
}
