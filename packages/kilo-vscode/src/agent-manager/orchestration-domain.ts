import * as fs from "fs"
import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"
import { sameDirectory } from "../kilo-provider-utils"
import type { LocalStats, WorktreeStats } from "./GitStatsPoller"
import type { PRStatus } from "./types"
import type { ManagedSession, Worktree, WorktreeStateManager } from "./WorktreeStateManager"
import { SNAPSHOT_INITIALIZATION } from "./constants"

export type Activity = "idle" | "busy" | "retry" | "offline"
export type FilterState = Activity | "waiting"
export type FailureCode =
  | "cross_workspace"
  | "host_error"
  | "stale_session"
  | "unavailable_session"
  | "unknown_session"
  | "workspace_unavailable"

export interface OverviewFilter {
  sectionIDs?: string[]
  states?: FilterState[]
}

export interface SessionSummary {
  id: string
  name: string
  activity: Activity
  attention?: Array<"permission" | "question">
}

export interface GitSummary {
  additions: number
  deletions: number
  ahead: number
  behind: number
}

export interface PullRequestSummary {
  number: number
  state: "open" | "draft" | "merged" | "closed"
  checks: "success" | "failure" | "pending" | "none"
  review?: "approved" | "changes_requested" | "pending"
  unresolvedComments?: number
}

export interface WorktreeSummary {
  id: string
  name: string
  branch: string
  session?: SessionSummary
  sessions?: SessionSummary[]
  git?: GitSummary
  pullRequest?: PullRequestSummary
}

export interface Overview {
  sections: Array<{ id: string; name: string; worktrees: WorktreeSummary[] }>
  ungrouped: WorktreeSummary[]
  local?: { branch?: string; sessions: SessionSummary[]; git?: GitSummary }
}

export class OrchestrationError extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message)
  }
}

async function canonical(value: string): Promise<string> {
  return fs.promises.realpath(value).catch(() => value)
}

export async function sameManagedDirectory(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([canonical(a), canonical(b)])
  return sameDirectory(left, right)
}

export interface OverviewInput {
  client: KiloClient
  root: string
  state: WorktreeStateManager
  titles: Map<string, string>
  filter?: OverviewFilter
  stats: { worktrees: WorktreeStats[]; local?: LocalStats }
  prs: Map<string, PRStatus>
}

function missing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const value = error as Record<string, unknown>
  if (value.name === "NotFoundError" || value._tag === "NotFound" || value.status === 404) return true
  if (!value.data || typeof value.data !== "object") return false
  const data = value.data as Record<string, unknown>
  return data.name === "NotFoundError" || data._tag === "NotFound"
}

function directory(root: string, state: WorktreeStateManager, session: ManagedSession): string | undefined {
  if (!session.worktreeId) return root
  return state.getWorktree(session.worktreeId)?.path
}

function git(stats: Pick<WorktreeStats, "additions" | "deletions" | "ahead" | "behind">): GitSummary {
  return {
    additions: stats.additions,
    deletions: stats.deletions,
    ahead: stats.ahead,
    behind: stats.behind,
  }
}

function pr(status: PRStatus): PullRequestSummary {
  return {
    number: status.number,
    state: status.state,
    checks: status.checks.status,
    ...(status.review ? { review: status.review } : {}),
    ...(status.comments ? { unresolvedComments: status.comments.unresolved } : {}),
  }
}

function ordered<T extends { id: string }>(items: T[], order: string[] | undefined): T[] {
  const index = new Map((order ?? []).map((id, idx) => [id, idx]))
  return [...items].sort(
    (a, b) => (index.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (index.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )
}

function matches(summary: SessionSummary, states: Set<FilterState> | undefined): boolean {
  if (!states?.size) return true
  if (states.has(summary.activity)) return true
  return states.has("waiting") && !!summary.attention?.length
}

function lifecycle(worktree: Worktree): PullRequestSummary["state"] {
  if (worktree.prState === "draft" || worktree.prState === "merged" || worktree.prState === "closed") {
    return worktree.prState
  }
  return "open"
}

function pullRequest(worktree: Worktree, status: PRStatus | undefined): PullRequestSummary | undefined {
  if (status) return pr(status)
  if (!worktree.prNumber) return undefined
  return { number: worktree.prNumber, state: lifecycle(worktree), checks: "none" }
}

async function live(input: OverviewInput, sessions: ManagedSession[]) {
  const dirs = [
    ...new Set(sessions.map((session) => directory(input.root, input.state, session)).filter(Boolean)),
  ] as string[]
  const statuses = new Map<string, Activity>()
  const permissions = new Set<string>()
  const questions = new Set<string>()
  const unavailable = new Set<string>()

  await Promise.all(
    dirs.map(async (dir) => {
      const [status, perms, qs] = await Promise.all([
        input.client.session.status({ directory: dir }),
        input.client.permission.list({ directory: dir }),
        input.client.question.list({ directory: dir }),
      ])
      if (status.error || perms.error || qs.error) unavailable.add(dir)
      for (const [id, value] of Object.entries(status.data ?? {}) as Array<[string, SessionStatus]>) {
        statuses.set(id, value.type)
      }
      for (const value of perms.data ?? []) permissions.add(value.sessionID)
      for (const value of qs.data ?? []) questions.add(value.sessionID)
    }),
  )
  return { permissions, questions, statuses, unavailable }
}

async function names(input: OverviewInput, sessions: ManagedSession[]) {
  const stale = new Set<string>()
  await Promise.all(
    sessions.map(async (session) => {
      if (input.titles.has(session.id)) return
      const dir = directory(input.root, input.state, session)
      if (!dir) {
        stale.add(session.id)
        return
      }
      const response = await input.client.session.get({ sessionID: session.id, directory: dir })
      if (response.error || !response.data) {
        if (missing(response.error)) stale.add(session.id)
        return
      }
      if (!(await sameManagedDirectory(response.data.directory, dir))) {
        stale.add(session.id)
        return
      }
      input.titles.set(session.id, response.data.title.trim() || session.id)
    }),
  )
  return stale
}

function sessionSummaries(
  input: OverviewInput,
  sessions: ManagedSession[],
  state: Awaited<ReturnType<typeof live>>,
  stale: Set<string>,
  filters: Set<FilterState> | undefined,
) {
  const summaries = new Map<string, SessionSummary>()
  for (const session of sessions) {
    const dir = directory(input.root, input.state, session)
    const attention = [
      ...(state.permissions.has(session.id) ? (["permission"] as const) : []),
      ...(state.questions.has(session.id) ? (["question"] as const) : []),
    ]
    const cached = input.titles.get(session.id)?.trim()
    const summary: SessionSummary = {
      id: session.id,
      name: (cached || session.id).slice(0, 500),
      activity:
        !dir || stale.has(session.id) || state.unavailable.has(dir)
          ? "offline"
          : (state.statuses.get(session.id) ?? "idle"),
      ...(attention.length ? { attention: [...attention] } : {}),
    }
    if (matches(summary, filters)) summaries.set(session.id, summary)
  }
  return summaries
}

function worktreeSummaries(
  input: OverviewInput,
  sessions: Map<string, SessionSummary>,
  filters: Set<FilterState> | undefined,
) {
  const stats = new Map(input.stats.worktrees.map((value) => [value.worktreeId, value]))
  const result = new Map<string, WorktreeSummary>()
  for (const worktree of input.state.getWorktrees()) {
    const list = ordered(input.state.getSessions(worktree.id), input.state.getTabOrder()[worktree.id])
      .map((session) => sessions.get(session.id))
      .filter((session): session is SessionSummary => !!session)
    if (filters?.size && list.length === 0) continue
    const changes = stats.get(worktree.id)
    const pull = pullRequest(worktree, input.prs.get(worktree.id))
    result.set(worktree.id, {
      id: worktree.id,
      name: (worktree.label || list[0]?.name || worktree.branch).slice(0, 500),
      branch: worktree.branch.slice(0, 500),
      ...(list.length === 1 ? { session: list[0] } : {}),
      ...(list.length > 1 ? { sessions: list } : {}),
      ...(changes ? { git: git(changes) } : {}),
      ...(pull ? { pullRequest: pull } : {}),
    })
  }
  return result
}

function grouped(
  input: OverviewInput,
  sessions: ManagedSession[],
  summaries: Map<string, SessionSummary>,
  worktrees: Map<string, WorktreeSummary>,
): Overview {
  const selected = input.filter?.sectionIDs?.length ? new Set(input.filter.sectionIDs) : undefined
  const order = new Map(input.state.getWorktreeOrder().map((id, index) => [id, index]))
  const worktreeOrder = (a: Worktree, b: Worktree) =>
    (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  const sections = input.state
    .getSections()
    .filter((section) => !selected || selected.has(section.id))
    .map((section) => ({
      id: section.id,
      name: section.name.slice(0, 500),
      worktrees: input.state
        .getWorktrees()
        .filter((worktree) => worktree.sectionId === section.id && worktrees.has(worktree.id))
        .sort(worktreeOrder)
        .map((worktree) => worktrees.get(worktree.id)!),
    }))
  const ungrouped = selected
    ? []
    : input.state
        .getWorktrees()
        .filter((worktree) => !worktree.sectionId && worktrees.has(worktree.id))
        .sort(worktreeOrder)
        .map((worktree) => worktrees.get(worktree.id)!)
  const locals = selected
    ? []
    : ordered(
        sessions.filter((session) => !session.worktreeId),
        input.state.getTabOrder().local,
      )
        .map((session) => summaries.get(session.id))
        .filter((session): session is SessionSummary => !!session)
  const local =
    selected || (locals.length === 0 && !input.stats.local)
      ? undefined
      : {
          sessions: locals,
          ...(input.stats.local?.branch ? { branch: input.stats.local.branch } : {}),
          ...(input.stats.local ? { git: git(input.stats.local) } : {}),
        }
  return { sections, ungrouped, ...(local ? { local } : {}) }
}

export async function overview(input: OverviewInput): Promise<Overview> {
  const sessions = input.state.getSessions()
  const [state, stale] = await Promise.all([live(input, sessions), names(input, sessions)])
  const filters = input.filter?.states?.length ? new Set(input.filter.states) : undefined
  const summaries = sessionSummaries(input, sessions, state, stale, filters)
  return grouped(input, sessions, summaries, worktreeSummaries(input, summaries, filters))
}

export async function prompt(input: {
  client: KiloClient
  root: string
  state: WorktreeStateManager
  sessionID: string
  text: string
  messageID: string
  signal?: AbortSignal
}): Promise<void> {
  if (input.signal?.aborted) return
  const managed = input.state.getSession(input.sessionID)
  if (!managed)
    throw new OrchestrationError("unknown_session", "The session is not managed by this Agent Manager workspace")
  const dir = directory(input.root, input.state, managed)
  if (
    !dir ||
    !(await fs.promises.access(dir).then(
      () => true,
      () => false,
    ))
  ) {
    throw new OrchestrationError("stale_session", "The managed session directory is no longer available")
  }
  const response = await input.client.session.get({ sessionID: input.sessionID, directory: dir })
  if (response.error || !response.data) {
    if (missing(response.error)) throw new OrchestrationError("stale_session", "The managed session no longer exists")
    throw new OrchestrationError("host_error", "The managed session could not be verified")
  }
  if (!(await sameManagedDirectory(response.data.directory, dir))) {
    throw new OrchestrationError("cross_workspace", "The managed session belongs to a different workspace directory")
  }
  const status = await input.client.session.status({ directory: dir })
  if (status.error) throw new OrchestrationError("host_error", "The managed session status could not be read")
  const activity = status.data?.[input.sessionID]?.type ?? "idle"
  if (activity !== "idle") {
    throw new OrchestrationError(
      "unavailable_session",
      `The managed session is ${activity}; only idle sessions can be prompted`,
    )
  }
  if (input.signal?.aborted) return
  await input.client.session.promptAsync(
    {
      sessionID: input.sessionID,
      directory: dir,
      messageID: `msg_agent_manager_${input.messageID}`,
      parts: [{ type: "text", text: input.text }],
      snapshotInitialization: SNAPSHOT_INITIALIZATION,
    },
    { throwOnError: true },
  )
}
