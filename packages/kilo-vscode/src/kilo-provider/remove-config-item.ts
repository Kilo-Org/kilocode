import type * as vscode from "vscode"
import type { KiloConnectionService } from "../services/cli-backend"
import { removeMarketplaceItemFromAllScopes, type MarketplaceRemoveContext } from "../services/marketplace/actions"
import { MarketplaceInstaller } from "../services/marketplace/installer"
import { MarketplacePaths } from "../services/marketplace/paths"
import type { MarketplaceItemRef } from "../services/marketplace/types"

export interface RemoveConfigItemContext {
  connection: KiloConnectionService
  project: () => string | undefined
  directory: () => string
  refresh: () => Promise<void>
  remove: MarketplaceRemoveContext["remove"]
  storage?: vscode.Uri
}

export function createMarketplaceRemover(): MarketplaceRemoveContext["remove"] {
  const installer = new MarketplaceInstaller(new MarketplacePaths())
  return (item, scope, project) => installer.remove(item, scope, project)
}

export async function removeMcp(ctx: RemoveConfigItemContext, name: string): Promise<boolean> {
  return remove(ctx, { id: name, type: "mcp" })
}

async function remove(ctx: RemoveConfigItemContext, item: MarketplaceItemRef): Promise<boolean> {
  const actions: MarketplaceRemoveContext = {
    connection: ctx.connection,
    storage: ctx.storage,
    remove: ctx.remove,
  }
  const removed = await removeMarketplaceItemFromAllScopes(actions, item, ctx.project(), ctx.directory())
  if (removed) await ctx.refresh()
  return removed
}
