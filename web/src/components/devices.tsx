import { useCallback, useEffect, useState } from 'react'
import { QrCode } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Page } from '@/components/page'
import { errorText, getJSON, post } from '@/lib/api'
import { dur, fmtTime, listTime } from '@/lib/format'
import type { DeviceInfo, PairLink } from '@/lib/types'
import { useHub, useNow } from '@/hooks/use-hub'
import { useDialogs } from '@/hooks/use-dialogs'

// PC only: show a one-time pairing QR code, and list / remove paired devices.
export function Devices() {
  const { version, clockSkew } = useHub()
  const { confirm } = useDialogs()
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null)
  const [pairing, setPairing] = useState<{ expiresAt: number; links: PairLink[] } | null>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const now = useNow(1000, !!pairing)

  const load = useCallback(() => {
    getJSON<{ devices: DeviceInfo[] }>('/api/devices').then(d => setDevices(d.devices)).catch(() => setDevices([]))
  }, [])
  useEffect(load, [load, version])

  const newCode = async () => {
    setBusy(true)
    try {
      const r = await post<{ expiresAt: number; links: PairLink[] }>('/api/pairing')
      setPairing({ ...r, expiresAt: r.expiresAt - clockSkew })
      setIndex(0)
    } catch (e) { toast.error(errorText(e, 'Could not create a pairing code.')) }
    setBusy(false)
  }

  const left = pairing ? pairing.expiresAt - now : 0
  const link = pairing?.links[index] || pairing?.links[0]

  return (
    <Page title="Devices" subtitle="Pair a phone and manage paired devices">
      <Card>
        <CardHeader>
          <CardTitle>Pair a phone</CardTitle>
          <CardDescription>The QR code works once, for 5 minutes. Scan it with the phone's camera; the phone must be on the same Wi-Fi or on Tailscale.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button className="w-fit" disabled={busy} onClick={newCode}><QrCode /> Show pairing QR code</Button>
          {pairing && left <= 0 && <p className="text-sm text-muted-foreground">This code has expired. Show a new one.</p>}
          {pairing && left > 0 && !pairing.links.length && (
            <p className="text-sm text-muted-foreground">No network address found. Connect this PC to Wi-Fi or Tailscale, or set publicUrl in config.yaml.</p>
          )}
          {pairing && left > 0 && link && (
            <div className="grid justify-items-start gap-3">
              {pairing.links.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {pairing.links.map((l, i) => (
                    <Button key={l.url} size="sm" variant={i === index ? 'default' : 'outline'} onClick={() => setIndex(i)}>{l.label}</Button>
                  ))}
                </div>
              )}
              <img src={link.qr} alt="Pairing QR code" className="size-60 rounded-xl bg-white p-2 [image-rendering:pixelated]" />
              <code className="max-w-full text-xs break-all text-muted-foreground">{link.url}</code>
              <p className="text-sm text-muted-foreground">Expires in <b className="text-foreground">{dur(left)}</b></p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Paired devices</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          {devices === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {devices?.length === 0 && <p className="text-sm text-muted-foreground">No devices paired yet.</p>}
          {devices?.map(d => (
            <div key={d.id} className="flex items-center gap-3 border-t pt-2 first:border-t-0 first:pt-0">
              <div className="min-w-0 flex-1">
                <b className="block truncate">{d.name}</b>
                <span className="text-xs text-muted-foreground">Paired {listTime(d.createdAt)} · last seen {listTime(d.lastSeenAt)} {fmtTime(d.lastSeenAt)}</span>
              </div>
              <Button variant="destructive" size="sm" onClick={async () => {
                if (!await confirm({ title: `Remove ${d.name}?`, description: 'It will need to be paired again.', confirmText: 'Remove', destructive: true })) return
                await post(`/api/devices/${d.id}/revoke`).catch(() => {})
                load()
              }}>Remove</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Use it away from home</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Install Tailscale on this PC and on your phone and sign in to the same account. The phone can then reach the hub from anywhere,
            without opening ports on your router. For an installable app with HTTPS, run <code>tailscale serve</code> for port 8650 and put
            the HTTPS address in <code>publicUrl</code> in config.yaml.
          </p>
        </CardContent>
      </Card>
    </Page>
  )
}
