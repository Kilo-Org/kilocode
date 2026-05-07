import path from "node:path"
import { stat } from "node:fs/promises"
import { Instance } from "@/project/instance"

const FILE = "agent-manager-overview.json"
const STATE = "agent-manager.json"
const MAX_AGE = 10_000

type Status = "running" | "waiting" | "idle" | "done" | "failed" | "unknown"

interface OverviewSummary {
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

interface OverviewActive {
  tabId?: string
  sessionId?: string
  worktreeId?: string | null
}

interface OverviewRequest {
  id: string
  source?: string
  mode?: string
  versions?: boolean
  createdAt?: string
  sessionIds: string[]
  worktreeIds: string[]
  status: Status
  summary: Partial<OverviewSummary>
}

interface OverviewSection {
  id: string
  name: string
  selected?: boolean
  collapsed?: boolean
  tabIds: string[]
  worktreeIds: string[]
  sessionIds: string[]
  summary: Partial<OverviewSummary>
}

interface OverviewTab {
  id: string
  kind: "local" | "worktree"
  selected: boolean
  section: string
  name: string
  cwd: string
  worktreeId: string | null
  sessionId?: string
  status: Status
  lastActivityAt?: string
  stale: boolean
  staleReason?: string
}

interface OverviewGit {
  changes?: number
  files?: number
  additions?: number
  deletions?: number
  staged?: number
  unstaged?: number
  untracked?: number
  ahead?: number
  behind?: number
  conflicts?: number
  hasPr?: boolean
}

interface OverviewPR {
  attached: boolean
  number?: number
  url?: string
  state?: string
  review?: string | null
  checks?: string
}

interface OverviewWorktree {
  id: string
  section: string
  name: string
  path: string
  branch: string
  base?: string
  selected: boolean
  status: Status | "inactive"
  sessionIds: string[]
  tabIds: string[]
  requestId?: string
  git?: OverviewGit
  pr?: OverviewPR
  runState?: "running" | "stopping" | "stopped" | "unknown"
  lastActivityAt?: string
  stale: boolean
  staleReason?: string
}

interface OverviewLocal {
  selected: boolean
  cwd: string
  branch?: string
  status: Status | "inactive"
  sessionIds: string[]
  tabIds: string[]
  stats?: OverviewGit
  runState?: "running" | "stopping" | "stopped" | "unknown"
  lastActivityAt?: string
  stale: boolean
  staleReason?: string
}

interface OverviewSession {
  id: string
  tabId: string
  worktreeId: string | null
  requestId?: string
  kind: "local" | "worktree"
  section: string
  name: string
  cwd: string
  status: Status
  selected: boolean
  agent?: string
  model?: string
  startedAt?: string
  lastActivityAt?: string
  stale: boolean
  staleReason?: string
  attention?: "input" | "permission" | "error" | "none"
}

export interface AgentManagerOverview {
  version: number
  generatedAt: string
  root: string
  active: OverviewActive
  summary: OverviewSummary
  requests: OverviewRequest[]
  sections: OverviewSection[]
  tabs: OverviewTab[]
  worktrees: OverviewWorktree[]
  local?: OverviewLocal
  sessions: OverviewSession[]
  source?: "snapshot" | "fallback" | "empty"
  snapshotAgeMs?: number
}

interface StateFile {
  worktrees?: Record<
    string,
    Omit<OverviewWorktree, "id" | "section" | "name" | "selected" | "status" | "sessionIds" | "tabIds" | "stale"> & {
      label?: string
      createdAt?: string
      parentBranch?: string
      prNumber?: number
      prUrl?: string
      prState?: string
      sectionId?: string
    }
  >
  sessions?: Record<string, { worktreeId: string | null; createdAt: string; requestId?: string }>
  sections?: Record<string, { name: string; collapsed: boolean; color?: string | null; order?: number }>
}

function parents(dir: string): string[] {
  const next = path.dirname(dir)
  if (next === dir) return [dir]
  return [dir, ...parents(next)]
}

function managerRoot(dir: string | undefined) {
  if (!dir) return undefined
  const parts = path.resolve(dir).split(path.sep)
  const found = parts
    .map((part, i) => ({ part, i }))
    .filter((item) => (item.part === ".kilo" || item.part === ".kilocode") && parts[item.i + 1] === "worktrees")
    .at(-1)
  const index = found?.i ?? -1
  if (index === -1) return undefined
  return parts.slice(0, index).join(path.sep) || path.sep
}

function candidates() {
  const seen = new Set<string>()
  const dirs: string[] = []
  const add = (dir: string | undefined) => {
    if (!dir) return
    const full = path.resolve(dir)
    if (seen.has(full)) return
    seen.add(full)
    dirs.push(full)
  }
  add(managerRoot(Instance.directory))
  add(managerRoot(Instance.worktree))
  for (const dir of parents(Instance.directory)) add(dir)
  add(Instance.worktree)
  return dirs
}

async function json<T>(file: string): Promise<T | undefined> {
  const target = Bun.file(file)
  if (!(await target.exists())) return undefined
  return (await target.json()) as T
}

async function modified(file: string): Promise<number | undefined> {
  return stat(file)
    .then((info) => info.mtimeMs)
    .catch(() => undefined)
}

function summary(
  sessions: Pick<OverviewSession, "status" | "stale" | "kind">[],
  worktrees: unknown[],
): OverviewSummary {
  const count = (status: Status) => sessions.filter((item) => item.status === status).length
  return {
    total: sessions.length,
    running: count("running"),
    waiting: count("waiting"),
    idle: count("idle"),
    done: count("done"),
    failed: count("failed"),
    stale: sessions.filter((item) => item.stale).length,
    worktrees: worktrees.length,
    localTabs: sessions.filter((item) => item.kind === "local").length,
  }
}

function empty(root: string): AgentManagerOverview {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    active: {},
    summary: summary([], []),
    requests: [],
    sections: [],
    tabs: [],
    worktrees: [],
    sessions: [],
    source: "empty",
  }
}

function fallback(root: string, state: StateFile | undefined): AgentManagerOverview {
  if (!state) return empty(root)
  const secs = new Map(Object.entries(state.sections ?? {}))
  const wts = Object.entries(state.worktrees ?? {}).map(([id, wt]) => {
    const section = wt.sectionId ? secs.get(wt.sectionId)?.name : undefined
    const sessions = Object.entries(state.sessions ?? {})
      .filter(([, session]) => session.worktreeId === id)
      .map(([sid]) => sid)
    const pr = wt.prNumber
      ? { attached: true, number: wt.prNumber, url: wt.prUrl, state: wt.prState }
      : { attached: false }
    return {
      id,
      section: section ?? "Worktrees",
      name: wt.label ?? wt.branch,
      path: wt.path,
      branch: wt.branch,
      base: wt.parentBranch,
      selected: false,
      status: sessions.length > 0 ? ("unknown" as const) : ("inactive" as const),
      sessionIds: sessions,
      tabIds: sessions.map((sid) => `worktree:${id}:${sid}`),
      requestId: wt.requestId,
      pr,
      runState: "unknown" as const,
      stale: false,
    }
  })
  const sessions = Object.entries(state.sessions ?? {}).map(([id, session]) => {
    const wt = session.worktreeId ? wts.find((item) => item.id === session.worktreeId) : undefined
    const kind: "local" | "worktree" = session.worktreeId ? "worktree" : "local"
    const tabId = session.worktreeId ? `worktree:${session.worktreeId}:${id}` : `local:${id}`
    return {
      id,
      tabId,
      worktreeId: session.worktreeId,
      requestId: session.requestId,
      kind,
      section: wt?.section ?? "Local",
      name: id,
      cwd: wt?.path ?? root,
      status: "unknown" as const,
      selected: false,
      startedAt: session.createdAt,
      stale: false,
      attention: "none" as const,
    }
  })
  const tabs = sessions.map((session) => ({
    id: session.tabId,
    kind: session.kind,
    selected: false,
    section: session.section,
    name: session.name,
    cwd: session.cwd,
    worktreeId: session.worktreeId,
    sessionId: session.id,
    status: session.status,
    stale: false,
  }))
  const localSessions = sessions.filter((session) => session.kind === "local")
  const local: OverviewLocal | undefined = localSessions.length
    ? {
        selected: false,
        cwd: root,
        status: "unknown",
        sessionIds: localSessions.map((session) => session.id),
        tabIds: localSessions.map((session) => session.tabId),
        runState: "unknown",
        stale: false,
      }
    : undefined
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    active: {},
    summary: summary(sessions, wts),
    requests: [],
    sections: [...secs].map(([id, sec]) => ({
      id,
      name: sec.name,
      collapsed: sec.collapsed,
      tabIds: wts.filter((wt) => state.worktrees?.[wt.id]?.sectionId === id).flatMap((wt) => wt.tabIds),
      worktreeIds: wts.filter((wt) => state.worktrees?.[wt.id]?.sectionId === id).map((wt) => wt.id),
      sessionIds: wts.filter((wt) => state.worktrees?.[wt.id]?.sectionId === id).flatMap((wt) => wt.sessionIds),
      summary: {},
    })),
    tabs,
    worktrees: wts,
    ...(local ? { local } : {}),
    sessions,
    source: "fallback",
  }
}

function changes(git: OverviewGit | undefined) {
  if (!git) return "-"
  const files = git.files ?? git.changes ?? 0
  if (files === 0 && (git.additions ?? 0) === 0 && (git.deletions ?? 0) === 0) return "-"
  return `+${git.additions ?? 0} -${git.deletions ?? 0}`
}

function pr(pr: OverviewPR | undefined) {
  if (!pr?.attached) return "-"
  const id = pr.number ? `#${pr.number}` : "attached"
  const state = pr.state ?? "unknown"
  const checks = pr.checks && pr.checks !== "none" ? `, ${pr.checks}` : ""
  return `${id} ${state}${checks}`
}

function status(item: Pick<OverviewSession | OverviewWorktree, "status" | "selected" | "stale" | "staleReason">) {
  const parts: string[] = []
  if (item.status !== "unknown" && item.status !== "inactive") parts.push(item.status)
  if (item.selected) parts.push("active")
  if (item.stale) parts.push(item.staleReason ? `stale: ${item.staleReason}` : "stale")
  return parts.join(", ") || "-"
}

function worktreeLabel(wt: OverviewWorktree | undefined) {
  if (!wt) return "local"
  return `\`${wt.name}\` on \`${wt.branch}\``
}

function attention(session: OverviewSession) {
  if (!session.attention || session.attention === "none") return "-"
  if (session.status === "waiting") return `waiting for ${session.attention}`
  return session.attention
}

function showRun(items: Array<{ runState?: string }>) {
  return items.some((item) => item.runState && item.runState !== "unknown" && item.runState !== "stopped")
}

function showAttention(sessions: OverviewSession[]) {
  return sessions.some((session) => !!session.attention && session.attention !== "none")
}

function sectionGroups(info: AgentManagerOverview) {
  const sections = info.sections.map((section) => ({
    name: section.name,
    worktrees: section.worktreeIds.flatMap((id) => info.worktrees.find((wt) => wt.id === id) ?? []),
  }))
  const assigned = new Set(sections.flatMap((section) => section.worktrees.map((wt) => wt.id)))
  const unassigned = info.worktrees.filter((wt) => !assigned.has(wt.id))
  if (unassigned.length === 0) return sections
  return [...sections, { name: "Worktrees", worktrees: unassigned }]
}

function active(info: AgentManagerOverview) {
  const session = info.sessions.find((item) => item.id === info.active.sessionId)
  if (session) return `\`${session.name}\` (${session.id}, ${session.kind})`
  const wt = info.worktrees.find((item) => item.id === info.active.worktreeId)
  if (wt) return worktreeLabel(wt)
  if (info.active.tabId) return `tab \`${info.active.tabId}\``
  return "none"
}

export function formatOverview(info: AgentManagerOverview): string {
  const lines = [
    "## Agent Manager Overview",
    "",
    `Source: \`${info.source ?? "snapshot"}\`${info.snapshotAgeMs !== undefined ? `, age ${Math.round(info.snapshotAgeMs / 1000)}s` : ""}`,
    `Generated: \`${info.generatedAt}\``,
    `Agent Manager root: \`${info.root}\``,
    `Active: ${active(info)}`,
    "",
    `Summary: ${info.summary.running} running, ${info.summary.waiting} waiting, ${info.summary.idle} idle, ${info.summary.failed} failed, ${info.summary.stale} stale, ${info.summary.worktrees} worktrees, ${info.summary.localTabs} local tabs`,
  ]

  if (info.requests.length > 0) {
    lines.push("", "### Requests", "", "| Request | Status | Sessions | Worktrees |", "|---|---|---:|---:|")
    for (const req of info.requests)
      lines.push(`| \`${req.id}\` | ${req.status} | ${req.sessionIds.length} | ${req.worktreeIds.length} |`)
  }

  if (info.local) {
    const run = showRun([info.local])
    lines.push("", "### Local", "")
    lines.push(
      run
        ? "| Name | Branch | Changes | Behind | Ahead | Run | CWD |"
        : "| Name | Branch | Changes | Behind | Ahead | CWD |",
    )
    lines.push(run ? "|---|---|---|---:|---:|---|---|" : "|---|---|---|---:|---:|---|")
    lines.push(
      run
        ? `| local | ${info.local.branch ? `\`${info.local.branch}\`` : "-"} | ${changes(info.local.stats)} | ${info.local.stats?.behind ?? "?"} | ${info.local.stats?.ahead ?? "?"} | ${info.local.runState ?? "-"} | \`${info.local.cwd}\` |`
        : `| local | ${info.local.branch ? `\`${info.local.branch}\`` : "-"} | ${changes(info.local.stats)} | ${info.local.stats?.behind ?? "?"} | ${info.local.stats?.ahead ?? "?"} | \`${info.local.cwd}\` |`,
    )
  }

  if (info.worktrees.length > 0) {
    const run = showRun(info.worktrees)
    const sections = sectionGroups(info)
    for (const section of sections) {
      lines.push("", `### ${section.name} (${section.worktrees.length})`, "")
      lines.push(
        run
          ? "| Worktree | Branch | Changes | Behind | Ahead | PR | Selected | Run | Path |"
          : "| Worktree | Branch | Changes | Behind | Ahead | PR | Selected | Path |",
      )
      lines.push(run ? "|---|---|---|---:|---:|---|---|---|---|" : "|---|---|---|---:|---:|---|---|---|")
      for (const wt of section.worktrees) {
        const selected = wt.selected ? "yes" : "-"
        lines.push(
          run
            ? `| \`${wt.name}\` | \`${wt.branch}\` | ${changes(wt.git)} | ${wt.git?.behind ?? "?"} | ${wt.git?.ahead ?? "?"} | ${pr(wt.pr)} | ${selected} | ${wt.runState ?? "-"} | \`${wt.path}\` |`
            : `| \`${wt.name}\` | \`${wt.branch}\` | ${changes(wt.git)} | ${wt.git?.behind ?? "?"} | ${wt.git?.ahead ?? "?"} | ${pr(wt.pr)} | ${selected} | \`${wt.path}\` |`,
        )
      }
    }
  }

  if (info.sessions.length > 0) {
    const attn = showAttention(info.sessions)
    lines.push(
      "",
      "### Sessions",
      "",
      attn
        ? "| Session | Kind | Section | Status | Attention | Worktree | Request | CWD |"
        : "| Session | Kind | Section | Status | Worktree | Request | CWD |",
      attn ? "|---|---|---|---|---|---|---|---|" : "|---|---|---|---|---|---|---|",
    )
    for (const session of info.sessions) {
      const wt = session.worktreeId ? info.worktrees.find((item) => item.id === session.worktreeId) : undefined
      lines.push(
        attn
          ? `| \`${session.name}\` (${session.id}) | ${session.kind} | ${session.section} | ${status(session)} | ${attention(session)} | ${worktreeLabel(wt)} | ${session.requestId ? `\`${session.requestId}\`` : "-"} | \`${session.cwd}\` |`
          : `| \`${session.name}\` (${session.id}) | ${session.kind} | ${session.section} | ${status(session)} | ${worktreeLabel(wt)} | ${session.requestId ? `\`${session.requestId}\`` : "-"} | \`${session.cwd}\` |`,
      )
    }
  }

  if (info.worktrees.length === 0 && info.sessions.length === 0)
    lines.push("", "No Agent Manager worktrees or sessions found.")
  return lines.join("\n")
}

export async function readOverview(): Promise<AgentManagerOverview> {
  for (const dir of candidates()) {
    const file = path.join(dir, ".kilo", FILE)
    const snap = await json<AgentManagerOverview>(file).catch(() => undefined)
    if (snap) {
      const time = Date.parse(snap.generatedAt)
      const age = Date.now() - time
      const mtime = await modified(path.join(dir, ".kilo", STATE))
      const current = Number.isFinite(age) && age <= MAX_AGE && (!mtime || mtime <= time)
      if (current) {
        return { ...snap, source: "snapshot", snapshotAgeMs: age }
      }
    }
  }
  for (const dir of candidates()) {
    const state = path.join(dir, ".kilo", STATE)
    const data = await json<StateFile>(state).catch(() => undefined)
    if (data) return fallback(dir, data)
  }
  return empty(Instance.directory)
}
