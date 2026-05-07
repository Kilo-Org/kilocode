import * as fs from "node:fs"
import * as path from "node:path"

export interface AgentManagerOverviewSnapshot {
  version: number
  generatedAt: string
  root: string
  active: {
    tabId?: string
    sessionId?: string
    worktreeId?: string | null
  }
  summary: {
    total: number
    running: number
    waiting: number
    idle: number
    done: number
    failed: number
    stale: number
    worktrees: number
    localTabs: number
  }
  requests: Array<{
    id: string
    source?: string
    mode?: string
    versions?: boolean
    createdAt?: string
    sessionIds: string[]
    worktreeIds: string[]
    status: "running" | "waiting" | "idle" | "done" | "failed" | "unknown"
    summary: Record<string, number>
  }>
  sections: Array<{
    id: string
    name: string
    selected?: boolean
    collapsed?: boolean
    tabIds: string[]
    worktreeIds: string[]
    sessionIds: string[]
    summary: Record<string, number>
  }>
  tabs: Array<{
    id: string
    kind: "local" | "worktree"
    selected: boolean
    section: string
    name: string
    cwd: string
    worktreeId: string | null
    sessionId?: string
    status: "running" | "waiting" | "idle" | "done" | "failed" | "unknown"
    lastActivityAt?: string
    stale: boolean
    staleReason?: string
  }>
  worktrees: Array<{
    id: string
    section: string
    name: string
    path: string
    branch: string
    base?: string
    selected: boolean
    status: "running" | "waiting" | "idle" | "done" | "failed" | "unknown" | "inactive"
    sessionIds: string[]
    tabIds: string[]
    requestId?: string
    git?: {
      changes?: number
      files?: number
      additions?: number
      deletions?: number
      ahead?: number
      behind?: number
      conflicts?: number
      hasPr?: boolean
    }
    pr?: {
      attached: boolean
      number?: number
      url?: string
      state?: string
      review?: string | null
      checks?: string
    }
    runState?: "running" | "stopping" | "stopped" | "unknown"
    lastActivityAt?: string
    stale: boolean
    staleReason?: string
  }>
  local?: {
    selected: boolean
    cwd: string
    branch?: string
    status: "running" | "waiting" | "idle" | "done" | "failed" | "unknown" | "inactive"
    sessionIds: string[]
    tabIds: string[]
    stats?: {
      changes?: number
      files?: number
      additions?: number
      deletions?: number
      ahead?: number
      behind?: number
      conflicts?: number
      hasPr?: boolean
    }
    runState?: "running" | "stopping" | "stopped" | "unknown"
    lastActivityAt?: string
    stale: boolean
    staleReason?: string
  }
  sessions: Array<{
    id: string
    tabId: string
    worktreeId: string | null
    requestId?: string
    kind: "local" | "worktree"
    section: string
    name: string
    cwd: string
    status: "running" | "waiting" | "idle" | "done" | "failed" | "unknown"
    selected: boolean
    agent?: string
    model?: string
    startedAt?: string
    lastActivityAt?: string
    stale: boolean
    staleReason?: string
    attention?: "input" | "permission" | "error" | "none"
  }>
}

const FILE = "agent-manager-overview.json"

function managerRoot(root: string): string {
  const parts = path.resolve(root).split(path.sep)
  const found = parts
    .map((part, i) => ({ part, i }))
    .filter((item) => (item.part === ".kilo" || item.part === ".kilocode") && parts[item.i + 1] === "worktrees")
    .at(-1)
  const index = found?.i ?? -1
  if (index === -1) return root
  return parts.slice(0, index).join(path.sep) || path.sep
}

export async function writeOverviewSnapshot(
  root: string | undefined,
  snapshot: AgentManagerOverviewSnapshot,
  log: (message: string) => void,
): Promise<void> {
  if (!root) return
  const base = managerRoot(root)
  const dir = path.join(base, ".kilo")
  const file = path.join(dir, FILE)
  try {
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(file, `${JSON.stringify({ ...snapshot, root: base }, null, 2)}\n`, "utf-8")
  } catch (error) {
    log(`Failed to write Agent Manager overview snapshot: ${error}`)
  }
}
