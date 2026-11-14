// 'awaiting' = a workflow step waiting for the user to approve (or edit) the previous step's reply.
export type RunStatus = 'queued' | 'awaiting' | 'running' | 'done' | 'error' | 'aborted' | 'interrupted';
export type RunSource = 'app' | 'pc';

export interface Activity { at: number; icon: string; text: string }

// A file uploaded from the app. Stored in data/uploads; `path` never leaves the PC except inside agent prompts.
export interface Upload { id: string; name: string; size: number; type: string; path: string; createdAt: number; chatId: number | null }
export type Attachment = Omit<Upload, 'createdAt' | 'chatId'>;

// Set on runs that belong to a workflow message (e.g. step 1 = plan with Claude, step 2 = build with Antigravity).
export interface RunWorkflow { id: string; step: number; steps: number; label: string; input: string }

export interface ChangedFile { path: string; status: string; added: number | null; removed: number | null }

// What a run changed in the project. 'branch' = in the chat's own git worktree (one checkpoint commit per run);
// 'direct' = straight in the project folder (compared with a snapshot taken just before the run).
export interface RunChanges {
  mode: 'branch' | 'direct';
  files: ChangedFile[];
  commit?: string | null;     // branch mode: the checkpoint commit
  createdFiles?: string[];    // direct mode: new untracked files (deleted on undo)
  patchFile?: string;         // stored diff, served by /api/runs/:id/diff
  truncated?: boolean;
  undone?: boolean;
  error?: string;
}

export interface Run {
  id: number;
  chatId: number;
  agentId: string;      // the agent that answers this run (a workflow chat uses several)
  model?: string | null; // model used for this run
  resolvedModel?: string | null; // resolved model id reported by the agent CLI
  workflow?: RunWorkflow;
  handoff?: string;     // workflow step: the previous step's reply this step received (editable while 'awaiting')
  changes?: RunChanges;
  prompt: string;            // exactly what the agent received
  display?: string;          // what the user typed (prompt also contains the attachment list / workflow template)
  attachments?: Attachment[];
  source: RunSource;
  status: RunStatus;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  result: string | null;
  error: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  sessionId: string | null;
  activity: Activity[];
  aborted?: boolean;
  timedOut?: boolean;
}

export interface Chat {
  id: number;
  title: string;
  agentId: string | null;     // single-agent chat
  workflowId: string | null;  // or a workflow chat
  projectId: string;
  model?: string | null;      // selected model for this chat
  sessions: Record<string, string>; // agentId -> that agent's own session/conversation id in this chat
  sessionId?: string | null;  // pre-workflow data only; migrated into `sessions` on load
  branch: ChatBranch | null;  // set when the chat works on its own git branch
  // Per-chat "skip permissions": agents in this chat run with --dangerously-skip-permissions (no permission checks).
  // Off by default; toggled from the chat menu. Workflow steps with their own tool limits are never loosened.
  skipPermissions?: boolean;
  // Workflow chats: steps marked `approve` run without waiting. Off by default.
  autoApprove?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatBranch { name: string; path: string; base: string; mergedAt: number | null }

export interface WorkflowStep {
  agentId: string;
  label: string;
  prompt: string;   // template: {input} = the user's message, {previous} = the previous step's reply
  overrides: AgentOverrides;
  approve: boolean; // pause before this step until the user approves (and may edit) the previous reply
}
export interface Workflow { id: string; name: string; description: string; steps: WorkflowStep[] }

// Per-step tightening of an agent's permissions (e.g. a read-only planning step).
export interface AgentOverrides { allowedTools?: string[]; permissionMode?: string }

export interface Device { id: string; name: string; tokenHash: string; createdAt: number; lastSeenAt: number }

// Plan usage limits reported by an agent (Claude Code sends these as rate_limit_event). utilization is 0..1.
export interface UsageWindow { key: string; label: string; utilization: number | null; resetsAt: number | null }
export interface AntigravityBucket {
  id: string;
  name: string;
  description?: string;
  window: string;
  remaining_fraction: number;
  reset_time: string;
}
export interface AntigravityGroup {
  name: string;
  description?: string;
  buckets: AntigravityBucket[];
}
// text: the agent's own usage report shown as-is (e.g. Antigravity's /usage), when it is not structured data.
export interface UsageSnapshot {
  updatedAt: number;
  status: string | null;
  windows: UsageWindow[];
  text?: string;
  source?: string;
  groups?: AntigravityGroup[];
}

// Settings changed from the app (stored in data/state.json); they override config.yaml.
export interface Settings { maxParallel?: number; runTimeoutMinutes?: number; branchByDefault?: boolean; addedProjects?: string[] }

export interface Project {
  id: string;
  name: string;
  path: string;
  missing: boolean;
  git: boolean;              // detected at start-up
  branchCopy: string[];      // git-ignored files copied into each chat branch (e.g. .env.local)
  source: 'config' | 'discovered' | 'added';
}

export interface AgentConfig { id: string; name: string; type: string; [key: string]: unknown }

export interface HubConfig {
  name: string;
  port: number;
  host: string;
  publicUrl: string | null;
  maxParallel: number;
  runTimeoutMs: number;
  projectRoots: string[];
  projects: Project[];
  agents: AgentConfig[];
  workflows: Workflow[];
}

export interface AgentModel {
  id: string;
  label: string;
  description?: string;
}

// ---------- adapters ----------
export interface StartOptions {
  prompt: string;
  cwd: string;
  sessionId: string | null;                               // for agents that resume their own sessions
  history: { prompt: string; result: string }[] | null;   // earlier turns, for agents that do not
  model?: string | null;                                  // model override for this run
  onActivity: (icon: string, text: string) => void;
  onSession: (sessionId: string) => void;
  overrides?: AgentOverrides;
  skipPermissions?: boolean; // this chat runs without permission checks (--dangerously-skip-permissions)
  extraDirs?: string[]; // folders outside the project the agent may read (uploaded files)
  onUsage?: (raw: Record<string, unknown>) => void; // plan usage limits, when the agent reports them
}

export interface RunResult {
  text?: string;
  error?: string;
  sessionId?: string | null;
  resolvedModel?: string | null;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  sessionLost?: boolean;
}

export interface RunHandle { pid?: number; abort(): void; done: Promise<RunResult> }

export interface AdapterInstance {
  available: boolean;
  problem: string | null;
  resumable: boolean;
  fullAccess: boolean; // true when the agent runs without permission checks (shown as a warning in the app)
  models?: AgentModel[];
  start(options: StartOptions): RunHandle;
  // Optional: fetch current plan usage limits with a tiny request (Claude Code only, for now).
  probeUsage?(): Promise<Record<string, unknown> | null>;
  refreshModels?(): Promise<AgentModel[]>;
}

export type AdapterFactory = (config: AgentConfig) => AdapterInstance;

export interface Agent extends AdapterInstance { id: string; name: string; type: string }

export interface SystemDisk {
  drive: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface SystemStats {
  ram: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  disks: SystemDisk[];
  cpuCount?: number;
  uptimeSeconds?: number;
}

