import * as os from "os"
import * as vscode from "vscode"
import { MarketplaceService } from "."
import { fetchMarketplaceData, type MarketplaceActionContext } from "./actions"
import { selectSuggestions, showSuggestionNotification, suggestionSlug } from "./notify"
import type { KiloConnectionService } from "../cli-backend"
import type { MarketplaceItem } from "./types"

const DISMISSED_KEY = "kilo.marketplace.dismissedSuggestions"
const DEBOUNCE = 1500

/** Opens the marketplace install flow for a suggested item. */
export type InstallHandler = (item: MarketplaceItem) => void

/**
 * Scans the workspace for marketplace items annotated with relevant `suggest_for`
 * metadata and surfaces a discardable VS Code notification offering a one-click
 * install. Runs in the background, independent of the marketplace panel.
 */
export class MarketplaceNotifier implements vscode.Disposable {
  private readonly marketplace = new MarketplaceService()
  private disposables: vscode.Disposable[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private disposed = false
  /** Slugs already shown this session so a single scan burst doesn't re-toast. */
  private shown = new Set<string>()

  constructor(
    private readonly connection: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
    private readonly install: InstallHandler,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
      vscode.extensions.onDidChange(() => this.schedule()),
      vscode.workspace.onDidCreateFiles(() => this.schedule()),
    )
  }

  /** Begin the first background scan. Safe to call once after activation. */
  start(): void {
    this.schedule()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.generation++
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables = []
    this.marketplace.dispose()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.scan()
    }, DEBOUNCE)
  }

  private dismissed(): string[] {
    return this.context.globalState.get<string[]>(DISMISSED_KEY, []) ?? []
  }

  private async dismiss(slug: string): Promise<void> {
    const existing = this.dismissed()
    if (existing.includes(slug)) return
    await this.context.globalState.update(DISMISSED_KEY, [...existing, slug])
  }

  private project(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  }

  private directory(): string {
    return this.project() ?? os.homedir()
  }

  private roots(): vscode.Uri[] {
    return vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []
  }

  private get ctx(): MarketplaceActionContext {
    return { connection: this.connection, marketplace: this.marketplace, storage: this.context.globalStorageUri }
  }

  private async scan(): Promise<void> {
    const generation = ++this.generation
    const data = await fetchMarketplaceData(this.ctx, this.project(), this.directory(), this.roots()).catch(
      (err: unknown) => {
        console.warn("[Kilo New] Marketplace suggestion scan failed:", err)
        return undefined
      },
    )
    if (!data || generation !== this.generation) return

    const installed = new Set([
      ...Object.keys(data.marketplaceInstalledMetadata.project),
      ...Object.keys(data.marketplaceInstalledMetadata.global),
    ])
    const suggestions = selectSuggestions(data.marketplaceItems, data.marketplaceRelevance, [
      ...this.dismissed(),
      ...this.shown,
      ...installed,
    ])
    if (suggestions.length === 0) return

    // Surface one suggestion at a time to avoid stacking toasts.
    const item = suggestions[0]
    const slug = suggestionSlug(item)
    this.shown.add(slug)

    // A later rescan must never void the user's explicit choice, so only a
    // disposed notifier short-circuits here — not a bumped generation.
    const choice = await showSuggestionNotification(item)
    if (this.disposed) return
    if (choice?.action === "install") this.install(item)
    if (choice?.action === "dismiss") await this.dismiss(slug)
  }
}
