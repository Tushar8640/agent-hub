// Shapes of the hub's API responses (see hub/index.ts).

export type RunStatus = 'queued' | 'awaiting' | 'running' | 'done' | 'error' | 'aborted' | 'interrupted'

export interface Activity { at: number; icon: string; text: string }
export interface RunWorkflow { id: string; step: number; steps: number; label: string; input: string }
export interface FileInfo { id: string; name: string; size: number; type: string }
export interface ChangedFile { path: string; status: string; added: number | null; removed: number | null }
export interface RunChanges {
  mode: 'branch' | 'direct'; files: ChangedFile[]; commit: string | null; truncated: boolean
  undone: boolean; error: string | null; hasDiff: boolean
}

export interface Run {
  id: number; chatId: number; agentId: string; agentName: string; workflow?: RunWorkflow
  prompt: string; display?: string; attachments?: FileInfo[]; source: string; status: RunStatus
  createdAt: number; startedAt: number | null; endedAt: number | null
  result: string | null; error: string | null; costUsd: number | null
  activity: Activity[]; handoff?: string; changes: RunChanges | null
  model?: string | null
  resolvedModel?: string | null
}

export interface AgentModel {
  id: string
  label: string
  description?: string
}

export interface AgentInfo {
  id: string; name: string; type: string; available: boolean; problem: string | null
  resumable: boolean; fullAccess: boolean; usageSummary?: string | null
  models?: AgentModel[]
}
export interface WorkflowInfo {
  id: string; name: string; description: string; available: boolean; problem: string | null
  steps: { agentId: string; agentName: string; label: string }[]
}
export interface ProjectInfo { id: string; name: string; path: string; missing: boolean; git: boolean; source?: 'config' | 'discovered' | 'added' }

export interface ChatSummary {
  id: number; title: string; status: string; preview: { who: string; text: string } | null
  kind: 'agent' | 'workflow'; workflowId: string | null; branch: { name: string; mergedAt: number | null } | null
  skipPermissions: boolean // agents in this chat run with --dangerously-skip-permissions
  agentId: string; agentName: string; projectId: string; projectName: string
  model?: string | null
  runCount: number; costUsd: number; lastAt: number; createdAt: number
}

export interface HubState {
  now: number; name: string; maxParallel: number; branchByDefault: boolean
  agents: AgentInfo[]; workflows: WorkflowInfo[]; projects: ProjectInfo[]; chats: ChatSummary[]
  stats: { running: number; queued: number; costToday: number | null }
  roots?: string[]
}

export interface ChatDetail { chat: ChatSummary; runs: Run[] }
export interface Me { authed: boolean; local: boolean; device: { id: string; name: string } | null; name: string; port: number }
export interface DeviceInfo { id: string; name: string; createdAt: number; lastSeenAt: number }
export interface PairLink { label: string; url: string; qr: string }

export interface UsageWindow { key: string; label: string; utilization: number | null; resetsAt: number | null }
export interface AntigravityBucket {
  id: string
  name: string
  description?: string
  window: string
  remaining_fraction: number
  reset_time: string
}
export interface AntigravityGroup {
  name: string
  description?: string
  buckets: AntigravityBucket[]
}
export interface UsageSnapshot {
  updatedAt: number
  status: string | null
  windows: UsageWindow[]
  text?: string
  source?: string
  groups?: AntigravityGroup[]
}
export interface PeriodStats {
  messages: number; done: number; errors: number; tokensIn: number; tokensOut: number
  costUsd: number | null; avgSeconds: number | null
}
export interface AgentDash extends AgentInfo {
  canProbe: boolean; probing: boolean
  usage: UsageSnapshot | null
  running: number; chats: number; lastUsedAt: number | null; today: PeriodStats; week: PeriodStats
}
export interface ActiveRun {
  runId: number; chatId: number; chatTitle: string; status: string; agentName: string
  startedAt: number | null; createdAt: number; step: string | null
}
export interface SystemDisk {
  drive: string
  totalBytes: number
  freeBytes: number
  usedBytes: number
  usedPercent: number
}
export interface SystemStats {
  ram: {
    totalBytes: number
    freeBytes: number
    usedBytes: number
    usedPercent: number
  }
  disks: SystemDisk[]
  cpuCount?: number
  uptimeSeconds?: number
}
export interface Dashboard { now: number; agents: AgentDash[]; active: ActiveRun[]; limits: { maxParallel: number }; system?: SystemStats }

export interface SettingsView {
  local: boolean
  settings: { maxParallel: number; runTimeoutMinutes: number; branchByDefault: boolean; addedProjects?: string[] }
  defaults: { maxParallel: number; runTimeoutMinutes: number; branchByDefault: boolean }
  hub: { name: string; port: number; host: string; publicUrl: string | null }
  agents: (AgentInfo & { permissionMode: string | null; allowedTools: string[] | null })[]
  workflows: (WorkflowInfo & { approvals: string[] })[]
  projects: ProjectInfo[]
  roots?: string[]
}

export const isBusy = (status: string) => status === 'running' || status === 'queued' || status === 'awaiting'
