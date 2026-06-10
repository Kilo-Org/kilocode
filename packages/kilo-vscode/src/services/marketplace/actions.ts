import * as path from "path"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import { retry } from "../cli-backend/retry"
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
  storage?: vscode.Uri
}

export async function fetchMarketplaceData(
  ctx: MarketplaceActionContext,
  dir: string,
): Promise<MarketplaceDataResponse> {
  const started = Date.now()
  console.info("[Kilo New] Marketplace: list request", { directory: dir })
  const client = await ctx.connection.getClientAsync(dir)
  const { data } = await retry(() => client.kilocode.marketplace.list({ directory: dir }, { throwOnError: true }))
  console.info("[Kilo New] Marketplace: list response", {
    directory: dir,
    durationMs: Date.now() - started,
    itemCount: data.marketplaceItems.length,
    errorCount: data.errors?.length ?? 0,
  })
  return data
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

  const started = Date.now()
  console.info("[Kilo New] Marketplace: install request", {
    id: item.id,
    type: item.type,
    scope,
    directory: dir,
    hasParameters: !!opts.parameters && Object.keys(opts.parameters).length > 0,
    method: typeof opts.parameters?.__method === "string" ? opts.parameters.__method : undefined,
  })

  try {
    const client = await ctx.connection.getClientAsync(dir)
    const { data } = await retry(() =>
      client.kilocode.marketplace.install(
        { id: item.id, type: item.type, target: scope, parameters: opts.parameters, item, directory: dir },
        { throwOnError: true },
      ),
    )
    console.info("[Kilo New] Marketplace: install response", {
      id: item.id,
      type: item.type,
      scope,
      directory: dir,
      durationMs: Date.now() - started,
      success: data.success,
      error: data.error,
    })
    return {
      ...data,
      line: typeof data.line === "number" ? data.line : undefined,
    }
  } catch (err) {
    console.warn("[Kilo New] Marketplace: install failed", { id: item.id, type: item.type, scope, directory: dir, err })
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
  return removeMarketplaceItemRef(ctx, item, scope, project, dir)
}

export async function removeMarketplaceItemRef(
  ctx: MarketplaceActionContext,
  item: MarketplaceItemRef,
  scope: "project" | "global",
  project: string | undefined,
  dir: string,
): Promise<RemoveResult> {
  if (scope === "project" && !project) {
    return { success: false, slug: item.id, error: "No workspace directory for project-scope removal" }
  }

  const started = Date.now()
  console.info("[Kilo New] Marketplace: uninstall request", { id: item.id, type: item.type, scope, directory: dir })

  try {
    if (item.type === "mcp") await removeVsCodeLegacyMcp(ctx, item.id, project, scope)
    const client = await ctx.connection.getClientAsync(dir)
    const { data } = await retry(() =>
      client.kilocode.marketplace.uninstall(
        { id: item.id, type: item.type, target: scope, directory: dir },
        { throwOnError: true },
      ),
    )
    console.info("[Kilo New] Marketplace: uninstall response", {
      id: item.id,
      type: item.type,
      scope,
      directory: dir,
      durationMs: Date.now() - started,
      success: data.success,
      error: data.error,
    })
    return data
  } catch (err) {
    console.warn("[Kilo New] Marketplace: uninstall failed", {
      id: item.id,
      type: item.type,
      scope,
      directory: dir,
      err,
    })
    return { success: false, slug: item.id, error: String(err) }
  }
}

export async function removeMarketplaceItemFromAllScopes(
  ctx: MarketplaceActionContext,
  item: MarketplaceItemRef,
  project: string | undefined,
  dir: string,
): Promise<boolean> {
  const started = Date.now()
  console.info("[Kilo New] Marketplace: uninstall all scopes request", { id: item.id, type: item.type, directory: dir })

  try {
    if (item.type === "mcp") await removeVsCodeLegacyMcp(ctx, item.id, project, "all")
    const local = project ? await removeMarketplaceItemRef(ctx, item, "project", project, dir) : undefined
    const global = await removeMarketplaceItemRef(ctx, item, "global", project, dir)
    console.info("[Kilo New] Marketplace: uninstall all scopes response", {
      id: item.id,
      type: item.type,
      directory: dir,
      durationMs: Date.now() - started,
      project: local ? { success: local.success, error: local.error } : undefined,
      global: { success: global.success, error: global.error },
    })
    return !!local?.success || global.success
  } catch (err) {
    console.warn("[Kilo New] Marketplace removal failed:", err)
    return false
  }
}

async function removeVsCodeLegacyMcp(
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
