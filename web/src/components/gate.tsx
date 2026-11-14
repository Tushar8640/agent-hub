// Screens shown before the app: pair this device (opened from the QR code), not paired, or hub unreachable.
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorText, post } from '@/lib/api'

function Shell({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <Card className="w-full max-w-sm text-center">
        <CardHeader className="justify-items-center">
          <div className="mb-2 grid size-16 place-items-center rounded-2xl bg-linear-to-br from-violet-500 to-blue-500 text-3xl font-extrabold text-white">A</div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children && <CardContent className="grid gap-3">{children}</CardContent>}
      </Card>
    </div>
  )
}

function deviceGuess() {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'Android phone'
  if (/iPhone|iPad/i.test(ua)) return 'iPhone'
  if (/Windows/i.test(ua)) return 'Windows PC'
  if (/Mac/i.test(ua)) return 'Mac'
  return 'My device'
}

export function PairScreen({ code }: { code: string }) {
  const [name, setName] = useState(deviceGuess())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pair = async () => {
    setBusy(true)
    setError('')
    try {
      await post('/api/pair', { code, name })
      history.replaceState(null, '', '/#/')
      location.reload()
    } catch (e) { setError(errorText(e, 'Pairing failed.')); setBusy(false) }
  }
  return (
    <Shell title="Pair this device" description="This connects the device to Agent Hub on your PC. Only pair devices you own.">
      <form className="grid gap-3 text-left" onSubmit={e => { e.preventDefault(); pair() }}>
        <Label htmlFor="device-name">Device name</Label>
        <Input id="device-name" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
        <Button type="submit" disabled={busy}>Pair this device</Button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Shell>
  )
}

export function NotPairedScreen({ port }: { port: number }) {
  return (
    <Shell title="This device is not paired"
      description={<>On your PC, open <code>http://localhost:{port}</code>, choose <b>Devices → Show pairing QR code</b>, and scan the code with this device's camera.</>}>
      <Button variant="outline" onClick={() => location.reload()}>Try again</Button>
    </Shell>
  )
}

export function OfflineScreen() {
  return (
    <Shell title="Can't reach the hub" description="Check that the PC is on and Agent Hub is running.">
      <Button variant="outline" onClick={() => location.reload()}>Try again</Button>
    </Shell>
  )
}
