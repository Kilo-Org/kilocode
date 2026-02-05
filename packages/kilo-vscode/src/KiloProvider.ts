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
	private webviewMessageDisposable: vscode.Disposable | null = null;
	private pendingWebviewMessages: unknown[] = [];

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
		console.log('[Kilo New] KiloProvider: resolveWebviewView called');
		console.log('[Kilo New] KiloProvider: Creating webview view:', {
			viewType: KiloProvider.viewType,
			hasWebview: !!webviewView.webview,
		});

		// Store the webview reference
		this.webviewView = webviewView;

		// IMPORTANT: attach the message listener immediately.
		// The webview can start posting messages (chat/init, chat/loadSession) before
		// the CLI backend is ready and before ChatController is created.
		// If we only register onDidReceiveMessage inside ChatController, those early
		// messages are dropped and the webview waits forever ("Loading session...").
		this.webviewMessageDisposable?.dispose();
		this.webviewMessageDisposable = webviewView.webview.onDidReceiveMessage((message) => {
			void this.routeWebviewMessage(message);
		});
		console.log('[Kilo New] KiloProvider: webview.onDidReceiveMessage listener attached');

		// Set up webview options
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		// Set HTML content
		console.log('[Kilo New] KiloProvider: Setting webview HTML');
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Initialize connection to CLI backend
		console.log('[Kilo New] KiloProvider: Initializing ChatController + backend connection');
		this.initializeConnection(webviewView.webview);
	}

	private async routeWebviewMessage(message: unknown): Promise<void> {
		if (this.chatController) {
			await this.chatController.receiveMessage(message);
			return;
		}

		// Buffer until ChatController exists. Keep buffer bounded.
		this.pendingWebviewMessages.push(message);
		if (this.pendingWebviewMessages.length > 50) {
			this.pendingWebviewMessages.shift();
		}
		console.log('[Kilo New] KiloProvider: Buffered webview message (controller not ready yet)', {
			bufferSize: this.pendingWebviewMessages.length,
		});
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
			console.log('[Kilo New] KiloProvider: Workspace directory:', workspaceDir);

			// Create ChatController to handle all message routing
			this.chatController = new ChatController(webview, {
				httpClient: this.httpClient,
				sseClient: this.sseClient,
				workspaceDirectory: workspaceDir,
			});
			console.log('[Kilo New] KiloProvider: 🎮 Created ChatController');

			// Flush any messages that arrived before the controller was ready.
			if (this.pendingWebviewMessages.length > 0) {
				console.log('[Kilo New] KiloProvider: Flushing buffered webview messages', {
					count: this.pendingWebviewMessages.length,
				});
				const toFlush = [...this.pendingWebviewMessages];
				this.pendingWebviewMessages = [];
				for (const msg of toFlush) {
					await this.chatController.receiveMessage(msg);
				}
			}

			// Connect SSE with workspace directory
			console.log('[Kilo New] KiloProvider: 📂 Connecting SSE with workspace:', workspaceDir);
			this.sseClient.connect(workspaceDir);

			console.log('[Kilo New] KiloProvider: ✅ initializeConnection completed successfully');
		} catch (error) {
			console.error('[Kilo New] KiloProvider: ❌ Failed to initialize connection:', error);
			// Best-effort: clear the buffer so we don't replay stale messages later.
			this.pendingWebviewMessages = [];
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
		this.webviewMessageDisposable?.dispose();
		this.webviewMessageDisposable = null;
		this.pendingWebviewMessages = [];
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
