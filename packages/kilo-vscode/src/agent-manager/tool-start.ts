import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { sanitizeBranchName, versionedName } from "./branch-name"
import type { CreateWorktreeResult } from "./WorktreeManager"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import type { PanelContext } from "./host"
import { PLATFORM } from "./constants"

const LABEL_MAX = 28
const PREFIX = new Set(["feat", "fix", "chore", "bug", "issue", "task", "branch"])

export interface ToolTask {
  prompt?: string
  name?: string
  branchName?: string
}

export interface ToolRequest {
  requestID: string
  sessionID?: string
  directory?: string
  mode: "worktree" | "local"
  versions?: boolean
  tasks: ToolTask[]
}

interface WorktreeCreated {
  worktree: ReturnType<WorktreeStateManager["addWorktree"]>
  result: CreateWorktreeResult
}

export interface ToolDeps {
  getClient: () => KiloClient
  getRoot: () => string | undefined
  getState: () => WorktreeStateManager | undefined
  getPanel: () => PanelContext | undefined
  openPanel: (preserveFocus?: boolean) => void
  waitReady: (context: string) => Promise<void>
  createWorktree: (opts: {
    groupId?: string
    branchName?: string
    name?: string
    label?: string
  }) => Promise<WorktreeCreated | null>
  cleanupWorktree: (wid: string, dir: string) => Promise<void>
  setup: (dir: string, branch?: string, id?: string) => Promise<void>
  createSessionInWorktree: (dir: string, branch: string, id?: string) => Promise<Session | null>
  registerWorktreeSession: (sid: string, dir: string) => void
  notifyReady: (sid: string, result: CreateWorktreeResult, wid?: string) => void
  push: () => void
  post: (msg: unknown) => void
  capture: (event: string, props?: Record<string, unknown>) => void
  log: (...args: unknown[]) => void
  error: (msg: string) => void
}

function text(task: ToolTask): string | undefined {
  return task.prompt?.trim() || undefined
}

function clean(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

function label(value: string | undefined): string | undefined {
  const raw = clean(value)
  if (!raw) return undefined
  const words = raw
    .toLowerCase()
    .replace(/[/_.-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
  const meaningful = words.filter((word) => !PREFIX.has(word))
  const picked: string[] = []
  for (const word of meaningful.length > 0 ? meaningful : words) {
    const next = [...picked, word].join(" ")
    if (next.length > LABEL_MAX) break
    picked.push(word)
    if (picked.length >= 3) break
  }
  return picked.join(" ") || words[0]?.slice(0, LABEL_MAX) || undefined
}

function branch(value: string | undefined): string | undefined {
  const raw = clean(value)
  if (!raw) return undefined
  return sanitizeBranchName(raw) || undefined
}

function versionedLabel(base: string | undefined, index: number, total: number): string | undefined {
  if (!base) return undefined
  if (total > 1 && index > 0) return `${base} v${index + 1}`
  return base
}

async function prompt(client: KiloClient, sid: string, dir: string, task: ToolTask) {
  const body = text(task)
  if (!body) return
  await client.session.promptAsync(
    {
      sessionID: sid,
      directory: dir,
      parts: [{ type: "text", text: body }],
    },
    { throwOnError: true },
  )
}

async function local(deps: ToolDeps, client: KiloClient, task: ToolTask, directory?: string) {
  const root = deps.getRoot()
  const state = deps.getState()
  if (!root || !state) return false

  const dir = clean(directory) ?? root
  const wt = dir === root ? undefined : state.findWorktreeByPath(dir)
  if (dir !== root && !wt) {
    deps.log("Agent Manager tool local request ignored unknown directory", dir)
    deps.post({
      type: "error",
      message: `Agent Manager tool cannot start a local session for unknown directory: ${dir}`,
    })
    return false
  }
  const target = wt?.path ?? root
  const { data } = await client.session.create({ directory: target, platform: PLATFORM }, { throwOnError: true })
  const session = data
  state.addSession(session.id, wt?.id ?? null)
  if (wt) deps.registerWorktreeSession(session.id, wt.path)
  deps.push()
  deps.getPanel()?.sessions.registerSession(session)
  if (wt) deps.post({ type: "agentManager.sessionAdded", sessionId: session.id, worktreeId: wt.id })
  await prompt(client, session.id, target, task)
  deps.capture("Agent Manager Session Started", {
    source: PLATFORM,
    sessionId: session.id,
    tool: true,
    mode: "local",
    worktreeId: wt?.id,
  })
  return true
}

async function worktree(
  deps: ToolDeps,
  client: KiloClient,
  task: ToolTask,
  index: number,
  total: number,
  groupId?: string,
  versions?: boolean,
) {
  const baseBranch = branch(task.branchName) ?? branch(task.name)
  const baseLabel = label(task.name) ?? label(task.branchName) ?? label(task.prompt)
  const version = versionedName(baseBranch, versions ? index : 0, versions ? total : 1)
  const created = await deps.createWorktree({
    groupId,
    branchName: version.branch,
    name: version.branch,
    label: versionedLabel(baseLabel, versions ? index : 0, versions ? total : 1),
  })
  if (!created) return false

  await deps.setup(created.result.path, created.result.branch, created.worktree.id)
  const session = await deps.createSessionInWorktree(created.result.path, created.result.branch, created.worktree.id)
  if (!session) {
    await deps.cleanupWorktree(created.worktree.id, created.result.path)
    return false
  }

  const state = deps.getState()
  if (!state) {
    await deps.cleanupWorktree(created.worktree.id, created.result.path)
    return false
  }
  state.addSession(session.id, created.worktree.id)
  deps.registerWorktreeSession(session.id, created.result.path)
  deps.notifyReady(session.id, created.result, created.worktree.id)
  deps.getPanel()?.sessions.registerSession(session)
  await prompt(client, session.id, created.result.path, task)
  deps.capture("Agent Manager Session Started", {
    source: PLATFORM,
    sessionId: session.id,
    worktreeId: created.worktree.id,
    branch: created.result.branch,
    tool: true,
  })
  return true
}

export async function startFromTool(deps: ToolDeps, req: ToolRequest): Promise<void> {
  deps.openPanel(true)
  await deps.getPanel()?.waitForReady()
  await deps.waitReady("startFromTool")
  const client = deps.getClient()
  const total = req.tasks.length
  const versions = req.mode === "worktree" && req.versions === true && total > 1
  const groupId = versions ? `grp-${Date.now()}` : undefined
  const state = { ok: 0 }

  deps.post({ type: "agentManager.multiVersionProgress", status: "creating", total, completed: 0, groupId })
  for (let i = 0; i < req.tasks.length; i++) {
    const task = req.tasks[i]!
    try {
      const done =
        req.mode === "local"
          ? await local(deps, client, task, req.directory)
          : await worktree(deps, client, task, i, total, groupId, versions)
      if (done) state.ok++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      deps.log("Agent Manager tool task failed", msg)
      deps.post({ type: "error", message: `Agent Manager tool task failed: ${msg}` })
    }
    deps.post({ type: "agentManager.multiVersionProgress", status: "creating", total, completed: state.ok, groupId })
  }

  deps.post({ type: "agentManager.multiVersionProgress", status: "done", total, completed: state.ok, groupId })
  if (state.ok === 0) deps.error(`Failed to start any Agent Manager sessions for request ${req.requestID}.`)
  deps.log(`Agent Manager tool request ${req.requestID} complete: ${state.ok}/${total}`)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function task(value: unknown): ToolTask | undefined {
  if (!record(value)) return undefined
  const out: ToolTask = {}
  for (const key of ["prompt", "name", "branchName"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) out[key] = value[key]
  }
  if (!out.prompt && !out.name && !out.branchName) return undefined
  return out
}

export function parseToolRequest(value: unknown): ToolRequest | undefined {
  if (!record(value)) return undefined
  const mode = value.mode
  const tasks = value.tasks
  if (mode !== "worktree" && mode !== "local") return undefined
  if (!Array.isArray(tasks) || tasks.length === 0) return undefined
  const parsed = tasks
    .slice(0, 20)
    .map(task)
    .filter((item): item is ToolTask => !!item)
  if (parsed.length === 0) return undefined
  return {
    requestID: typeof value.requestID === "string" ? value.requestID : `am-${Date.now()}`,
    sessionID: typeof value.sessionID === "string" ? value.sessionID : undefined,
    directory: typeof value.directory === "string" ? value.directory : undefined,
    mode,
    versions: typeof value.versions === "boolean" ? value.versions : undefined,
    tasks: parsed,
  }
}
