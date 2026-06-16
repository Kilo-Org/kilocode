import * as os from "os"
import * as vscode from "vscode"
import type { GlobalEvent, SessionStatus } from "@kilocode/sdk/v2/client"
import { buildWebviewHtml, getWebviewFontSize } from "./utils"
import { watchFontSizeConfig } from "./kilo-provider/font-size"
import { mapSSEEventToWebviewMessage } from "./kilo-provider-utils"
import { resolvePanelProjectDirectory } from "./project-directory"
import { seedSessionStatuses } from "./session-status"
import type { KiloConnectionService } from "./services/cli-backend"
import { MarketplaceService } from "./services/marketplace"
import {
  fetchMarketplaceData,
  installMarketplaceItem,
  removeMarketplaceItem,
  type MarketplaceActionContext,
} from "./services/marketplace/actions"
import type { InstallMarketplaceItemOptions, MarketplaceItem } from "./services/marketplace/types"
import { TelemetryProxy } from "./services/telemetry"
import { TelemetryEventName } from "./services/telemetry/types"

interface MarketplaceMessage {
  type?: string
  mpItem?: MarketplaceItem
  mpInstallOptions?: InstallMarketplaceItemOptions
  url?: unknown
  event?: string
  properties?: Record<string, unknown>
}

export class MarketplacePanelProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.marketplacePanel"

  private panel: vscode.WebviewPanel | undefined
  private project: string | null = null
  private ready = false
  private statuses = new Map<string, SessionStatus["type"]>()
  private disposables: vscode.Disposable[] = []
  private subscriptions: Array<() => void> = []
  private readonly marketplace = new MarketplaceService()
  private readonly extensionVersion =
    vscode.extensions.getExtension("kilocode.kilo-code")?.packageJSON?.version ?? "unknown"

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {}

  private get marketplaceCtx(): MarketplaceActionContext {
    return { connection: this.connection, marketplace: this.marketplace, storage: this.context.globalStorageUri }
  }

  /**
   * `undefined` infers the project from the active editor or workspace,
   * while `null` intentionally disables project-scoped operations when no directory can be
   * selected safely, such as in an ambiguous multi-root workspace.
   */
  openPanel(directory?: string | null): void {
    const project = directory === undefined ? this.resolveProject() : directory
    if (this.panel) {
      this.setProjectDirectory(project)
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      MarketplacePanelProvider.viewType,
      "Kilo Marketplace",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )
    this.attach(panel, project)
  }

  deserializePanel(panel: vscode.WebviewPanel): void {
    this.attach(panel, this.resolveProject())
  }

  dispose(): void {
    this.panel?.dispose()
    this.cleanup()
    this.marketplace.dispose()
  }

  private attach(panel: vscode.WebviewPanel, project: string | null): void {
    this.cleanup()
    this.panel = panel
    this.project = project
    this.ready = false
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }
    panel.webview.html = this.getHtml(panel.webview)

    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg) => void this.handle(msg as MarketplaceMessage)),
      panel.onDidDispose(() => this.cleanup()),
      watchFontSizeConfig((msg) => this.post(msg)),
    )
    this.subscriptions.push(
      this.connection.onStateChange((state, err) => {
        this.post({ type: "connectionState", state, ...(err ? { error: err.message } : {}) })
        if (state === "connected") void this.sync(false)
      }),
      this.connection.onLanguageChanged((locale) => this.post({ type: "languageChanged", locale })),
      this.connection.onEventFiltered(
        (event) => event.type === "session.status",
        (event) => {
          if (event.type === "session.status") this.handleStatus(event)
        },
      ),
    )
    void this.connect()
  }

  private cleanup(): void {
    for (const disposable of this.disposables) disposable.dispose()
    for (const unsubscribe of this.subscriptions) unsubscribe()
    this.disposables = []
    this.subscriptions = []
    this.panel = undefined
    this.ready = false
    this.statuses.clear()
  }

  private async connect(): Promise<void> {
    try {
      await this.connection.connect(this.directory())
      await this.sync(this.statuses.size === 0)
    } catch (err) {
      this.post({ type: "connectionState", state: "error", error: err instanceof Error ? err.message : String(err) })
    }
  }

  private async sync(reconcile: boolean): Promise<void> {
    if (!this.ready) return
    const info = this.connection.getServerInfo()
    if (info) {
      const cfg = vscode.workspace.getConfiguration("kilo-code.new")
      this.post({
        type: "ready",
        serverInfo: info,
        extensionVersion: this.extensionVersion,
        vscodeLanguage: vscode.env.language,
        languageOverride: cfg.get<string>("language"),
        fontSize: getWebviewFontSize(),
        workspaceDirectory: this.project ?? "",
      })
    }
    this.post({ type: "connectionState", state: this.connection.getConnectionState() })

    try {
      const client = this.connection.getClient()
      await seedSessionStatuses(client, this.directory(), this.statuses, (msg) => this.post(msg), reconcile)
    } catch (err) {
      console.warn("[Kilo New] Marketplace session status sync failed:", err)
    }
  }

  private async handle(msg: MarketplaceMessage): Promise<void> {
    switch (msg.type) {
      case "webviewReady":
        this.ready = true
        if (this.connection.getConnectionState() === "connected") await this.sync(true)
        else await this.connect()
        await this.fetchData()
        return
      case "retryConnection":
        await this.connect()
        return
      case "fetchMarketplaceData":
        await this.fetchData()
        return
      case "installMarketplaceItem":
        if (msg.mpItem && msg.mpInstallOptions) await this.install(msg.mpItem, msg.mpInstallOptions)
        return
      case "removeInstalledMarketplaceItem":
        if (msg.mpItem) await this.remove(msg.mpItem, msg.mpInstallOptions?.target ?? "project")
        return
      case "dismissAgentMigrationBanner":
        await this.context.globalState.update("kilo.agentMigrationBannerDismissed", true)
        return
      case "openExternal":
        this.openExternal(msg.url)
        return
      case "telemetry":
        if (msg.event) TelemetryProxy.capture(msg.event as TelemetryEventName, msg.properties)
        return
    }
  }

  private async fetchData(): Promise<void> {
    try {
      const project = this.project ?? undefined
      const data = await fetchMarketplaceData(this.marketplaceCtx, project, this.directory())
      const dismissed = this.context.globalState.get<boolean>("kilo.agentMigrationBannerDismissed") ?? false
      this.post({ type: "marketplaceData", ...data, showAgentMigrationBanner: !dismissed })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      console.warn("[Kilo New] Marketplace data fetch failed:", err)
      this.post({
        type: "marketplaceData",
        marketplaceItems: [],
        marketplaceInstalledMetadata: { project: {}, global: {} },
        errors: [error],
      })
    }
  }

  private async install(item: MarketplaceItem, opts: InstallMarketplaceItemOptions): Promise<void> {
    const result = await installMarketplaceItem(
      this.marketplaceCtx,
      item,
      opts,
      this.project ?? undefined,
      this.directory(),
    )
    this.post({ type: "marketplaceInstallResult", ...result })
  }

  private async remove(item: MarketplaceItem, scope: "project" | "global"): Promise<void> {
    const result = await removeMarketplaceItem(
      this.marketplaceCtx,
      item,
      scope,
      this.project ?? undefined,
      this.directory(),
    )
    this.post({ type: "marketplaceRemoveResult", ...result })
  }

  private handleStatus(event: Extract<GlobalEvent["payload"], { type: "session.status" }>): void {
    const sid = event.properties.sessionID
    this.statuses.set(sid, event.properties.status.type)
    const msg = mapSSEEventToWebviewMessage(event, sid)
    if (msg) this.post(msg)
  }

  private setProjectDirectory(project: string | null): void {
    if (this.project === project) return
    this.project = project
    this.post({ type: "workspaceDirectoryChanged", directory: project ?? "" })
  }

  private resolveProject(): string | null {
    const editor = vscode.window.activeTextEditor
    const active =
      editor?.document.uri.scheme === "file"
        ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
        : undefined
    return resolvePanelProjectDirectory(active, vscode.workspace.workspaceFolders)
  }

  private directory(): string {
    return this.project ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir()
  }

  private openExternal(raw: unknown): void {
    if (typeof raw !== "string") return
    const uri = vscode.Uri.parse(raw)
    if (uri.scheme !== "http" && uri.scheme !== "https") return
    void vscode.env.openExternal(uri)
  }

  private post(msg: unknown): void {
    if (!this.panel || !this.ready) return
    void this.panel.webview.postMessage(msg).then(undefined, (err) => {
      console.warn("[Kilo New] Marketplace panel postMessage failed:", err)
    })
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "marketplace.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "marketplace.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Kilo Marketplace",
      port: this.connection.getServerInfo()?.port,
    })
  }
}
