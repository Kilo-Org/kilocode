import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { detectMarketplaceRelevance } from "./relevance"
import type {
  MarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  MarketplaceRelevanceMetadata,
  InstallResult,
  RemoveResult,
  MarketplaceItemRef,
} from "./types"

export class MarketplaceService {
  private scans = new Map<string, Promise<MarketplaceRelevanceMetadata>>()

  async fetchData(
    client: KiloClient,
    project: string | undefined,
    dir: string,
    roots: readonly vscode.Uri[],
  ): Promise<MarketplaceDataResponse> {
    const { data } = await client.kilocode.marketplace.list({ directory: dir }, { throwOnError: true })
    const items = (data.items ?? []) as MarketplaceItem[]
    const relevance = await this.relevance(items, roots)
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

  private relevance(items: MarketplaceItem[], roots: readonly vscode.Uri[]): Promise<MarketplaceRelevanceMetadata> {
    const key = `${roots.map((root) => root.toString()).join(",")}:${items.map((item) => `${item.type}:${item.id}`).join(",")}`
    const current = this.scans.get(key)
    if (current) return current

    const scan = detectMarketplaceRelevance(items, roots).finally(() => this.scans.delete(key))
    this.scans.set(key, scan)
    return scan
  }

  async install(
    client: KiloClient,
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    dir: string,
  ): Promise<InstallResult> {
    const { data } = await client.kilocode.marketplace.install(
      { directory: dir, item, target: options.target, parameters: options.parameters },
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

  dispose(): void {
    this.scans.clear()
  }
}

export type {
  MarketplaceItem,
  AgentMarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  InstallResult,
  RemoveResult,
} from "./types"
