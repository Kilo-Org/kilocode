import * as vscode from "vscode"
import type { ClineMessage } from "@roo-code/types"
import { getUri } from "./getUri"
import { getNonce } from "./getNonce"
import type { ClineProvider } from "./ClineProvider"
import { webviewMessageHandler } from "./webviewMessageHandler"

export class BrowserSessionPanelManager {
	private static instances: WeakMap<ClineProvider, BrowserSessionPanelManager> = new WeakMap()
	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []
	private isReady: boolean = false
	private pendingUpdate?: { messages: ClineMessage[]; isActive: boolean }
	private pendingNavigateIndex?: number
	private userManuallyClosedPanel: boolean = false

	private constructor(private readonly provider: ClineProvider) {}

	/**
	 * Get or create a BrowserSessionPanelManager instance for the given provider
	 */
	public static getInstance(provider: ClineProvider): BrowserSessionPanelManager {
		let instance = BrowserSessionPanelManager.instances.get(provider)
		if (!instance) {
			instance = new BrowserSessionPanelManager(provider)
			BrowserSessionPanelManager.instances.set(provider, instance)
		}
		return instance
	}

	/**
	 * Show the browser session panel, creating it if necessary
	 */
	public async show(): Promise<void> {
		await this.createOrShowPanel()

		// Send initial browser session data
		const task = this.provider.getCurrentTask()
		if (task) {
			const messages = task.clineMessages || []
			const browserSessionStartIndex = messages.findIndex(
				(m) =>
					m.ask === "browser_action_launch" ||
					(m.say === "browser_session_status" && m.text?.includes("opened")),
			)
			const browserSessionMessages =
				browserSessionStartIndex !== -1 ? messages.slice(browserSessionStartIndex) : []
			const isBrowserSessionActive = task.browserSession?.isSessionActive() ?? false

			await this.updateBrowserSession(browserSessionMessages, isBrowserSessionActive)
		}
	}

	private async createOrShowPanel(): Promise<void> {
		// If panel already exists, show it
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One)
			return
		}

		const extensionUri = this.provider.context.extensionUri
		const extensionMode = this.provider.context.extensionMode

		// Create new panel
		this.panel = vscode.window.createWebviewPanel("roo.browserSession", "Browser Session", vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [extensionUri],
		})

		// Set up the webview's HTML content
		this.panel.webview.html =
			extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(this.panel.webview, extensionUri)
				: this.getHtmlContent(this.panel.webview, extensionUri)

		// Wire message channel for this panel (state handshake + actions)
		this.panel.webview.onDidReceiveMessage(
			async (message: any) => {
				try {
					// Let the shared handler process commands that work for any webview
					if (message?.type) {
						await webviewMessageHandler(this.provider as any, message)
					}
					// Panel-specific readiness and initial state
					if (message?.type === "webviewDidLaunch") {
						this.isReady = true
						// Send full extension state to this panel (the sidebar postState targets the main webview)
						const state = await (this.provider as any).getStateToPostToWebview?.()
						if (state) {
							await this.panel?.webview.postMessage({ type: "state", state })
						}
						// Flush any pending browser session update queued before readiness
						if (this.pendingUpdate) {
							await this.updateBrowserSession(this.pendingUpdate.messages, this.pendingUpdate.isActive)
							this.pendingUpdate = undefined
						}
						// Flush any pending navigation request queued before readiness
						if (this.pendingNavigateIndex !== undefined) {
							await this.navigateToStep(this.pendingNavigateIndex)
							this.pendingNavigateIndex = undefined
						}
					}
				} catch (err) {
					console.error("[BrowserSessionPanel] onDidReceiveMessage error:", err)
				}
			},
			undefined,
			this.disposables,
		)

		// Handle panel disposal - track that user closed it manually
		this.panel.onDidDispose(
			() => {
				// Mark that user manually closed the panel (unless we're programmatically disposing)
				if (this.panel) {
					this.userManuallyClosedPanel = true
				}
				this.panel = undefined
				this.dispose()
			},
			null,
			this.disposables,
		)
	}

	public async updateBrowserSession(messages: ClineMessage[], isBrowserSessionActive: boolean): Promise<void> {
		if (!this.panel) {
			return
		}
		// If the panel isn't ready yet, queue the latest snapshot to post after handshake
		if (!this.isReady) {
			this.pendingUpdate = { messages, isActive: isBrowserSessionActive }
			return
		}

		await this.panel.webview.postMessage({
			type: "browserSessionUpdate",
			browserSessionMessages: messages,
			isBrowserSessionActive,
		})
	}

	/**
	 * Navigate the Browser Session panel to a specific step index.
	 * If the panel isn't ready yet, queue the navigation to run after handshake.
	 */
	public async navigateToStep(stepIndex: number): Promise<void> {
		if (!this.panel) {
			return
		}
		if (!this.isReady) {
			this.pendingNavigateIndex = stepIndex
			return
		}

		await this.panel.webview.postMessage({
			type: "browserSessionNavigate",
			stepIndex,
		})
	}

	/**
	 * Reset the manual close flag (call this when a new browser session launches)
	 */
	public resetManualCloseFlag(): void {
		this.userManuallyClosedPanel = false
	}

	/**
	 * Check if auto-opening should be allowed (not manually closed by user)
	 */
	public shouldAllowAutoOpen(): boolean {
		return !this.userManuallyClosedPanel
	}

	/**
	 * Whether the Browser Session panel is currently open.
	 */
	public isOpen(): boolean {
		return !!this.panel
	}

	/**
	 * Toggle the Browser Session panel visibility.
	 * - If open: closes it
	 * - If closed: opens it and sends initial session snapshot
	 */
	public async toggle(): Promise<void> {
		if (this.panel) {
			this.dispose()
		} else {
			await this.show()
		}
	}

	public dispose(): void {
		// Clear the panel reference before disposing to prevent marking as manual close
		const panelToDispose = this.panel
		this.panel = undefined

		while (this.disposables.length) {
			const disposable = this.disposables.pop()
			if (disposable) {
				disposable.dispose()
			}
		}
		try {
			panelToDispose?.dispose()
		} catch {}
		this.isReady = false
		this.pendingUpdate = undefined
	}

	private async getHMRHtmlContent(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
		const fs = require("fs")
		const path = require("path")
		let localPort = "5173"

		try {
			const portFilePath = path.resolve(__dirname, "../../.vite-port")
			if (fs.existsSync(portFilePath)) {
				localPort = fs.readFileSync(portFilePath, "utf8").trim()
			}
		} catch (err) {
			console.error("[BrowserSessionPanel:Vite] Failed to read port file:", err)
		}

		const localServerUrl = `localhost:${localPort}`
		const nonce = getNonce()

		const stylesUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const codiconsUri = getUri(webview, extensionUri, ["assets", "codicons", "codicon.css"])

		const scriptUri = `http://${localServerUrl}/src/browser-panel.tsx`

		const reactRefresh = `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl}`,
			`img-src ${webview.cspSource} data:`,
			`script-src 'unsafe-eval' ${webview.cspSource} http://${localServerUrl} 'nonce-${nonce}'`,
			`connect-src ${webview.cspSource} ws://${localServerUrl} http://${localServerUrl}`,
		]

		return `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<title>Browser Session</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	private getHtmlContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
		const stylesUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.css"])
		const scriptUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "browser-panel.js"])
		const codiconsUri = getUri(webview, extensionUri, ["assets", "codicons", "codicon.css"])

		const nonce = getNonce()

		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`img-src ${webview.cspSource} data:`,
			`script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}'`,
			`connect-src ${webview.cspSource}`,
		]

		return `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<title>Browser Session</title>
				</head>
				<body>
					<div id="root"></div>
					<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}
}
