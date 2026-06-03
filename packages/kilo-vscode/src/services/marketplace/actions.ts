import * as path from "path"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import { retry } from "../cli-backend/retry"
import type { MarketplaceService } from "."
import type {
  InstallMarketplaceItemOptions,
  InstallResult,
  MarketplaceDataResponse,
  MarketplaceItem,
  MarketplaceItemRef,
  RemoveResult,
} from "./types"

export interface MarketplaceActionContext {
  connection: KiloConnectionService
  marketplace: MarketplaceService
  storage?: vscode.Uri
}

export interface MarketplaceRemoveContext {
  connection: KiloConnectionService
  storage?: vscode.Uri
  remove: (item: MarketplaceItemRef, scope: "project" | "global", project?: string) => Promise<RemoveResult>
}

export async function fetchMarketplaceData(
  ctx: MarketplaceActionContext,
  project: string | undefined,
  dir: string | undefined,
): Promise<MarketplaceDataResponse> {
  const skills = dir ? await fetchSkills(ctx, dir) : undefined
  return ctx.marketplace.fetchData(project, skills)
}

export async function installMarketplaceItem(
  ctx: MarketplaceActionContext,
  item: MarketplaceItem,
  opts: InstallMarketplaceItemOptions,
  project: string | undefined,
  dir: string,
): Promise<InstallResult> {
  const scope = opts.target ?? "project"
  if (scope === "project" && !project) {
    return { success: false, slug: item.id, error: "No workspace directory for project-scope install" }
  }

  try {
    const result = await ctx.marketplace.install(item, opts, project)
    if (result.success) await invalidate(ctx, scope, scope === "project" ? project! : dir)
    return result
  } catch (err) {
    return { success: false, slug: item.id, error: String(err) }
  }
}

export async function removeMarketplaceItem(
  ctx: MarketplaceActionContext,
  item: MarketplaceItem,
  scope: "project" | "global",
  project: string | undefined,
  dir: string,
): Promise<RemoveResult> {
  if (scope === "project" && !project) {
    return { success: false, slug: item.id, error: "No workspace directory for project-scope removal" }
  }

  try {
    if (item.type === "mcp") await removeLegacyMcp(ctx, item.id, project, scope)
    const result = await ctx.marketplace.remove(item, scope, project)
    if (result.success) await invalidate(ctx, scope, scope === "project" ? project! : dir)
    return result
  } catch (err) {
    return { success: false, slug: item.id, error: String(err) }
  }
}

export async function removeMarketplaceItemFromAllScopes(
  ctx: MarketplaceRemoveContext,
  item: MarketplaceItemRef,
  project: string | undefined,
  dir: string,
): Promise<boolean> {
  try {
    if (item.type === "mcp") await removeLegacyMcp(ctx, item.id, project, "all")
    const local = project ? await ctx.remove(item, "project", project) : undefined
    const global = await ctx.remove(item, "global", project)
    if (!local?.success && !global.success) return false
    await invalidate(ctx, global.success ? "global" : "project", global.success ? dir : project!)
    return true
  } catch (err) {
    console.warn("[Kilo New] Marketplace removal failed:", err)
    return false
  }
}

async function fetchSkills(ctx: MarketplaceActionContext, dir: string) {
  try {
    const client = await ctx.connection.getClientAsync(dir)
    const { data } = await retry(() => client.app.skills({ directory: dir }, { throwOnError: true }))
    return data
  } catch (err) {
    console.warn("[Kilo New] Failed to fetch CLI skills for marketplace:", err)
    return undefined
  }
}

async function invalidate(
  ctx: { connection: KiloConnectionService },
  scope: "project" | "global",
  dir: string,
): Promise<void> {
  const client = await ctx.connection.getClientAsync(dir).catch((err: unknown) => {
    console.warn("[Kilo New] Marketplace CLI invalidation deferred:", err)
    return null
  })
  if (!client) return

  if (scope === "global") {
    await client.global.config.update({ config: {} }).catch((err: unknown) => {
      console.warn("[Kilo New] global.config.update after marketplace change failed:", err)
    })
  }
  await client.instance.dispose({ directory: dir }).catch((err: unknown) => {
    console.warn("[Kilo New] instance.dispose() after marketplace change failed:", err)
  })
}

async function removeLegacyMcp(
  ctx: { storage?: vscode.Uri },
  name: string,
  project: string | undefined,
  scope: "project" | "global" | "all",
): Promise<boolean> {
  const files: vscode.Uri[] = []
  if (project && scope !== "global") {
    files.push(vscode.Uri.file(path.join(project, ".kilo", "mcp.json")))
    files.push(vscode.Uri.file(path.join(project, ".kilocode", "mcp.json")))
  }

  if (ctx.storage && scope !== "project") files.push(vscode.Uri.joinPath(ctx.storage, "settings", "mcp_settings.json"))

  let removed = false
  for (const uri of files) {
    const bytes = await vscode.workspace.fs.readFile(uri).then(
      (data) => data,
      () => null,
    )
    if (!bytes) continue

    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>
      const servers = parsed.mcpServers as Record<string, unknown> | undefined
      if (!servers?.[name]) continue
      delete servers[name]
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(parsed, null, 2), "utf8"))
      removed = true
    } catch (err) {
      console.warn("[Kilo New] Failed to remove legacy MCP from", uri.fsPath, err)
    }
  }
  return removed
}
