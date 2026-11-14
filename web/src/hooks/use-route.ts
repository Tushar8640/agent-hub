// Hash routing: #/  #/chat/<id>  #/new  #/dashboard  #/settings  #/devices
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'chat'; id: number }
  | { name: 'new' }
  | { name: 'dashboard' }
  | { name: 'settings' }
  | { name: 'devices' }

export function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/chat\/(\d+)$/)
  if (m) return { name: 'chat', id: Number(m[1]) }
  if (hash === '#/new') return { name: 'new' }
  if (hash === '#/dashboard') return { name: 'dashboard' }
  if (hash === '#/settings') return { name: 'settings' }
  if (hash === '#/devices') return { name: 'devices' }
  return { name: 'home' }
}

const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return parseRoute(hash)
}

export const go = (hash: string) => { location.hash = hash }
