// Talking to the hub. Every POST carries X-Hub: 1 (the hub refuses POSTs without it, which blocks cross-site requests).

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Called when the hub says this device is not paired (e.g. it was removed on the PC).
const unauthorizedListeners = new Set<() => void>()
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedListeners.add(fn)
  return () => { unauthorizedListeners.delete(fn) }
}

async function handle<T>(r: Response): Promise<T> {
  if (r.status === 401) {
    unauthorizedListeners.forEach(fn => fn())
    throw new ApiError(401, 'This device is not paired.')
  }
  const out = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new ApiError(r.status, out.error || `Request failed (${r.status})`)
  return out as T
}

export async function getJSON<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { cache: 'no-store' }))
}

export async function post<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  return handle<T>(await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub': '1' },
    body: JSON.stringify(body || {}),
  }))
}

export async function getText(url: string): Promise<string | null> {
  const r = await fetch(url, { cache: 'no-store' })
  if (r.status === 401) unauthorizedListeners.forEach(fn => fn())
  return r.ok ? r.text() : null
}

export interface UploadResult { id: string; name: string; size: number; type: string }
export async function uploadFile(file: File): Promise<UploadResult> {
  return handle<UploadResult>(await fetch(`/api/uploads?name=${encodeURIComponent(file.name || 'pasted-file')}`, {
    method: 'POST',
    headers: { 'X-Hub': '1', 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }))
}

export const errorText = (e: unknown, fallback = 'Something went wrong.') => (e instanceof Error ? e.message : fallback)
