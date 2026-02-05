import * as vscode from 'vscode';
import {
	ServerManager,
	HttpClient,
	SSEClient,
	type SessionInfo,
	type SSEEvent,
	type ServerConfig,
} from './services/cli-backend';

export class KiloProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'kilo-code.new.sidebarView';

	private readonly serverManager: ServerManager;
	private httpClient: HttpClient | null = null;
	private sseClient: SSEClient | null = null;
	private webviewView: vscode.WebviewView | null = null;
	private currentSession: SessionInfo | null = null;

	constructor(
		private readonly extensionUri: vscode.Uri,
		context: vscode.ExtensionContext
	) {
		this.serverManager = new ServerManager(context);
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		// Store the webview reference
		this.webviewView = webviewView;

		// Set up webview options
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		// Set HTML content
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'sendMessage':
					await this.handleSendMessage(message.text);
					break;
				case 'abort':
					await this.handleAbort();
					break;
				case 'permissionResponse':
					await this.handlePermissionResponse(
						message.permissionId,
						message.response
					);
					break;
			}
		});

		// Initialize connection to CLI backend
		this.initializeConnection();
	}

	/**
	 * Initialize connection to the CLI backend server.
	 */
	private async initializeConnection(): Promise<void> {
		console.log('[Kilo New] KiloProvider: 🔧 Starting initializeConnection...');
		try {
			// Get server from server manager
			console.log('[Kilo New] KiloProvider: 📡 Requesting server from serverManager...');
			const server = await this.serverManager.getServer();
			console.log('[Kilo New] KiloProvider: ✅ Server obtained:', { port: server.port, hasPassword: !!server.password });

			// Create config with baseUrl and password
			const config: ServerConfig = {
				baseUrl: `http://127.0.0.1:${server.port}`,
				password: server.password,
			};
			console.log('[Kilo New] KiloProvider: 🔑 Created config:', { baseUrl: config.baseUrl });

			// Create HttpClient and SSEClient instances
			this.httpClient = new HttpClient(config);
			this.sseClient = new SSEClient(config);
			console.log('[Kilo New] KiloProvider: 🔌 Created HttpClient and SSEClient');

			// Set up SSE event handling
			this.sseClient.onEvent((event) => {
				console.log('[Kilo New] KiloProvider: 📨 Received SSE event:', event.type);
				this.handleSSEEvent(event);
			});

			this.sseClient.onStateChange((state) => {
				console.log('[Kilo New] KiloProvider: 🔄 SSE state changed to:', state);
				console.log('[Kilo New] KiloProvider: 📤 Posting connectionState message to webview:', state);
				this.postMessage({
					type: 'connectionState',
					state,
				});
			});

			// Connect SSE with workspace directory
			const workspaceDir = this.getWorkspaceDirectory();
			console.log('[Kilo New] KiloProvider: 📂 Connecting SSE with workspace:', workspaceDir);
			this.sseClient.connect(workspaceDir);

			// Post "ready" message to webview with server info
			console.log('[Kilo New] KiloProvider: 📤 Posting ready message to webview');
			this.postMessage({
				type: 'ready',
				serverInfo: {
					port: server.port,
				},
			});
			console.log('[Kilo New] KiloProvider: ✅ initializeConnection completed successfully');
		} catch (error) {
			console.error('[Kilo New] KiloProvider: ❌ Failed to initialize connection:', error);
			this.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : 'Failed to connect to CLI backend',
			});
		}
	}

	/**
	 * Handle sending a message from the webview.
	 */
	private async handleSendMessage(text: string): Promise<void> {
		if (!this.httpClient) {
			this.postMessage({
				type: 'error',
				message: 'Not connected to CLI backend',
			});
			return;
		}

		try {
			const workspaceDir = this.getWorkspaceDirectory();

			// Create session if needed
			if (!this.currentSession) {
				this.currentSession = await this.httpClient.createSession(workspaceDir);
			}

			// Send message with text part
			await this.httpClient.sendMessage(
				this.currentSession.id,
				[{ type: 'text', text }],
				workspaceDir
			);
		} catch (error) {
			console.error('[Kilo New] KiloProvider: Failed to send message:', error);
			this.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : 'Failed to send message',
			});
		}
	}

	/**
	 * Handle abort request from the webview.
	 */
	private async handleAbort(): Promise<void> {
		if (!this.httpClient || !this.currentSession) {
			return;
		}

		try {
			const workspaceDir = this.getWorkspaceDirectory();
			await this.httpClient.abortSession(this.currentSession.id, workspaceDir);
		} catch (error) {
			console.error('[Kilo New] KiloProvider: Failed to abort session:', error);
		}
	}

	/**
	 * Handle permission response from the webview.
	 */
	private async handlePermissionResponse(
		permissionId: string,
		response: 'once' | 'always' | 'reject'
	): Promise<void> {
		if (!this.httpClient || !this.currentSession) {
			return;
		}

		try {
			const workspaceDir = this.getWorkspaceDirectory();
			await this.httpClient.respondToPermission(
				this.currentSession.id,
				permissionId,
				response,
				workspaceDir
			);
		} catch (error) {
			console.error('[Kilo New] KiloProvider: Failed to respond to permission:', error);
		}
	}

	/**
	 * Handle SSE events from the CLI backend.
	 */
	private handleSSEEvent(event: SSEEvent): void {
		// Filter events by sessionID (only process events for current session)
		if ('sessionID' in event.properties) {
			if (this.currentSession && event.properties.sessionID !== this.currentSession.id) {
				return;
			}
		}

		// Forward relevant events to webview
		switch (event.type) {
			case 'message.part.updated':
				this.postMessage({
					type: 'partUpdated',
					part: event.properties.part,
					delta: event.properties.delta,
				});
				break;

			case 'session.status':
				this.postMessage({
					type: 'sessionStatus',
					sessionID: event.properties.sessionID,
					status: event.properties.status,
				});
				break;

			case 'permission.asked':
				this.postMessage({
					type: 'permissionRequest',
					...event.properties,
				});
				break;

			case 'todo.updated':
				this.postMessage({
					type: 'todoUpdated',
					sessionID: event.properties.sessionID,
					items: event.properties.items,
				});
				break;

			case 'session.created':
				// Store session if we don't have one yet
				if (!this.currentSession) {
					this.currentSession = event.properties.info;
				}
				break;
		}
	}

	/**
	 * Post a message to the webview.
	 * Public so toolbar button commands can send messages.
	 */
	public postMessage(message: unknown): void {
		this.webviewView?.webview.postMessage(message);
	}

	/**
	 * Get the workspace directory.
	 */
	private getWorkspaceDirectory(): string {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			return workspaceFolders[0].uri.fsPath;
		}
		return process.cwd();
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
		);

		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Kilo Code</title>
	<style>
		body {
			padding: 10px;
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
		}
		h1 {
			font-size: 1.5em;
			margin: 0;
		}
		.container {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 100px;
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	/**
	 * Dispose of the provider and clean up resources.
	 */
	dispose(): void {
		this.sseClient?.dispose();
		this.serverManager.dispose();
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
