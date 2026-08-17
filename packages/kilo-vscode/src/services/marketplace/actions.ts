import * as path from "path"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import { retry } from "../cli-backend/retry"
import { removeAgent } from "../agent-removal"
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
  marketplace: MarketplaceService
  storage?: vscode.Uri
}

export async function fetchMarketplaceData(
  ctx: MarketplaceActionContext,
  project: string | undefined,
  dir: string | undefined,
  roots: readonly vscode.Uri[],
): Promise<MarketplaceDataResponse> {
  const route = project ?? dir
  if (!route) {
    return {
      marketplaceItems: [],
      marketplaceInstalledMetadata: { project: {}, global: {} },
      marketplaceRelevance: {},
      errors: ["No directory available for marketplace data"],
    }
  }
  const client = await ctx.connection.getClientAsync(route)
  return retry(() => ctx.marketplace.fetchData(client, project, route, roots))
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
    const route = scope === "project" ? project! : dir
    const client = await ctx.connection.getClientAsync(route)
    return await retry(() => ctx.marketplace.install(client, item, opts, route))
  } catch (err) {
    return { success: false, slug: item.id, error: String(err) }
  }
}

export async function removeMarketplaceItem(
  ctx: MarketplaceActionContext,
  item: MarketplaceItemRef,
  scope: "project" | "global",
  project: string | undefined,
  dir: string,
): Promise<RemoveResult> {
  if (scope === "project" && !project) {
    return { success: false, slug: item.id, error: "No workspace directory for project-scope removal" }
  }

  try {
    if (item.type === "agent") {
      const target = scope === "project" ? project! : dir
      const result = await removeAgent({ connection: ctx.connection, directory: target, name: item.id, scope })
      if (result.success) await invalidate(ctx, target)
      return result
    }
    if (item.type === "mcp") await removeLegacyMcp(ctx, item.id, project, scope)
    const route = scope === "project" ? project! : dir
    const client = await ctx.connection.getClientAsync(route)
    return await retry(() => ctx.marketplace.remove(client, item, scope, route))
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
    const local = project ? await removeScoped(ctx, item, "project", project) : undefined
    const global = await removeScoped(ctx, item, "global", dir)
    return Boolean(local?.success || global.success)
  } catch (err) {
    console.warn("[Kilo New] Marketplace removal failed:", err)
    return false
  }
}

async function removeScoped(
  ctx: MarketplaceRemoveContext,
  item: MarketplaceItemRef,
  scope: "project" | "global",
  dir: string,
) {
  const client = await ctx.connection.getClientAsync(dir)
  return retry(() => ctx.marketplace.remove(client, item, scope, dir))
}

async function invalidate(ctx: MarketplaceActionContext, dir: string): Promise<void> {
  const client = await ctx.connection.getClientAsync(dir)
  await client.instance.dispose({ directory: dir })
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
