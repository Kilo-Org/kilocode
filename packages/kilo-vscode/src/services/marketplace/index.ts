import * as vscode from "vscode"
import { MarketplaceApiClient } from "./api"
import { MarketplacePaths } from "./paths"
import { InstallationDetector } from "./detection"
import { MarketplaceInstaller } from "./installer"
import { MarketplaceUninstaller } from "./uninstaller"
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
  private uninstaller: MarketplaceUninstaller

  constructor(globalStoragePath: string) {
    this.paths = new MarketplacePaths(globalStoragePath)
    this.api = new MarketplaceApiClient()
    this.detector = new InstallationDetector(this.paths)
    this.installer = new MarketplaceInstaller(this.paths)
    this.uninstaller = new MarketplaceUninstaller(this.paths)
  }

  async fetchData(workspace?: string, options?: { skipMcps?: boolean }): Promise<MarketplaceDataResponse> {
    const [fetched, metadata] = await Promise.all([this.api.fetchAll(options), this.detector.detect(workspace)])

    return {
      organizationMcps: [],
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
    const result = await this.uninstaller.remove(item, scope, workspace)

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
