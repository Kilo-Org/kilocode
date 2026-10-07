import * as vscode from "vscode"
import {
  BrowserLaunchError,
  diagnostic,
  type BrowserBroker,
  type BrowserOwner,
  type BrowserRoute,
  type BrowserState,
} from "../services/browser-automation"
import {
  browserControlMessage,
  browserStatePayload,
  controlBrowser,
  controlBrowserFailure,
  type BrowserControlKind,
  type BrowserControlMessage,
  type BrowserControlSurface,
} from "../services/browser-automation/browser-control"
import type { BrowserInteraction, BrowserViewIdentity, BrowserViewport } from "../shared/browser-stream"
import type { BrowserReference } from "../shared/browser-feedback"
import { buildWebviewHtml } from "../utils"

interface Panel {
  panel: vscode.WebviewPanel
  sessionId: string
  ready: boolean
  pendingUrl?: string
}

export interface BrowserTabProviderOptions {
  enabled: () => boolean
  trusted: () => boolean
  resolve: (route: BrowserRoute) => BrowserRoute | undefined
  directory: (sessionId: string) => string | undefined
  approve: (route: BrowserRoute, origin: string) => Promise<boolean>
  reference: (sessionId: string, reference: BrowserReference) => void
  log?: (...args: unknown[]) => void
}

type InMessage = {
  type: string
  sessionId?: string
  browserId?: string
  navigation?: number
  viewport?: BrowserViewport
  identity?: BrowserViewIdentity
  event?: BrowserInteraction
  sequence?: number
  url?: string
  requestId?: string
  x?: number
  y?: number
  width?: number
  height?: number
  hover?: boolean
  click?: boolean
  theme?: "dark" | "light"
  reference?: BrowserReference
}

const prefix = "browserTab."

/**
 * Host side of the editor-tab Integrated Browser. Renders one webview panel per
 * session and proxies browser commands to the shared {@link BrowserBroker}.
 *
 * Command handling is delegated to the shared {@link controlBrowser}, the same
 * implementation the Agent Manager browser uses, so the two surfaces cannot
 * drift. This provider only supplies the tab-specific message framing and route
 * owner (sidebar sessions carry no Agent Manager project id).
 */
export class BrowserTabProvider {
  private readonly panels = new Map<string, Panel>()
  private readonly disposables: vscode.Disposable[] = []
  readonly owner?: BrowserOwner

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly opts: {
      browser?: BrowserBroker
      connectionPort: () => number | undefined
    },
    private readonly options: BrowserTabProviderOptions,
  ) {
    this.owner = this.opts.browser?.bind(
      (route) => this.options.resolve(route),
      (route, url) => this.options.approve(route, url.origin),
    )
    if (this.opts.browser) {
      this.disposables.push(
        vscode.Disposable.from({ dispose: this.opts.browser.subscribe((state) => this.state(state)) }),
      )
      this.disposables.push(vscode.Disposable.from({ dispose: this.opts.browser.frames((frame) => this.frame(frame)) }))
    }
  }

  private log(...args: unknown[]): void {
    this.options.log?.(...args)
  }

  has(sessionId: string): boolean {
    return this.panels.has(sessionId)
  }

  open(sessionId: string): void {
    const existing = this.panels.get(sessionId)
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Active, false)
      return
    }
    const directory = this.options.directory(sessionId)
    const route = directory ? { sessionId, directory } : undefined
    if (!route || !this.options.resolve(route)) {
      this.log("Browser tab open rejected: session is not available", sessionId)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      "kilo-code.new.browser",
      "Integrated Browser",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        enableForms: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }
    panel.webview.html = this.html(panel.webview)
    const entry: Panel = { panel, sessionId, ready: false }
    this.panels.set(sessionId, entry)
    panel.webview.onDidReceiveMessage((message: InMessage) => this.input(entry, message))
    panel.onDidDispose(() => {
      this.panels.delete(sessionId)
      void this.opts.browser?.closeScoped(sessionId).catch((error: unknown) => this.log("Browser close failed:", error))
    })
  }

  /**
   * Open (or reveal) the browser tab for a session and navigate to a URL. Used
   * when a chat web link should open in the Integrated Browser. Returns false
   * when the browser cannot take the link, so the caller can fall back.
   */
  openUrl(sessionId: string, url: string): boolean {
    if (!this.options.trusted() || !this.options.enabled()) return false
    const directory = this.options.directory(sessionId)
    const route = directory ? { sessionId, directory } : undefined
    if (!route || !this.options.resolve(route) || !this.opts.browser) return false
    this.open(sessionId)
    const entry = this.panels.get(sessionId)
    if (!entry) return false
    if (entry.ready) this.navigate(entry, route, url)
    else entry.pendingUrl = url
    return true
  }

  private navigate(entry: Panel, route: BrowserRoute, url: string): void {
    entry.pendingUrl = undefined
    void this.opts.browser?.open(route, url, false).catch((error: unknown) => {
      this.log("Browser open failed:", error)
      // Surface early failures (for example no Chromium) instead of leaving the
      // link silently unopened. Keep the `missing` hint so the tab can offer the
      // install affordance, matching the shared in-panel error path.
      entry.panel.webview.postMessage({
        type: "browserTab.state",
        browserId: "",
        sessionId: entry.sessionId,
        status: "error",
        errors: 0,
        error: diagnostic(error, url),
        missing: error instanceof BrowserLaunchError ? error.missing : undefined,
      })
    })
  }

  dispose(): void {
    for (const entry of this.panels.values()) entry.panel.dispose()
    this.panels.clear()
    if (this.owner) this.opts.browser?.unbind(this.owner)
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }

  private html(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "browser-tab.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "browser-tab.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Integrated Browser",
      port: this.opts.connectionPort(),
      browserAutomation: this.options.enabled(),
      frameSrc: ["localhost", "127.0.0.1"].map((host) => `http://${host}:*`).join(" "),
    })
  }

  private state(state: BrowserState): void {
    if (state.projectId) return
    const entry = this.panels.get(state.sessionId)
    if (!entry) {
      // Open on any live status so a fast open that reaches "ready" before this
      // listener runs still reveals the tab.
      if (state.status !== "closed" && this.options.enabled()) this.open(state.sessionId)
      return
    }
    if (!entry.ready) return
    entry.panel.webview.postMessage(this.stateMessage(state))
  }

  private frame(frame: object & { sessionId: string; projectId?: string }): void {
    if (frame.projectId) return
    const entry = this.panels.get(frame.sessionId)
    if (!entry?.ready) return
    entry.panel.webview.postMessage({ ...frame, type: "browserTab.frame" })
  }

  private stateMessage(state: BrowserState) {
    return { type: "browserTab.state" as const, ...browserStatePayload(state) }
  }

  private control(message: InMessage): BrowserControlMessage {
    return browserControlMessage(message.type.slice(prefix.length) as BrowserControlKind, message)
  }

  private surface(entry: Panel): BrowserControlSurface {
    const sessionId = entry.sessionId
    return {
      sessionId,
      projectId: undefined,
      openDirectory: () => this.options.directory(sessionId),
      readClipboard: async () => vscode.env.clipboard.readText(),
      writeClipboard: async (text) => {
        await vscode.env.clipboard.writeText(text)
      },
      state: (state, error, missing) => {
        if (state) {
          entry.panel.webview.postMessage(this.stateMessage(error ? { ...state, error } : state))
          return
        }
        entry.panel.webview.postMessage({
          type: "browserTab.state",
          browserId: "",
          sessionId,
          status: "error",
          errors: 0,
          error,
          missing,
        })
      },
      inspection: ({ requestId, hover, value, error }) => {
        if (value) {
          entry.panel.webview.postMessage({ type: "browserTab.inspection", sessionId, requestId, ...value, hover })
          return
        }
        entry.panel.webview.postMessage({ type: "browserTab.inspection", sessionId, requestId, hover, logs: [], error })
      },
      devtools: (tools) => entry.panel.webview.postMessage({ type: "browserTab.devtools", sessionId, ...tools }),
      log: (...args) => this.log(...args),
    }
  }

  private input(entry: Panel, message: InMessage): void {
    if (message.type === "browserTab.ready") {
      entry.ready = true
      entry.panel.webview.postMessage({
        type: "browserTab.scope",
        sessionId: entry.sessionId,
        browserAutomation: this.options.enabled(),
      })
      if (entry.pendingUrl) {
        const url = entry.pendingUrl
        const directory = this.options.directory(entry.sessionId)
        const route = directory ? { sessionId: entry.sessionId, directory } : undefined
        if (route && this.options.resolve(route)) this.navigate(entry, route, url)
        else entry.pendingUrl = undefined
      }
      return
    }
    if (message.type === "browserTab.openSettings") {
      void vscode.commands.executeCommand("kilo-code.new.settingsButtonClicked", "experimental")
      return
    }
    if (message.type === "browserTab.openExternal") {
      if (!message.url) return
      const uri = vscode.Uri.parse(message.url)
      if (uri.scheme !== "http" && uri.scheme !== "https") return
      void vscode.env.openExternal(uri)
      return
    }
    if (message.type === "browserTab.reference") {
      if (message.reference) this.options.reference(entry.sessionId, message.reference)
      return
    }
    if (!message.type.startsWith(prefix)) return
    const control = this.control(message)
    if (!this.options.trusted()) {
      controlBrowserFailure(control, this.surface(entry), "Browser preview requires a trusted workspace.")
      return
    }
    if (!this.options.enabled()) {
      controlBrowserFailure(
        control,
        this.surface(entry),
        "Browser automation is disabled. Enable it in Kilo Settings > Experimental.",
      )
      return
    }
    const browser = this.opts.browser
    if (!browser) return
    controlBrowser(control, browser, this.surface(entry))
  }
}
