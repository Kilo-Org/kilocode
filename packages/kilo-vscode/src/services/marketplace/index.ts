import * as vscode from "vscode"
import { MarketplaceApiClient } from "./api"
import { MarketplacePaths } from "./paths"
import { InstallationDetector, type CliSkill } from "./detection"
import { MarketplaceInstaller } from "./installer"
import { detectMarketplaceRelevance } from "./relevance"
import type {
  MarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  MarketplaceRelevanceMetadata,
  InstallResult,
  RemoveResult,
} from "./types"

export class MarketplaceService {
  private api: MarketplaceApiClient
  private paths: MarketplacePaths
  private detector: InstallationDetector
  private installer: MarketplaceInstaller
  private scans = new Map<string, Promise<MarketplaceRelevanceMetadata>>()

  constructor() {
    this.paths = new MarketplacePaths()
    this.api = new MarketplaceApiClient()
    this.detector = new InstallationDetector(this.paths)
    this.installer = new MarketplaceInstaller(this.paths)
  }

  async fetchData(workspace: string | undefined, skills: CliSkill[] | undefined, roots: readonly vscode.Uri[]) {
    const fetched = this.api.fetchAll()
    const metadata = this.detector.detect(workspace, skills)
    const relevance = fetched.then((result) => this.relevance(result.items, roots))
    const [items, installed, matches] = await Promise.all([fetched, metadata, relevance])

    return {
      marketplaceItems: items.items,
      marketplaceInstalledMetadata: installed,
      marketplaceRelevance: matches,
      errors: items.errors.length > 0 ? items.errors : undefined,
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
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const result = await this.installer.install(item, options, workspace)

    if (result.success) {
      vscode.window.showInformationMessage(`Successfully installed ${item.name}`)
    }

    return result
  }

  async remove(item: MarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const result = await this.installer.remove(item, scope, workspace)

    if (result.success) {
      vscode.window.showInformationMessage(`Successfully removed ${item.name}`)
    }

    return result
  }

  dispose(): void {
    this.scans.clear()
    this.api.dispose()
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
