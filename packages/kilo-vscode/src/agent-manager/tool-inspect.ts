import type { KiloClient, Message, Part, PermissionRequest, QuestionRequest, Session } from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../kilo-provider-utils"
import type { WorktreeDiffEntry } from "./types"
import { remoteRef, type ManagedSession, type Worktree, type WorktreeStateManager } from "./WorktreeStateManager"

const DEFAULT_TAIL = 8
const MAX_TAIL = 50
const MAX_TEXT = 2000
const MAX_TOOL = 1200
const MAX_DIFF_FILES = 30

interface Msg {
  info: Message
  parts: Part[]
}

export interface InspectRequest {
  requestID: string
  sessionID?: string
  directory?: string
  targetSessionID: string
  tail?: number
}

export interface InspectDeps {
  getClient: () => KiloClient
  getRoot: () => string | undefined
  getState: () => WorktreeStateManager | undefined
  waitReady: (context: string) => Promise<void>
  localDiff: (dir: string, base: string) => Promise<WorktreeDiffEntry[]>
  aheadBehind: (dir: string, base: string) => Promise<{ ahead: number; behind: number }>
  respond: (requestID: string, output: string) => Promise<void>
  fail: (requestID: string, message: string) => Promise<void>
  log: (...args: unknown[]) => void
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function tail(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, MAX_TAIL) : undefined
}

export function parseInspectRequest(value: unknown): InspectRequest | undefined {
  if (!record(value)) return undefined
  const targetSessionID = text(value.targetSessionID)
  if (!targetSessionID) return undefined
  const count = tail(value.tail)
  return {
    requestID: text(value.requestID) ?? `am-inspect-${Date.now()}`,
    sessionID: text(value.sessionID),
    directory: text(value.directory),
    targetSessionID,
    ...(count ? { tail: count } : {}),
  }
}

function limit(input: string | undefined, max = MAX_TEXT): string {
  if (!input) return ""
  if (input.length <= max) return input
  return `${input.slice(0, max)}\n[truncated ${input.length - max} chars]`
}

function lines(title: string, body?: string): string[] {
  if (!body) return []
  return [title, body]
}

function textParts(msg: Msg): string {
  return msg.parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n")
}

function latest(messages: Msg[], role: "user" | "assistant"): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.info.role !== role) continue
    const body = textParts(msg)
    if (body) return limit(body)
  }
}

function toolLabel(part: Extract<Part, { type: "tool" }>): string {
  const state = part.state
  if (state.status === "completed") return `${part.tool} completed: ${state.title}\n${limit(state.output, MAX_TOOL)}`
  if (state.status === "error") return `${part.tool} error: ${limit(state.error, MAX_TOOL)}`
  if (state.status === "running") return `${part.tool} running${state.title ? `: ${state.title}` : ""}`
  return `${part.tool} pending`
}

function latestTool(messages: Msg[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j]
      if (part?.type === "tool") return toolLabel(part)
    }
  }
}

function history(messages: Msg[], count: number): string[] {
  const recent = messages.slice(-count)
  return recent.map((msg) => {
    const body = textParts(msg)
    const tools = msg.parts
      .filter((part): part is Extract<Part, { type: "tool" }> => part.type === "tool")
      .map(toolLabel)
    const content = [limit(body), ...tools.map((tool) => limit(tool, MAX_TOOL))].filter(Boolean).join("\n")
    return `### ${msg.info.role} ${msg.info.id}\n${content || "(no text output)"}`
  })
}

function pending(
  input: { permissions: PermissionRequest[]; questions: QuestionRequest[] },
  sessionID: string,
): string[] {
  const perms = input.permissions
    .filter((item) => item.sessionID === sessionID)
    .map((item) => `permission ${item.id}: ${item.permission} ${item.patterns.join(", ")}`)
  const qs = input.questions
    .filter((item) => item.sessionID === sessionID)
    .map((item) => `question ${item.id}: ${item.questions.map((q) => q.question).join(" | ")}`)
  return [...perms, ...qs]
}

function context(
  root: string | undefined,
  session: ManagedSession | undefined,
  worktree: Worktree | undefined,
): string[] {
  if (worktree) {
    return [
      `mode: worktree`,
      `worktree_id: ${worktree.id}`,
      `path: ${worktree.path}`,
      `branch: ${worktree.branch}`,
      `base: ${remoteRef(worktree)}`,
      ...(worktree.sectionId ? [`section_id: ${worktree.sectionId}`] : []),
      ...(worktree.label ? [`label: ${worktree.label}`] : []),
      ...(worktree.prUrl ? [`pr: ${worktree.prUrl}`] : []),
    ]
  }
  return [`mode: ${session ? "local" : "unmanaged"}`, ...(root ? [`path: ${root}`] : [])]
}

async function diff(deps: InspectDeps, worktree: Worktree | undefined): Promise<string[]> {
  if (!worktree) return []
  const base = remoteRef(worktree)
  const [files, ab] = await Promise.all([
    deps.localDiff(worktree.path, base).catch((err) => {
      deps.log("Agent Manager inspect diff failed", getErrorMessage(err))
      return []
    }),
    deps.aheadBehind(worktree.path, base).catch(() => ({ ahead: 0, behind: 0 })),
  ])
  const additions = files.reduce((sum, item) => sum + item.additions, 0)
  const deletions = files.reduce((sum, item) => sum + item.deletions, 0)
  const shown = files.slice(0, MAX_DIFF_FILES).map((item) => {
    const status = item.status ?? "modified"
    return `- ${status} ${item.file} (+${item.additions}/-${item.deletions})`
  })
  return [
    `files: ${files.length}, additions: ${additions}, deletions: ${deletions}, ahead: ${ab.ahead}, behind: ${ab.behind}`,
    ...shown,
    ...(files.length > shown.length ? [`... ${files.length - shown.length} more files`] : []),
  ]
}

async function inspect(deps: InspectDeps, req: InspectRequest): Promise<string> {
  await deps.waitReady("inspectFromTool")
  const state = deps.getState()
  const root = deps.getRoot()
  const managed = state?.getSession(req.targetSessionID)
  const worktree = managed?.worktreeId ? state?.getWorktree(managed.worktreeId) : undefined
  const dir = worktree?.path ?? root
  if (!dir) throw new Error("Open a folder to inspect Agent Manager sessions")

  const client = deps.getClient()
  const count = Math.max(req.tail ?? DEFAULT_TAIL, DEFAULT_TAIL)
  const [{ data: info }, { data: messages }, { data: statuses }, { data: permissions }, { data: questions }] =
    await Promise.all([
      client.session.get({ sessionID: req.targetSessionID, directory: dir }, { throwOnError: true }),
      client.session.messages({ sessionID: req.targetSessionID, directory: dir, limit: count }, { throwOnError: true }),
      client.session.status({ directory: dir }, { throwOnError: true }),
      client.permission.list({ directory: dir }, { throwOnError: true }),
      client.question.list({ directory: dir }, { throwOnError: true }),
    ])
  const msgs = messages as Msg[]
  const waits = pending({ permissions, questions }, req.targetSessionID)
  const diffLines = await diff(deps, worktree)
  const status = statuses[req.targetSessionID]?.type ?? "idle"

  return [
    `# Agent Manager Inspect`,
    `session_id: ${req.targetSessionID}`,
    `title: ${info.title}`,
    `status: ${status}`,
    `updated: ${new Date(info.time.updated).toISOString()}`,
    "",
    "## Context",
    ...context(root, managed, worktree),
    "",
    "## Latest",
    ...lines("latest_user:", latest(msgs, "user")),
    ...lines("latest_assistant:", latest(msgs, "assistant")),
    ...lines("latest_tool:", latestTool(msgs)),
    ...(waits.length > 0 ? ["pending:", ...waits] : ["pending: none"]),
    "",
    "## Diff Summary",
    ...(diffLines.length > 0 ? diffLines : ["No worktree diff context available."]),
    "",
    "## Conversation Tail",
    ...history(msgs, req.tail ?? DEFAULT_TAIL),
  ].join("\n")
}

export async function inspectFromTool(deps: InspectDeps, req: InspectRequest): Promise<void> {
  try {
    await deps.respond(req.requestID, await inspect(deps, req))
  } catch (err) {
    const msg = getErrorMessage(err)
    deps.log("Agent Manager inspect request failed", msg)
    await deps.fail(req.requestID, msg)
  }
}
