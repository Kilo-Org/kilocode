import path from "path"
import type {
  KilocodeWorktreeUsageDetail,
  KilocodeWorktreeUsageSummary,
  KilocodeWorktreeUsageTimeline,
} from "@kilocode/sdk/v2/client"
import { getErrorMessage } from "../kilo-provider-utils"
import type { ServerConfig } from "../services/cli-backend/types"
import type { AgentManagerInMessage, AgentManagerOutMessage, AgentManagerWorktreeUsageSummaryEntry } from "./types"
import type { ProjectContext } from "./project/context"

export interface UsageConnection {
  getClientAsync: (dir?: string) => Promise<unknown>
  getServerConfig: () => ServerConfig | null
}

interface Deps {
  connection: UsageConnection
  post: (message: AgentManagerOutMessage) => void
  log: (message: string) => void
}

export async function requestUsage<T>(
  connection: UsageConnection,
  dir: string,
  route: string,
  query?: Record<string, string>,
) {
  await connection.getClientAsync(dir)
  const config = connection.getServerConfig()
  if (!config) throw new Error("Kilo backend is not connected")
  const url = new URL(route, config.baseUrl)
  url.searchParams.set("directory", dir)
  for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value)
  const auth = Buffer.from(`kilo:${config.password}`).toString("base64")
  const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
  if (!response.ok) throw new Error(`Worktree usage request failed (${response.status}): ${await response.text()}`)
  return (await response.json()) as T
}

function key(dir: string) {
  return path.resolve(dir)
}

function byDirectory(items: KilocodeWorktreeUsageSummary[]) {
  const map = new Map<string, KilocodeWorktreeUsageSummary>()
  for (const item of items) map.set(key(item.directory), item)
  return map
}

function entries(ctx: ProjectContext, items: KilocodeWorktreeUsageSummary[]): AgentManagerWorktreeUsageSummaryEntry[] {
  const map = byDirectory(items)
  return ctx
    .stateManager()
    .getWorktrees()
    .map((wt) => ({ worktreeId: wt.id, summary: map.get(key(wt.path)) }))
    .filter((item): item is AgentManagerWorktreeUsageSummaryEntry => item.summary !== undefined)
}

function postError(ctx: ProjectContext, deps: Deps, worktreeId: string | undefined, error: unknown) {
  const message = getErrorMessage(error)
  deps.log(`worktree usage request failed: ${message}`)
  if (worktreeId) deps.post({ type: "agentManager.worktreeUsage", projectId: ctx.id, worktreeId, error: message })
  else deps.post({ type: "agentManager.worktreeUsageSummaries", projectId: ctx.id, summaries: [], error: message })
}

async function summaries(ctx: ProjectContext, deps: Deps) {
  const result = await requestUsage<{ worktrees: KilocodeWorktreeUsageSummary[] }>(
    deps.connection,
    ctx.root,
    "/kilocode/worktree/usage/summaries",
  )
  deps.post({
    type: "agentManager.worktreeUsageSummaries",
    projectId: ctx.id,
    summaries: entries(ctx, result.worktrees),
  })
}

async function detail(ctx: ProjectContext, deps: Deps, worktreeId: string) {
  const worktree = ctx.stateManager().getWorktree(worktreeId)
  if (!worktree) return
  const [detail, timeline] = await Promise.all([
    requestUsage<KilocodeWorktreeUsageDetail>(deps.connection, worktree.path, "/kilocode/worktree/usage"),
    requestUsage<KilocodeWorktreeUsageTimeline>(deps.connection, worktree.path, "/kilocode/worktree/usage/timeline", {
      limit: "120",
    }),
  ])
  deps.post({
    type: "agentManager.worktreeUsage",
    projectId: ctx.id,
    worktreeId,
    detail,
    timeline,
  })
}

export function handleUsageMessage(m: AgentManagerInMessage, ctx: ProjectContext, deps: Deps): boolean {
  if (m.type === "agentManager.requestWorktreeUsageSummaries") {
    void summaries(ctx, deps).catch((err) => postError(ctx, deps, undefined, err))
    return true
  }
  if (m.type === "agentManager.requestWorktreeUsage") {
    void detail(ctx, deps, m.worktreeId).catch((err) => postError(ctx, deps, m.worktreeId, err))
    return true
  }
  return false
}
