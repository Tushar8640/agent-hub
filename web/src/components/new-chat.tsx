import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, FolderPlus, RefreshCw, Search, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/common'
import { Composer } from '@/components/composer'
import { errorText, post } from '@/lib/api'
import { TYPE_LABEL, FULL_ACCESS_NOTE } from '@/lib/format'
import { useHub } from '@/hooks/use-hub'
import { go } from '@/hooks/use-route'

// Start a chat: pick one agent or a workflow, a project, and (for git projects) whether it gets its own branch.
export function NewChat() {
  const { state, refresh } = useHub()
  const [kind, setKind] = useState<'agent' | 'workflow'>('agent')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [branch, setBranch] = useState(true)
  const [autoApprove, setAutoApprove] = useState(false)
  const [status, setStatus] = useState('')
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [projectSearch, setProjectSearch] = useState('')
  const [refreshingProjects, setRefreshingProjects] = useState(false)
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [addFolderPath, setAddFolderPath] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)

  const agents = state?.agents || []
  const workflows = state?.workflows || []
  const projects = state?.projects || []
  const chats = state?.chats || []

  const projectLastAt = chats.reduce<Record<string, number>>((acc, c) => {
    if (c.projectId && (!acc[c.projectId] || c.lastAt > acc[c.projectId])) {
      acc[c.projectId] = c.lastAt
    }
    return acc
  }, {})

  const sortedProjects = [...projects].sort((a, b) => (projectLastAt[b.id] || 0) - (projectLastAt[a.id] || 0))
  const filteredProjects = sortedProjects.filter(p => {
    const q = projectSearch.trim().toLowerCase()
    return !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  })

  const rootsText = state?.roots?.length ? state.roots.join(', ') : 'none configured'

  const handleRefreshProjects = async () => {
    if (refreshingProjects) return
    setRefreshingProjects(true)
    const t = toast.loading('Refreshing projects…')
    try {
      await post('/api/projects/refresh')
      toast.success('Projects refreshed', { id: t })
      refresh()
    } catch (e) {
      toast.error(errorText(e, 'Could not refresh projects'), { id: t })
    } finally {
      setRefreshingProjects(false)
    }
  }

  const handleAddFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = addFolderPath.trim()
    if (!p || addingFolder) return
    setAddingFolder(true)
    const t = toast.loading('Adding project folder…')
    try {
      await post('/api/projects/add', { path: p })
      toast.success('Project added', { id: t })
      setAddFolderPath('')
      setShowAddFolder(false)
      refresh()
    } catch (e) {
      toast.error(errorText(e, 'Could not add folder'), { id: t })
    } finally {
      setAddingFolder(false)
    }
  }

  const pickedAgent = agents.find(a => a.id === targetId)
  const models = kind === 'agent' ? pickedAgent?.models || [] : []
  const currentWorkflow = kind === 'workflow' ? workflows.find(w => w.id === targetId) : undefined

  useEffect(() => {
    if (models.length > 0) setSelectedModel('default')
    else setSelectedModel(null)
  }, [targetId, kind])

  // Sensible defaults once the hub state arrives.
  useEffect(() => {
    if (!state) return
    setBranch(state.branchByDefault)
    const a = state.agents.find(x => x.available)
    if (a) { setKind('agent'); setTargetId(a.id) }
    else { const w = state.workflows.find(x => x.available); if (w) { setKind('workflow'); setTargetId(w.id) } }
    setProjectId(state.projects.find(p => !p.missing)?.id || null)
  }, [!!state]) // only once the hub state first arrives, so later updates do not undo the user's choice

  const project = projects.find(p => p.id === projectId)
  const isOn = (k: string, id: string) => kind === k && targetId === id

  const pick = (k: 'agent' | 'workflow', id: string) => { setKind(k); setTargetId(id) }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-15 items-center gap-2 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="md:hidden"><a href="#/" aria-label="Back to chats"><ChevronLeft /></a></Button>
        <div className="grid size-10 place-items-center rounded-full bg-linear-to-br from-violet-500 to-blue-500 text-lg font-bold text-white">+</div>
        <div className="min-w-0">
          <div className="font-semibold">New chat</div>
          <div className="truncate text-xs text-muted-foreground">Pick an agent or a workflow and a project, then send your first message</div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
        <div className="mx-auto grid max-w-3xl gap-3">
          <SectionLabel>Agent</SectionLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {agents.map(a => (
              <PickCard key={a.id} on={isOn('agent', a.id)} disabled={!a.available} onClick={() => pick('agent', a.id)}
                title={a.problem || (a.fullAccess ? FULL_ACCESS_NOTE : undefined)}>
                <AgentAvatar id={a.id} name={a.name} size="sm" />
                <span className="grid min-w-0">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {a.name}{a.fullAccess && <Badge variant="outline" className="border-amber-500/50 text-amber-400">full access</Badge>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{a.available ? TYPE_LABEL[a.type] || a.type : `Not available: ${a.problem || ''}`}</span>
                </span>
              </PickCard>
            ))}
            {!agents.length && <p className="text-sm text-muted-foreground">No agents yet. Add one to config.yaml on the PC.</p>}
          </div>

          {workflows.length > 0 && (
            <>
              <SectionLabel>Workflow <span className="font-normal normal-case text-muted-foreground">(several agents in turn)</span></SectionLabel>
              <div className="grid gap-2">
                {workflows.map(w => (
                  <PickCard key={w.id} on={isOn('workflow', w.id)} disabled={!w.available} onClick={() => pick('workflow', w.id)} title={w.problem || w.description}>
                    <AgentAvatar id={`wf:${w.id}`} name={w.name} size="sm" />
                    <span className="grid min-w-0">
                      <span className="flex items-center gap-1.5 truncate font-medium"><Workflow className="size-3.5" /> {w.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {w.available ? w.steps.map(s => `${s.label} (${s.agentName})`).join(' → ') : w.problem}
                      </span>
                    </span>
                  </PickCard>
                ))}
              </div>
            </>
          )}

          <div className="flex items-center justify-between">
            <SectionLabel>Project</SectionLabel>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddFolder(v => !v)}
                className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300"
              >
                <FolderPlus className="size-3.5" />
                <span>{showAddFolder ? 'Cancel' : 'Add folder…'}</span>
              </button>
              <button
                type="button"
                disabled={refreshingProjects}
                onClick={handleRefreshProjects}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={cn('size-3', refreshingProjects && 'animate-spin')} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {showAddFolder && (
            <form onSubmit={handleAddFolder} className="flex gap-2">
              <Input
                type="text"
                placeholder="Folder path (e.g. D:\projects\my-app)"
                value={addFolderPath}
                onChange={e => setAddFolderPath(e.target.value)}
                className="h-8 font-mono text-xs"
                autoFocus
              />
              <Button type="submit" size="sm" className="h-8 text-xs" disabled={addingFolder || !addFolderPath.trim()}>
                {addingFolder ? 'Adding…' : 'Add'}
              </Button>
            </form>
          )}

          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search projects by name or path…"
              value={projectSearch}
              onChange={e => setProjectSearch(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {filteredProjects.map(p => (
              <PickCard key={p.id} on={projectId === p.id} disabled={p.missing} onClick={() => setProjectId(p.id)}>
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{p.missing ? `Folder not found: ${p.path}` : p.path}</span>
                </span>
              </PickCard>
            ))}
            {!filteredProjects.length && (
              <p className="col-span-2 text-sm text-muted-foreground">
                {projectSearch ? 'No matching projects found.' : `No projects yet. Projects are found inside: ${rootsText}. Add more roots in config.yaml.`}
              </p>
            )}
          </div>

          {project?.git ? (
            <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
              <Switch id="own-branch" checked={branch} onCheckedChange={setBranch} className="mt-0.5" />
              <Label htmlFor="own-branch" className="grid cursor-pointer gap-1 font-normal">
                <span className="font-medium">Work on its own branch</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Recommended when several agents work at once. Changes stay on the branch until you press "Apply to project".
                  Without it, agents change the project folder directly.
                </span>
              </Label>
            </div>
          ) : project ? (
            <p className="text-xs text-muted-foreground">This project is not a git repository, so changes cannot be listed or undone.</p>
          ) : null}

          {kind === 'workflow' && currentWorkflow?.hasApproval && (
            <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
              <Switch id="auto-approve" checked={autoApprove} onCheckedChange={setAutoApprove} className="mt-0.5" />
              <Label htmlFor="auto-approve" className="grid cursor-pointer gap-1 font-normal">
                <span className="font-medium">Auto build</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Run the Build step without waiting for my approval.
                </span>
              </Label>
            </div>
          )}

          <p className="text-xs text-muted-foreground">Projects are found inside: {rootsText}. Add more roots in config.yaml.</p>
          {status && <p className="text-xs text-muted-foreground">{status}</p>}
        </div>
      </div>

      <Composer
        agentId={kind === 'agent' ? targetId || undefined : undefined}
        models={kind === 'agent' ? models : undefined}
        currentModel={selectedModel}
        onModelChange={setSelectedModel}
        hint="Enter to send, Shift+Enter for a new line"
        onSend={async (text, attachments) => {
          if (!targetId || !projectId) return 'Pick an agent or a workflow, and a project.'
          const useBranch = !!project?.git && branch
          if (useBranch) setStatus('Creating the branch…')
          try {
            const out = await post<{ id: number }>('/api/chats', {
              ...(kind === 'workflow' ? { workflowId: targetId, autoApprove } : { agentId: targetId }),
              projectId, prompt: text, attachments, branch: useBranch,
              model: selectedModel || undefined,
            })
            refresh()
            go(`#/chat/${out.id}`)
          } catch (e) {
            return errorText(e, 'Could not start the chat.')
          } finally { setStatus('') }
        }}
      />
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mt-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">{children}</div>
}

function PickCard({ on, disabled, onClick, title, children }: {
  on: boolean; disabled?: boolean; onClick: () => void; title?: string; children: ReactNode
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title}
      className={cn('flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/60',
        on && 'border-primary ring-2 ring-primary/30', disabled && 'cursor-not-allowed opacity-50')}>
      {children}
    </button>
  )
}
