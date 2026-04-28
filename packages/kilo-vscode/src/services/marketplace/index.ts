import * as vscode from "vscode"
import { MarketplaceApiClient } from "./api"
import { MarketplacePaths } from "./paths"
import { InstallationDetector, type CliSkill } from "./detection"
import { MarketplaceInstaller } from "./installer"
import type {
  MarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  InstallResult,
  RemoveResult,
} from "./types"

export class MarketplaceService {
  private api: MarketplaceApiClient
  private paths: MarketplacePaths
  private detector: InstallationDetector
  private installer: MarketplaceInstaller

  constructor() {
    this.paths = new MarketplacePaths()
    this.api = new MarketplaceApiClient()
    this.detector = new InstallationDetector(this.paths)
    this.installer = new MarketplaceInstaller(this.paths)
  }

  async fetchData(workspace?: string, skills?: CliSkill[]): Promise<MarketplaceDataResponse> {
    const [fetched, metadata] = await Promise.all([this.api.fetchAll(), this.detector.detect(workspace, skills)])

    return {
      marketplaceItems: fetched.items,
      marketplaceInstalledMetadata: metadata,
      errors: fetched.errors.length > 0 ? fetched.errors : undefined,
    }
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
    this.api.dispose()
  }
}

export type {
  MarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  InstallResult,
  RemoveResult,
} from "./types"
