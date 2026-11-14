import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { getJSON, onUnauthorized } from '@/lib/api'
import type { Me } from '@/lib/types'
import { HubProvider, useHub } from '@/hooks/use-hub'
import { DialogsProvider } from '@/hooks/use-dialogs'
import { useRoute } from '@/hooks/use-route'
import { Sidebar } from '@/components/sidebar'
import { ChatView } from '@/components/chat-view'
import { NewChat } from '@/components/new-chat'
import { Dashboard } from '@/components/dashboard'
import { Settings } from '@/components/settings'
import { Devices } from '@/components/devices'
import { NotPairedScreen, OfflineScreen, PairScreen } from '@/components/gate'

// Start-up: who am I? Then pairing screen, "not paired", or the app.
export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [failed, setFailed] = useState(false)
  const [unpaired, setUnpaired] = useState(false)
  const pairCode = location.hash.match(/^#pair=([\w-]+)$/)?.[1]

  useEffect(() => {
    getJSON<Me>('/api/me').then(setMe).catch(() => setFailed(true))
    return onUnauthorized(() => setUnpaired(true))
  }, [])

  if (failed) return <OfflineScreen />
  if (!me) return null
  if (pairCode && !me.local) return <PairScreen code={pairCode} />
  if (pairCode) history.replaceState(null, '', '/#/') // a pairing link opened on the PC itself
  if (!me.authed || unpaired) return <NotPairedScreen port={me.port} />

  return (
    <HubProvider me={me}>
      <DialogsProvider>
        <Shell />
        <Toaster theme="dark" position="bottom-center" />
      </DialogsProvider>
    </HubProvider>
  )
}

const wide = () => matchMedia('(min-width: 768px)').matches

function Shell() {
  const route = useRoute()
  const { state } = useHub()

  // On a wide screen, open the most recent chat instead of the empty home screen (once, at start-up).
  const [redirected, setRedirected] = useState(false)
  useEffect(() => {
    if (redirected || !state) return
    setRedirected(true)
    if (route.name === 'home' && wide() && state.chats.length) location.replace(`#/chat/${state.chats[0].id}`)
  }, [state, route.name, redirected])

  const home = route.name === 'home'
  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Phone: one screen at a time (the chat list is the home screen). PC: list on the left, screen on the right. */}
      <aside className={cn('w-full min-w-0 border-r bg-sidebar md:flex md:w-[360px] md:shrink-0', home ? 'flex' : 'hidden')}>
        <Sidebar />
      </aside>
      <main className={cn('min-w-0 flex-1 md:flex', home ? 'hidden' : 'flex')}>
        {route.name === 'chat' && <ChatView key={route.id} id={route.id} />}
        {route.name === 'new' && <NewChat />}
        {route.name === 'dashboard' && <Dashboard />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'devices' && <Devices />}
        {home && <Welcome />}
      </main>
    </div>
  )
}

function Welcome() {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div className="grid justify-items-center gap-3 text-muted-foreground">
        <div className="grid size-18 place-items-center rounded-3xl bg-linear-to-br from-violet-500 to-blue-500 text-3xl font-extrabold text-white shadow-lg shadow-violet-500/20">A</div>
        <h2 className="text-xl font-semibold text-foreground">Your agents, in one place</h2>
        <p>Start a chat with any agent in any project.<br />Chats keep their context, and several agents can work at once.</p>
        <Button asChild><a href="#/new">Start a new chat</a></Button>
      </div>
    </div>
  )
}
