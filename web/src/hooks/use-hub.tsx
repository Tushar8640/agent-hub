// Live hub data. The hub pushes "changed" over Server-Sent Events; we then reload /api/state and bump `version`,
// which screens use to reload their own data (chat detail, dashboard, devices).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { getJSON } from '@/lib/api'
import type { HubState, Me } from '@/lib/types'

interface HubContextValue {
  me: Me
  state: HubState | null
  online: boolean
  version: number
  clockSkew: number // hub time minus this device's time
  refresh: () => void
}

const HubContext = createContext<HubContextValue | null>(null)

export function HubProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [state, setState] = useState<HubState | null>(null)
  const [online, setOnline] = useState(false)
  const [version, setVersion] = useState(0)
  const [clockSkew, setClockSkew] = useState(0)
  const loading = useRef(false)
  const again = useRef(false)

  const refresh = useCallback(() => {
    if (loading.current) { again.current = true; return }
    loading.current = true
    getJSON<HubState>('/api/state')
      .then(s => { setState(s); setClockSkew(s.now - Date.now()); setVersion(v => v + 1) })
      .catch(() => {})
      .finally(() => {
        loading.current = false
        if (again.current) { again.current = false; refresh() }
      })
  }, [])

  useEffect(() => {
    refresh()
    const events = new EventSource('/api/events')
    events.onopen = () => { setOnline(true); refresh() }
    events.onerror = () => setOnline(false)
    events.addEventListener('changed', () => refresh())
    return () => events.close()
  }, [refresh])

  return <HubContext.Provider value={{ me, state, online, version, clockSkew, refresh }}>{children}</HubContext.Provider>
}

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext)
  if (!ctx) throw new Error('useHub must be used inside HubProvider')
  return ctx
}

// Re-renders every `ms` (for "running for 1m 20s" timers).
export function useNow(ms = 1000, active = true): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms, active])
  return now
}
