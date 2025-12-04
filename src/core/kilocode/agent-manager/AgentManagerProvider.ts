import * as vscode from "vscode"
import { spawn, ChildProcess } from "node:child_process"
import { AgentRegistry } from "./AgentRegistry"
import { findKilocodeCli } from "./CliPathResolver"
import { CliOutputParser, type StreamEvent, type KilocodeStreamEvent, type KilocodePayload } from "./CliOutputParser"
import { getUri } from "../../webview/getUri"
import { getNonce } from "../../webview/getNonce"
import { getViteDevServerConfig } from "../../webview/getViteDevServerConfig"
import type { ClineMessage } from "@roo-code/types"

const SESSION_TIMEOUT_MS = 120_000 // 2 minutes

/**
 * AgentManagerProvider
 *
 * Manages the Agent Manager webview panel and orchestrates kilocode agents.
 * Each agent runs as a CLI process using `kilocode --auto --json`.
 */
export class AgentManagerProvider implements vscode.Disposable {
	public static readonly viewType = "kilo-code.AgentManagerPanel"

	private panel: vscode.WebviewPanel | undefined
	private disposables: vscode.Disposable[] = []
	private registry: AgentRegistry
	private processes: Map<string, ChildProcess> = new Map()
	private timeouts: Map<string, NodeJS.Timeout> = new Map()
	private sessionMessages: Map<string, ClineMessage[]> = new Map()
	private parsers: Map<string, CliOutputParser> = new Map()
	// Track first api_req_started per session to filter user-input echoes
	private firstApiReqStarted: Map<string, boolean> = new Map()

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
	) {
		this.registry = new AgentRegistry()
	}

	/**
	 * Open or focus the Agent Manager panel
	 */
	public async openPanel(): Promise<void> {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One)
			return
		}

		this.panel = vscode.window.createWebviewPanel(
			AgentManagerProvider.viewType,
			"Agent Manager",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri],
			},
		)

		this.panel.iconPath = {
			light: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "kilo.png"),
			dark: vscode.Uri.joinPath(this.context.extensionUri, "assets", "icons", "kilo-dark.png"),
		}

		this.panel.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(this.panel.webview)
				: this.getHtmlContent(this.panel.webview)

		this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), null, this.disposables)

		this.panel.onDidDispose(
			() => {
				this.panel = undefined
				this.stopAllAgents()
			},
			null,
			this.disposables,
		)

		this.outputChannel.appendLine("Agent Manager panel opened")
	}

	private handleMessage(message: { type: string; [key: string]: unknown }): void {
		this.outputChannel.appendLine(`Agent Manager received message: ${JSON.stringify(message)}`)

		try {
			switch (message.type) {
				case "agentManager.webviewReady":
					this.postStateToWebview()
					break
				case "agentManager.startSession":
					void this.startAgentSession(message.prompt as string)
					break
				case "agentManager.stopSession":
					this.stopAgentSession(message.sessionId as string)
					break
				case "agentManager.removeSession":
					this.removeSession(message.sessionId as string)
					break
				case "agentManager.selectSession":
					this.selectSession(message.sessionId as string | null)
					break
			}
		} catch (error) {
			this.outputChannel.appendLine(`Error handling message: ${error}`)
		}
	}

	/**
	 * Start a new agent session using the kilocode CLI
	 */
	private async startAgentSession(prompt: string): Promise<void> {
		if (!prompt) {
			this.outputChannel.appendLine("ERROR: prompt is empty")
			return
		}

		// Get workspace folder - require a valid workspace
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		if (!workspaceFolder) {
			this.outputChannel.appendLine("ERROR: No workspace folder open")
			void vscode.window.showErrorMessage("Please open a folder before starting an agent.")
			this.postMessage({ type: "agentManager.startSessionFailed" })
			return
		}
		const workspace = workspaceFolder

		const cliPath = await findKilocodeCli((msg) => this.outputChannel.appendLine(`[AgentManager] ${msg}`))
		if (!cliPath) {
			this.outputChannel.appendLine("ERROR: kilocode CLI not found")
			this.showCliNotFoundError()
			this.postMessage({ type: "agentManager.startSessionFailed" })
			return
		}

		// Create the session
		const session = this.registry.createSession(prompt)
		this.sessionMessages.set(session.id, [])
		this.outputChannel.appendLine(`Session created: ${session.id}`)

		// Build CLI command
		const cliArgs = ["--auto", "--json", `--workspace=${workspace}`, prompt]
		this.outputChannel.appendLine(`[AgentManager] Command: ${cliPath} ${cliArgs.join(" ")}`)
		this.outputChannel.appendLine(`[AgentManager] Working dir: ${workspace}`)

		// Spawn CLI process. Avoid shell wrapping so the prompt cannot be interpolated by a shell.
		// Set NO_COLOR and FORCE_COLOR=0 to disable ANSI output.
		const proc = spawn(cliPath, cliArgs, {
			cwd: workspace,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
			shell: false,
		})

		this.processes.set(session.id, proc)
		if (proc.pid) {
			this.registry.setSessionPid(session.id, proc.pid)
			this.outputChannel.appendLine(`[AgentManager] Process PID: ${proc.pid}`)
		} else {
			this.outputChannel.appendLine(`[AgentManager] WARNING: No PID - spawn may have failed`)
		}

		// Debug: Log when stdout/stderr attach
		this.outputChannel.appendLine(`[AgentManager] stdout exists: ${!!proc.stdout}`)
		this.outputChannel.appendLine(`[AgentManager] stderr exists: ${!!proc.stderr}`)

		// Set timeout
		const timeout = setTimeout(() => {
			this.log(session.id, "Timed out. Killing agent.")
			this.registry.updateSessionStatus(session.id, "error", undefined, "Timeout")
			proc.kill("SIGTERM")
			this.postStateToWebview()
		}, SESSION_TIMEOUT_MS)
		this.timeouts.set(session.id, timeout)

		// Create parser for this session
		const parser = new CliOutputParser()
		this.parsers.set(session.id, parser)

		// Parse nd-json output from stdout
		proc.stdout?.on("data", (chunk) => {
			const chunkStr = chunk.toString()
			this.outputChannel.appendLine(
				`[AgentManager] stdout chunk (${chunkStr.length} bytes): ${chunkStr.slice(0, 200)}`,
			)

			const { events } = parser.parse(chunkStr)

			for (const event of events) {
				this.handleCliEvent(session.id, event)
			}

			this.postStateToWebview()
		})

		// Handle stderr
		proc.stderr?.on("data", (data) => {
			const stderrStr = String(data).trim()
			this.outputChannel.appendLine(`[AgentManager] stderr: ${stderrStr}`)
			this.log(session.id, `stderr: ${stderrStr}`)
			this.postStateToWebview()
		})

		// Handle process exit
		proc.on("exit", (code, signal) => {
			this.outputChannel.appendLine(`[AgentManager] Process exited: code=${code}, signal=${signal}`)

			// Flush any buffered parser output to avoid dropping the final message when no newline is sent
			const parser = this.parsers.get(session.id)
			if (parser) {
				const { events } = parser.flush()
				for (const event of events) {
					this.handleCliEvent(session.id, event)
				}
				this.parsers.delete(session.id)
			}

			const t = this.timeouts.get(session.id)
			if (t) clearTimeout(t)
			this.timeouts.delete(session.id)
			this.processes.delete(session.id)

			if (code === 0) {
				this.registry.updateSessionStatus(session.id, "done", code)
				this.log(session.id, "Agent completed")
			} else {
				this.registry.updateSessionStatus(session.id, "error", code ?? undefined)
				this.log(session.id, `Agent exited with code ${code ?? "?"}${signal ? ` signal ${signal}` : ""}`)
			}
			this.postStateToWebview()
		})

		proc.on("error", (error) => {
			this.outputChannel.appendLine(`[AgentManager] Process spawn error: ${error.message}`)
			this.log(session.id, `Process error: ${error.message}`)
			this.registry.updateSessionStatus(session.id, "error", undefined, error.message)
			this.postStateToWebview()
		})

		this.outputChannel.appendLine(`[AgentManager] spawned CLI process ${session.id} pid=${proc.pid}`)
		this.postStateToWebview()
	}

	/**
	 * Handle a JSON event from the CLI stdout
	 */
	private handleCliEvent(sessionId: string, event: StreamEvent): void {
		switch (event.streamEventType) {
			case "kilocode":
				this.handleKilocodeEvent(sessionId, event)
				break
			case "status":
				this.log(sessionId, event.message)
				break
			case "output":
				this.log(sessionId, `[${event.source}] ${event.content}`)
				break
			case "error":
				this.registry.updateSessionStatus(sessionId, "error", undefined, event.error)
				this.log(sessionId, `Error: ${event.error}`)
				if (event.details) {
					this.log(sessionId, `Details: ${JSON.stringify(event.details)}`)
				}
				break
			case "complete":
				this.registry.updateSessionStatus(sessionId, "done", event.exitCode)
				this.log(sessionId, "Agent completed")
				break
			case "interrupted":
				this.registry.updateSessionStatus(sessionId, "stopped", undefined, event.reason)
				this.log(sessionId, event.reason || "Execution interrupted")
				break
		}
	}

	private handleKilocodeEvent(sessionId: string, event: KilocodeStreamEvent): void {
		const payload = event.payload
		const messageType = payload.type === "ask" ? "ask" : payload.type === "say" ? "say" : null
		if (!messageType) {
			// Unknown payloads (e.g., session_created) are logged but not shown as chat
			const evtName = (payload as { event?: string }).event || payload.type || "event"
			this.log(sessionId, `event:${evtName}`)
			return
		}

		// Track first api_req_started to identify user echo
		if (payload.say === "api_req_started") {
			this.firstApiReqStarted.set(sessionId, true)
			// We don't render api_req_started/finished as chat rows
			return
		}
		if (payload.say === "api_req_finished") {
			return
		}
		// Skip echo of initial user prompt (say:text before first api_req_started)
		if (payload.say === "text" && !this.firstApiReqStarted.get(sessionId)) {
			this.log(sessionId, `skipping user input echo: ${(payload.content as string)?.slice(0, 50)}`)
			return
		}

		// Skip empty partial messages
		const rawContent = payload.content || payload.text
		if (payload.partial && !rawContent) {
			return
		}

		const timestamp = (payload.timestamp as number | undefined) ?? (payload as { ts?: number }).ts ?? Date.now()
		const checkpoint = (payload as { checkpoint?: Record<string, unknown> }).checkpoint
		const text = this.deriveMessageText(payload, checkpoint)
		const message: ClineMessage = {
			ts: timestamp,
			type: messageType,
			say: payload.say as ClineMessage["say"],
			ask: payload.ask as ClineMessage["ask"],
			text,
			partial: payload.partial ?? false,
			isAnswered: payload.isAnswered as boolean | undefined,
			metadata: payload.metadata as Record<string, unknown> | undefined,
			checkpoint,
		}

		// If we have a checkpoint, render as a distinct entry by forcing say=checkpoint_saved and clearing ask
		if (checkpoint && payload.say === "checkpoint_saved") {
			message.say = "checkpoint_saved"
			message.ask = undefined
		}

		// If content/text missing for ask messages, synthesize from ask subtype
		if (!message.text && message.type === "ask" && message.ask) {
			if (message.ask === "tool") {
				message.text = this.formatToolAskText(payload.metadata)
			} else {
				message.text = message.ask
			}
		}

		// Drop empty messages (except checkpoints)
		if (!message.text && message.say !== "checkpoint_saved") {
			return
		}

		// Update or append message (dedupe by ts + type + say/ask; final replaces partial)
		const messages = this.sessionMessages.get(sessionId) || []
		const key = this.getMessageKey(message)
		const existingIdx = messages.findIndex((m) => this.getMessageKey(m) === key)
		if (existingIdx >= 0) {
			const existing = messages[existingIdx]
			if (!message.partial || existing.partial) {
				messages[existingIdx] = message
			}
		} else {
			messages.push(message)
		}
		this.sessionMessages.set(sessionId, messages)

		// Send to webview
		this.postMessage({
			type: "agentManager.chatMessages",
			sessionId,
			messages,
		})

		// Log summary
		const summary = `${messageType}:${payload.say || payload.ask || ""}`
		this.log(sessionId, summary)
	}

	private deriveMessageText(payload: KilocodePayload, checkpoint?: Record<string, unknown>): string {
		// Regular content/text first
		if (payload.content) return payload.content as string
		if (payload.text) return payload.text as string

		// Checkpoints: do not render hash as chat text; let UI handle via checkpoint
		if (payload.say === "checkpoint_saved") {
			return ""
		}

		// Tool asks
		if (payload.ask === "tool") {
			return this.formatToolAskText(payload.metadata) || ""
		}

		// Fallback empty
		return ""
	}

	private formatToolAskText(metadata?: Record<string, unknown>): string | undefined {
		if (!metadata) return undefined
		const tool = (metadata as { tool?: string }).tool
		const query = (metadata as { query?: string }).query
		const args = (metadata as { args?: unknown }).args
		if (tool) {
			if (query) return `Tool: ${tool} (${String(query)})`
			if (args) return `Tool: ${tool} (${JSON.stringify(args)})`
			return `Tool: ${tool}`
		}
		return undefined
	}

	private getMessageKey(message: ClineMessage): string {
		return `${message.ts}-${message.type}-${message.say ?? ""}-${message.ask ?? ""}`
	}

	/**
	 * Append a log line to a session
	 */
	private log(sessionId: string, line: string): void {
		this.registry.appendLog(sessionId, line)
	}

	/**
	 * Select a session to view its details/logs
	 */
	private selectSession(sessionId: string | null): void {
		this.registry.selectedId = sessionId
		this.postStateToWebview()
	}

	/**
	 * Stop a running agent session
	 */
	private stopAgentSession(sessionId: string): void {
		const proc = this.processes.get(sessionId)
		if (proc) {
			proc.kill("SIGTERM")
			this.processes.delete(sessionId)
		}

		const timeout = this.timeouts.get(sessionId)
		if (timeout) clearTimeout(timeout)
		this.timeouts.delete(sessionId)

		this.parsers.delete(sessionId)

		this.registry.updateSessionStatus(sessionId, "stopped", undefined, "Stopped by user")
		this.log(sessionId, "Stopped by user")
		this.postStateToWebview()

		this.firstApiReqStarted.delete(sessionId)
	}

	/**
	 * Remove a session
	 */
	private removeSession(sessionId: string): void {
		// Stop process if running
		const proc = this.processes.get(sessionId)
		if (proc) {
			proc.kill("SIGTERM")
			this.processes.delete(sessionId)
		}

		const timeout = this.timeouts.get(sessionId)
		if (timeout) clearTimeout(timeout)
		this.timeouts.delete(sessionId)

		// Clean up messages and parser
		this.sessionMessages.delete(sessionId)
		this.parsers.delete(sessionId)

		this.registry.removeSession(sessionId)
		this.postStateToWebview()

		this.firstApiReqStarted.delete(sessionId)
	}

	private postStateToWebview(): void {
		this.postMessage({
			type: "agentManager.state",
			state: this.registry.getState(),
		})
	}

	private postMessage(message: unknown): void {
		this.panel?.webview.postMessage(message)
	}

	// HMR support for development mode - same approach as ClineProvider (see src/core/webview/ClineProvider.ts)
	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		const viteConfig = await getViteDevServerConfig(webview)

		if (!viteConfig) {
			vscode.window.showErrorMessage(
				"Vite dev server is not running. Please run 'pnpm dev' in webview-ui directory or use 'pnpm build'.",
			)
			return this.getHtmlContent(webview)
		}

		const { localServerUrl, csp, reactRefreshScript } = viteConfig

		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.css",
		])

		const scriptUri = `http://${localServerUrl}/src/kilocode/agent-manager/index.tsx`

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<title>Agent Manager</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefreshScript}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	private getHtmlContent(webview: vscode.Webview): string {
		// Get URIs for the React build assets
		const scriptUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.js",
		])
		const stylesUri = getUri(webview, this.context.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"agent-manager.css",
		])

		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
	<title>Agent Manager</title>
	<link rel="stylesheet" type="text/css" href="${stylesUri}">
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`
	}

	public hasRunningSessions(): boolean {
		return this.registry.hasRunningSessions()
	}

	public getRunningSessionCount(): number {
		return this.registry.getRunningSessionCount()
	}

	private stopAllAgents(): void {
		for (const proc of this.processes.values()) {
			proc.kill("SIGTERM")
		}
		this.processes.clear()

		for (const timeout of this.timeouts.values()) {
			clearTimeout(timeout)
		}
		this.timeouts.clear()

		// Update all running sessions to stopped
		for (const session of this.registry.getSessions()) {
			if (session.status === "running") {
				this.registry.updateSessionStatus(session.id, "stopped", undefined, "Stopped by user")
			}
		}

		this.parsers.clear()
		this.firstApiReqStarted.clear()
	}

	public dispose(): void {
		// Kill all processes
		for (const proc of this.processes.values()) {
			proc.kill("SIGTERM")
		}
		this.processes.clear()

		// Clear all timeouts
		for (const timeout of this.timeouts.values()) {
			clearTimeout(timeout)
		}
		this.timeouts.clear()

		// Clear messages and parsers
		this.sessionMessages.clear()
		this.parsers.clear()
		this.firstApiReqStarted.clear()

		this.panel?.dispose()
		this.disposables.forEach((d) => d.dispose())
	}

	private showCliNotFoundError(): void {
		vscode.window
			.showErrorMessage(
				"Kilocode CLI not found. Please install it to use the Agent Manager.",
				"Install Instructions",
			)
			.then((selection) => {
				if (selection === "Install Instructions") {
					void vscode.env.openExternal(vscode.Uri.parse("https://kilo.ai/docs/cli"))
				}
			})
	}
}
