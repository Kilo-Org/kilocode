import type * as vscode from "vscode"
import type { KiloConnectionService } from "../services/cli-backend"
import { removeMarketplaceItemFromAllScopes, type MarketplaceActionContext } from "../services/marketplace/actions"
import type { MarketplaceItemRef } from "../services/marketplace/types"

export interface RemoveConfigItemContext {
  connection: KiloConnectionService
  project: () => string | undefined
  directory: () => string
  refresh: () => Promise<void>
  storage?: vscode.Uri
}

export async function removeAgent(ctx: RemoveConfigItemContext, name: string): Promise<boolean> {
  return remove(ctx, { id: name, type: "agent" })
}

export async function removeMcp(ctx: RemoveConfigItemContext, name: string): Promise<boolean> {
  return remove(ctx, { id: name, type: "mcp" })
}

async function remove(ctx: RemoveConfigItemContext, item: MarketplaceItemRef): Promise<boolean> {
  const actions: MarketplaceActionContext = {
    connection: ctx.connection,
    storage: ctx.storage,
  }
  const removed = await removeMarketplaceItemFromAllScopes(actions, item, ctx.project(), ctx.directory())
  if (removed) await ctx.refresh()
  return removed
}
