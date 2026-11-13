import * as fs from "node:fs"
import type { FormField, JsonValue, OpenCodeClient } from "@opencode/client"
import { SessionID } from "@opencode/schema/session-id"
import { samePath } from "./project/paths"
import type { LocalStats, WorktreeStats } from "./GitStatsPoller"
import type { PRStatus } from "./types"
import type { ManagedSession, Worktree, WorktreeStateManager } from "./WorktreeStateManager"

export type Activity = "idle" | "busy" | "retry" | "offline"
export type FilterState = Activity | "waiting"
export type FailureCode =
  | "cross_workspace"
  | "host_error"
  | "stale_session"
  | "unavailable_session"
  | "unknown_section"
  | "unknown_session"
  | "workspace_unavailable"

export interface OverviewFilter {
  sectionIDs?: readonly string[]
  states?: readonly FilterState[]
}

export interface SessionSummary {
  id: SessionID
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
  return samePath(left, right)
}

export interface OverviewInput {
  client: OpenCodeClient
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
  if (typeof value.name === "string" && value.name.includes("NotFound")) return true
  if (typeof value._tag === "string" && value._tag.includes("NotFound")) return true
  return false
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

  const active = await input.client.session.active().catch(() => undefined)
  if (!active) for (const dir of dirs) unavailable.add(dir)
  const managed = new Set(sessions.map((session) => session.id))
  // A busy session waits for a model retry while its latest assistant message carries a scheduled retry.
  await Promise.all(
    Object.keys(active ?? {})
      .filter((id) => managed.has(id))
      .map(async (id) => {
        const latest = await input.client.message
          .list({ sessionID: id, type: "assistant", order: "desc", limit: 1 })
          .catch(() => undefined)
        const message = latest?.data[0]
        statuses.set(id, message?.type === "assistant" && message.retry ? "retry" : "busy")
      }),
  )

  await Promise.all(
    dirs.map(async (dir) => {
      const [perms, forms] = await Promise.all([
        input.client.permission.request.list({ location: { directory: dir } }).catch(() => undefined),
        input.client.form.list({ location: { directory: dir } }).catch(() => undefined),
      ])
      if (!perms || !forms) unavailable.add(dir)
      for (const value of perms?.data ?? []) permissions.add(value.sessionID)
      for (const value of forms?.data ?? []) questions.add(value.sessionID)
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
      const info = await input.client.session.get({ sessionID: session.id }).catch((error: unknown) => {
        if (missing(error)) stale.add(session.id)
        return undefined
      })
      if (!info) return
      if (!(await sameManagedDirectory(info.location.directory, dir))) {
        stale.add(session.id)
        return
      }
      input.titles.set(session.id, info.title?.trim() || session.id)
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
      id: SessionID.make(session.id),
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

interface Target {
  client: OpenCodeClient
  root: string
  state: WorktreeStateManager
  sessionID: string
  managed?: ManagedSession
  directory?: string
}

interface Located {
  dir: string
  name: string
}

// Verify the target session and return its authoritative directory plus display name, so error
// messages can echo exact IDs back to the caller. Reply routes may provide a verified directory.
async function locate(input: Target): Promise<Located> {
  const managed = input.state.getSession(input.sessionID) ?? input.managed
  if (managed && managed.id !== input.sessionID)
    throw new OrchestrationError("unknown_session", "The session is not managed by this Agent Manager workspace")
  const dir = input.directory ?? (managed ? directory(input.root, input.state, managed) : undefined)
  if (!managed && !input.directory)
    throw new OrchestrationError("unknown_session", "The session is not managed by this Agent Manager workspace")
  if (
    !dir ||
    !(await fs.promises.access(dir).then(
      () => true,
      () => false,
    ))
  ) {
    throw new OrchestrationError("stale_session", "The managed session directory is no longer available")
  }
  const info = await input.client.session.get({ sessionID: input.sessionID }).catch((error: unknown) => {
    if (missing(error)) throw new OrchestrationError("stale_session", "The managed session no longer exists")
    throw new OrchestrationError("host_error", "The managed session could not be verified")
  })
  if (!(await sameManagedDirectory(info.location.directory, dir))) {
    throw new OrchestrationError("cross_workspace", "The managed session belongs to a different workspace directory")
  }
  return { dir, name: info.title?.trim() || input.sessionID }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function fieldLabel(field: FormField): string {
  return truncate(field.title ?? field.description ?? field.key, 200)
}

function fieldOptions(field: FormField): string {
  if (field.type !== "string" && field.type !== "multiselect") return ""
  const labels = (field.options ?? []).slice(0, 8).map((option) => option.label)
  return labels.length ? ` (options: ${labels.join(", ")})` : ""
}

async function blocked(
  input: Target,
  dir: string,
  name: string,
  questions?: "dismiss",
  delivery?: "steer" | "queue",
): Promise<string | undefined> {
  if (delivery === "queue") return undefined
  const [perms, forms] = await Promise.all([
    input.client.permission.request.list({ location: { directory: dir } }).catch(() => undefined),
    input.client.form.list({ location: { directory: dir } }).catch(() => undefined),
  ])
  if (!perms || !forms)
    throw new OrchestrationError("host_error", "The managed session blockers could not be read")
  const mine = (forms.data ?? []).filter((value) => value.sessionID === input.sessionID)
  const first = questions === "dismiss" ? undefined : mine.at(0)
  if (first) {
    const detail = mine
      .map((value) => {
        const list = value.fields.map((field, index) => `${index + 1}. "${fieldLabel(field)}"${fieldOptions(field)}`).join("; ")
        return `questionID "${value.id}": ${list}`
      })
      .join(" | ")
    const count = first.fields.length
    const more = mine.length > 1 ? ` Pending request IDs: ${mine.map((value) => value.id).join(", ")}.` : ""
    return `The managed session ${input.sessionID} ("${name}") is waiting for input. Pending question requests: ${detail}. Call agent_manager with action "answer", sessionID "${input.sessionID}", questionID "${first.id}", and one label array per question in that request (${count} total), in order, before prompting.${more}`
  }
  if ((perms.data ?? []).some((value) => value.sessionID === input.sessionID)) {
    return `The managed session ${input.sessionID} ("${name}") has a pending permission request; resolve it in Agent Manager before prompting`
  }
  return undefined
}

function labelValue(field: FormField, label: string): string {
  if (field.type !== "string" && field.type !== "multiselect") return label
  const option = (field.options ?? []).find((value) => value.label === label || value.value === label)
  return option?.value ?? label
}

function answerValue(field: FormField, labels: readonly string[]): FormValue {
  if (field.type === "multiselect") return labels.map((label) => labelValue(field, label))
  const label = labels[0] ?? ""
  if (field.type === "string") return labelValue(field, label)
  if (field.type === "boolean") return ["true", "yes", "1"].includes(label.toLowerCase())
  const number = Number(label)
  return Number.isFinite(number) ? number : label
}

type FormValue = string | number | boolean | string[]

export async function prompt(input: {
  client: OpenCodeClient
  root: string
  state: WorktreeStateManager
  sessionID: string
  text: string
  signal?: AbortSignal
  managed?: ManagedSession
  directory?: string
  questions?: "dismiss"
  model?: { providerID: string; modelID: string }
  variant?: string
  agent?: string
  delivery?: "steer" | "queue"
  metadata?: { [key: string]: JsonValue }
}): Promise<void> {
  if (input.signal?.aborted) return
  const target = await locate(input)
  const blocker = await blocked(input, target.dir, target.name, input.questions, input.delivery)
  if (blocker) throw new OrchestrationError("unavailable_session", blocker)
  if (input.signal?.aborted) return
  if (input.agent) await input.client.session.switchAgent({ sessionID: input.sessionID, agent: input.agent })
  if (input.model)
    await input.client.session.switchModel({
      sessionID: input.sessionID,
      model: {
        id: input.model.modelID,
        providerID: input.model.providerID,
        ...(input.variant ? { variant: input.variant } : {}),
      },
    })
  await input.client.session.prompt({
    sessionID: input.sessionID,
    text: input.text,
    ...(input.delivery ? { delivery: input.delivery } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })
}

export async function answer(input: {
  client: OpenCodeClient
  root: string
  state: WorktreeStateManager
  sessionID: string
  questionID?: string
  answers: readonly (readonly string[])[]
  managed?: ManagedSession
}): Promise<{ questionID: string }> {
  const dir = (await locate(input)).dir
  const listed = await input.client.form
    .list({ location: { directory: dir } })
    .catch(() => undefined)
  if (!listed) throw new OrchestrationError("host_error", "The managed session questions could not be read")
  const mine = (listed.data ?? []).filter((value) => value.sessionID === input.sessionID)
  if (mine.length === 0) {
    // The caller may have mixed up lookalike session IDs. Point at the sessions that
    // actually hold pending questions so one retry with the right ID resolves it.
    const others = (listed.data ?? []).map((value) => `${value.sessionID} (question ${value.id})`)
    const hint = others.length ? ` Sessions with pending questions: ${others.join(", ")}.` : ""
    throw new OrchestrationError("unavailable_session", `The managed session has no pending question to answer.${hint}`)
  }
  let target = mine[0]
  if (input.questionID) {
    const found = mine.find((value) => value.id === input.questionID)
    if (!found)
      throw new OrchestrationError(
        "unavailable_session",
        `The session has no pending question ${input.questionID}; pending: ${mine.map((value) => value.id).join(", ")}`,
      )
    target = found
  } else if (mine.length > 1) {
    throw new OrchestrationError(
      "unavailable_session",
      `Several questions are pending: ${mine.map((value) => value.id).join(", ")}. Name one with questionID.`,
    )
  }
  if (input.answers.length !== target.fields.length) {
    throw new OrchestrationError(
      "unavailable_session",
      `Question ${target.id} expects one answer array per question (${target.fields.length}), received ${input.answers.length}`,
    )
  }
  const formatted = Object.fromEntries(
    target.fields.map((field, index) => [field.key, answerValue(field, input.answers[index] ?? [])]),
  )
  await input.client.session.form.reply({ sessionID: input.sessionID, formID: target.id, answer: formatted })
  return { questionID: target.id }
}

export function move(input: {
  state: WorktreeStateManager
  sessionID: string
  sectionID: string | null
  managed?: ManagedSession
}): void {
  const session = input.state.getSession(input.sessionID) ?? input.managed
  if (!session || session.id !== input.sessionID)
    throw new OrchestrationError("unknown_session", "The session is not managed by this Agent Manager workspace")
  if (!session.worktreeId) {
    if (input.sectionID === null) return
    throw new OrchestrationError(
      "unavailable_session",
      "Only sessions attached to a worktree can be assigned to a section",
    )
  }
  if (input.sectionID !== null && !input.state.getSection(input.sectionID)) {
    throw new OrchestrationError("unknown_section", "The target section is not managed by this Agent Manager workspace")
  }
  input.state.moveToSection([session.worktreeId], input.sectionID)
}