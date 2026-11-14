import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowDownToLine, Check, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Page } from '@/components/page'
import { errorText, getJSON, post } from '@/lib/api'
import { TYPE_LABEL } from '@/lib/format'
import type { SettingsView } from '@/lib/types'
import { useHub } from '@/hooks/use-hub'
import { useDialogs } from '@/hooks/use-dialogs'
import { useInstallPrompt } from '@/lib/install'

export function Settings() {
  const { refresh } = useHub()
  const { confirm } = useDialogs()
  const [s, setS] = useState<SettingsView | null>(null)
  const [form, setForm] = useState({ maxParallel: 3, runTimeoutMinutes: 20, branchByDefault: true })
  const [error, setError] = useState('')
  const { canInstall, isInstalled, isSecure, promptInstall } = useInstallPrompt()

  const load = useCallback(() => {
    getJSON<SettingsView>('/api/settings')
      .then(v => { setS(v); setForm(v.settings); setError('') })
      .catch(e => setError(errorText(e)))
  }, [])
  useEffect(load, [load])

  const save = async () => {
    try { await post('/api/settings', form); toast.success('Settings saved'); refresh(); load() }
    catch (e) { toast.error(errorText(e, 'Could not save')) }
  }
  const resetDefaults = async () => {
    await post('/api/settings', { reset: true }).catch(() => {})
    toast.success('Back to the config.yaml defaults')
    refresh(); load()
  }
  const removeAddedProject = async (id: string, name: string) => {
    if (!await confirm({
      title: `Remove "${name}"?`,
      description: 'This folder will be removed from added projects. Existing chats are not deleted.',
      confirmText: 'Remove',
      destructive: true,
    })) return
    const t = toast.loading('Removing project…')
    try {
      await post(`/api/projects/${id}/remove`)
      toast.success('Project removed', { id: t })
      refresh()
      load()
    } catch (e) {
      toast.error(errorText(e, 'Could not remove project'), { id: t })
    }
  }
  const restart = async () => {
    if (!await confirm({
      title: 'Restart the hub?',
      description: 'It is back in about 20 seconds. This works when the hub was started with scripts\\start.bat or autostart.',
      confirmText: 'Restart',
    })) return
    try { await post('/api/hub/restart'); toast.success('Restarting… reconnecting in about 20 seconds') }
    catch (e) { toast.error(errorText(e, 'Could not restart.')) }
  }

  return (
    <Page title="Settings" subtitle="How the hub runs your agents">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!s && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {s && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Running agents</CardTitle>
              <CardDescription>Changes apply immediately.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Chats working at the same time" help={`Extra messages wait in a queue. Default ${s.defaults.maxParallel}.`}>
                <Input type="number" min={1} max={10} className="w-24" value={form.maxParallel}
                  onChange={e => setForm(f => ({ ...f, maxParallel: Number(e.target.value) }))} />
              </Field>
              <Separator />
              <Field label="Time limit per message (minutes)" help={`A message still running after this is stopped. Default ${s.defaults.runTimeoutMinutes}.`}>
                <Input type="number" min={1} max={240} className="w-24" value={form.runTimeoutMinutes}
                  onChange={e => setForm(f => ({ ...f, runTimeoutMinutes: Number(e.target.value) }))} />
              </Field>
              <Separator />
              <Field label="New chats work on their own branch" help="Default for git projects; can be changed per chat.">
                <Switch checked={form.branchByDefault} onCheckedChange={v => setForm(f => ({ ...f, branchByDefault: v }))} />
              </Field>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={save}>Save</Button>
                <Button variant="outline" onClick={resetDefaults}>Use config.yaml defaults</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Agents</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {s.agents.map(a => (
                <div key={a.id} className="grid gap-1 border-t pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{a.name}</b>
                    <span className="text-xs text-muted-foreground">{TYPE_LABEL[a.type] || a.type}</span>
                    {!a.available && <Badge variant="destructive">{a.problem || 'not available'}</Badge>}
                    {a.fullAccess && <Badge variant="outline" className="border-amber-500/50 text-amber-400">full access</Badge>}
                  </div>
                  <p className="text-xs break-words text-muted-foreground">
                    {a.fullAccess ? 'Runs without permission checks.'
                      : a.permissionMode || a.allowedTools ? `Permissions: ${a.permissionMode || 'default'}${a.allowedTools ? ` · ${a.allowedTools.join(', ')}` : ''}`
                      : 'Uses its own defaults.'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Workflows</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {!s.workflows.length && <p className="text-sm text-muted-foreground">None</p>}
              {s.workflows.map(w => (
                <div key={w.id} className="grid gap-1 border-t pt-3 first:border-t-0 first:pt-0">
                  <b>{w.name}</b>
                  <p className="text-xs text-muted-foreground">
                    {w.steps.map(x => `${x.label} (${x.agentName})`).join(' → ')}
                    {w.approvals.length ? ` · asks approval before ${w.approvals.join(', ')}` : ''}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
              {s.roots && s.roots.length > 0 && (
                <CardDescription>
                  Discovered inside roots: {s.roots.join(', ')}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="grid gap-3">
              {s.projects.map(p => (
                <div key={p.id} className="flex items-start justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0">
                  <div className="grid min-w-0 gap-1">
                    <div className="flex items-center gap-2">
                      <b className="truncate">{p.name}</b>
                      {p.source && (
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {p.source}
                        </Badge>
                      )}
                    </div>
                    <span className="truncate font-mono text-xs text-muted-foreground">{p.path}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.missing ? <span className="text-red-400">folder not found</span>
                        : p.git ? 'git repository: branches, change lists and undo available' : 'not a git repository'}
                    </span>
                  </div>
                  {p.source === 'added' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-red-400"
                      onClick={() => removeAddedProject(p.id, p.name)}
                      title="Remove this added project"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hub</CardTitle>
              <CardDescription>
                {s.hub.name} · port {s.hub.port} · {s.hub.host === '127.0.0.1' ? 'this PC only' : 'reachable on your network (paired devices only)'}
                {s.hub.publicUrl ? ` · ${s.hub.publicUrl}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Agents, workflows, project roots and agent permissions are set in <code>config.yaml</code> on the PC, then the hub is restarted.
                They cannot be changed from the app.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={restart}>Restart hub</Button>
                {s.local && <Button asChild variant="outline"><a href="#/devices">Paired devices</a></Button>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>App installation</CardTitle>
              <CardDescription>Install Agent Hub as a standalone mobile or desktop app.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {isInstalled ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="size-4 text-emerald-500" />
                  Agent Hub is already installed on this device.
                </p>
              ) : canInstall ? (
                <div className="grid gap-2">
                  <p className="text-sm text-muted-foreground">
                    You can install Agent Hub to your home screen for quick access and a full-screen experience.
                  </p>
                  <div>
                    <Button
                      onClick={async () => {
                        const ok = await promptInstall()
                        if (ok) toast.success('Agent Hub installed')
                      }}
                      className="gap-2"
                    >
                      <ArrowDownToLine className="size-4" />
                      Install app
                    </Button>
                  </div>
                </div>
              ) : !isSecure ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                  <p className="font-medium text-amber-200">Installation requires HTTPS</p>
                  <p className="mt-1 text-muted-foreground">
                    Browsers only allow installing web apps over a secure HTTPS connection.
                    {s.hub.publicUrl ? (
                      <>
                        {' '}Open the hub via its HTTPS address:{' '}
                        <a href={s.hub.publicUrl} className="underline text-foreground" target="_blank" rel="noreferrer">
                          {s.hub.publicUrl}
                        </a>
                      </>
                    ) : (
                      ' Configure a public HTTPS address or Tailscale in config.yaml to enable installation on mobile.'
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  To install, open your browser menu (⋮ in Chrome or Share in Safari) and choose &quot;Install app&quot; or &quot;Add to Home Screen&quot;.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  )
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="grid gap-1 font-normal">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{help}</span>
      </Label>
      {children}
    </div>
  )
}
