import type { KiloClient } from "@kilocode/sdk/v2/client"
import { detectMarketplaceRelevance } from "./relevance"
import type {
  MarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  InstallResult,
  RemoveResult,
  MarketplaceItemRef,
} from "./types"

export class MarketplaceService {
  async fetchData(client: KiloClient, project: string | undefined, dir: string): Promise<MarketplaceDataResponse> {
    const { data } = await client.kilocode.marketplace.list({ directory: dir }, { throwOnError: true })
    const items = (data.items ?? []) as MarketplaceItem[]
    const relevance = detectMarketplaceRelevance(items, data.filenames ?? [])
    const installed = project
      ? data.installed
      : { project: {}, global: { ...data.installed.global, ...data.installed.project } }

    return {
      marketplaceItems: items,
      marketplaceInstalledMetadata: installed,
      marketplaceRelevance: relevance,
      errors: data.errors && data.errors.length > 0 ? data.errors : undefined,
    }
  }

  async install(
    client: KiloClient,
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    dir: string,
  ): Promise<InstallResult> {
    const { data } = await client.kilocode.marketplace.install(
      {
        directory: dir,
        item,
        target: options.target,
        parameters: options.parameters,
      },
      { throwOnError: true },
    )
    // Success notifications are owned by the caller driving the user-facing flow
    // (the marketplace panel). The all-scopes sidebar cleanup path calls remove()
    // twice, so notifying here would produce duplicate toasts for one removal.
    return data as InstallResult
  }

  async remove(
    client: KiloClient,
    item: MarketplaceItemRef,
    scope: "project" | "global",
    dir: string,
  ): Promise<RemoveResult> {
    const { data } = await client.kilocode.marketplace.remove(
      { directory: dir, item: { id: item.id, type: item.type }, scope },
      { throwOnError: true },
    )
    // Notifications are owned by the caller (see install() above).
    return data as RemoveResult
  }
}

export type {
  MarketplaceItem,
  AgentMarketplaceItem,
  PluginMarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  InstallResult,
  RemoveResult,
} from "./types"
