import * as vscode from 'vscode';
import {
	ServerManager,
	HttpClient,
	SSEClient,
	type ServerConfig,
} from './services/cli-backend';
import { ChatController } from './controllers';

export class KiloProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'kilo-code.new.sidebarView';

	private readonly serverManager: ServerManager;
	private httpClient: HttpClient | null = null;
	private sseClient: SSEClient | null = null;
	private webviewView: vscode.WebviewView | null = null;
	private chatController: ChatController | null = null;

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

		// Initialize connection to CLI backend
		this.initializeConnection(webviewView.webview);
	}

	/**
	 * Initialize connection to the CLI backend server.
	 */
	private async initializeConnection(webview: vscode.Webview): Promise<void> {
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

			// Get workspace directory
			const workspaceDir = this.getWorkspaceDirectory();

			// Create ChatController to handle all message routing
			this.chatController = new ChatController(webview, {
				httpClient: this.httpClient,
				sseClient: this.sseClient,
				workspaceDirectory: workspaceDir,
			});
			console.log('[Kilo New] KiloProvider: 🎮 Created ChatController');

			// Connect SSE with workspace directory
			console.log('[Kilo New] KiloProvider: 📂 Connecting SSE with workspace:', workspaceDir);
			this.sseClient.connect(workspaceDir);

			console.log('[Kilo New] KiloProvider: ✅ initializeConnection completed successfully');
		} catch (error) {
			console.error('[Kilo New] KiloProvider: ❌ Failed to initialize connection:', error);
			this.postMessage({
				type: 'chat/error',
				message: error instanceof Error ? error.message : 'Failed to connect to CLI backend',
				code: 'CONNECTION_ERROR',
			});
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
		this.chatController?.dispose();
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
