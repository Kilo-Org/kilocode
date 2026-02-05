/**
 * ChatController
 * 
 * Handles chat-related messages from the webview and bridges to the OpenCode backend.
 * This is the extension-host side counterpart to the webview transport.
 */

import * as vscode from 'vscode';
import type {
	WebviewToExtensionMessage,
	ExtensionToWebviewMessage,
	ChatConfig,
	SessionInfo,
	ChatMessage,
	MessagePart,
} from './shared/protocol';

export interface ChatControllerOptions {
	extensionUri: vscode.Uri;
	workspaceFolder?: string;
}

export class ChatController implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private webview: vscode.Webview | undefined;
	private sessions: Map<string, SessionInfo> = new Map();
	private messages: Map<string, ChatMessage[]> = new Map();
	private sessionCounter = 0;
	private messageCounter = 0;
	private partCounter = 0;
	
	// Backend configuration
	private serverUrl = 'http://localhost:8741';
	private workspaceFolder: string;

	constructor(private options: ChatControllerOptions) {
		this.workspaceFolder = options.workspaceFolder || 
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 
			'';
	}

	/**
	 * Set the webview to send messages to
	 */
	public setWebview(webview: vscode.Webview): void {
		this.webview = webview;
	}

	/**
	 * Handle a message from the webview
	 */
	public async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
		console.log('[Kilo New] ChatController received message:', message.type);

		switch (message.type) {
			case 'chat/init':
				await this.handleInit(message);
				break;
			case 'chat/loadSession':
				await this.handleLoadSession(message);
				break;
			case 'chat/createSession':
				await this.handleCreateSession(message);
				break;
			case 'chat/sendPrompt':
				await this.handleSendPrompt(message);
				break;
			case 'chat/abort':
				await this.handleAbort(message);
				break;
			case 'chat/listSessions':
				await this.handleListSessions(message);
				break;
			default:
				console.log('[Kilo New] Unhandled message type:', message.type);
		}
	}

	private postMessage(message: ExtensionToWebviewMessage): void {
		if (!this.webview) {
			console.warn('[Kilo New] No webview to post message to');
			return;
		}
		this.webview.postMessage(message);
	}

	private async handleInit(message: WebviewToExtensionMessage & { type: 'chat/init' }): Promise<void> {
		// TODO: Connect to actual OpenCode backend
		// For now, return a mock configuration
		
		const config: ChatConfig = {
			serverUrl: this.serverUrl,
			workspaceFolder: message.workspaceFolder || this.workspaceFolder,
			agents: [
				{ name: 'code', description: 'General coding assistant' },
				{ name: 'architect', description: 'System design and architecture' },
			],
			providers: [
				{
					id: 'anthropic',
					name: 'Anthropic',
					models: [
						{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
						{ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
					],
				},
			],
		};

		// Get existing sessions or create empty list
		const sessions = Array.from(this.sessions.values());

		this.postMessage({
			type: 'chat/initialized',
			requestId: message.requestId,
			config,
			sessions,
			session: sessions[0],
		});
	}

	private async handleLoadSession(message: WebviewToExtensionMessage & { type: 'chat/loadSession' }): Promise<void> {
		const session = this.sessions.get(message.sessionId);
		
		if (!session) {
			this.postMessage({
				type: 'chat/error',
				requestId: message.requestId,
				error: `Session not found: ${message.sessionId}`,
			});
			return;
		}

		const messages = this.messages.get(message.sessionId) || [];

		this.postMessage({
			type: 'chat/sessionLoaded',
			requestId: message.requestId,
			session,
			messages,
		});
	}

	private async handleCreateSession(message: WebviewToExtensionMessage & { type: 'chat/createSession' }): Promise<void> {
		const sessionId = `session_${++this.sessionCounter}_${Date.now()}`;
		
		const session: SessionInfo = {
			id: sessionId,
			time: {
				created: Date.now(),
			},
		};

		this.sessions.set(sessionId, session);
		this.messages.set(sessionId, []);

		this.postMessage({
			type: 'chat/sessionCreated',
			requestId: message.requestId,
			session,
		});
	}

	private async handleSendPrompt(message: WebviewToExtensionMessage & { type: 'chat/sendPrompt' }): Promise<void> {
		const { sessionId, text, agent, model } = message;

		// Notify that request has started
		this.postMessage({
			type: 'chat/requestState',
			sessionId,
			state: 'started',
		});

		// Create user message
		const userMessageId = `msg_${++this.messageCounter}_${Date.now()}`;
		const userMessage: ChatMessage = {
			id: userMessageId,
			sessionId,
			role: 'user',
			time: { created: Date.now() },
			agent,
			model,
			parts: [{
				id: `part_${++this.partCounter}_${Date.now()}`,
				messageId: userMessageId,
				type: 'text',
				content: text,
			}],
		};

		// Store and broadcast user message
		const sessionMessages = this.messages.get(sessionId) || [];
		sessionMessages.push(userMessage);
		this.messages.set(sessionId, sessionMessages);

		this.postMessage({
			type: 'chat/messageAppended',
			sessionId,
			message: userMessage,
		});

		// TODO: Send to actual OpenCode backend
		// For now, simulate a response
		await this.simulateAssistantResponse(sessionId, text, agent, model);
	}

	private async simulateAssistantResponse(
		sessionId: string,
		userText: string,
		agent?: string,
		model?: { providerId: string; modelId: string }
	): Promise<void> {
		// Create assistant message
		const assistantMessageId = `msg_${++this.messageCounter}_${Date.now()}`;
		const partId = `part_${++this.partCounter}_${Date.now()}`;
		
		const assistantMessage: ChatMessage = {
			id: assistantMessageId,
			sessionId,
			role: 'assistant',
			time: { created: Date.now() },
			agent,
			model,
			parts: [{
				id: partId,
				messageId: assistantMessageId,
				type: 'text',
				content: '',
			}],
		};

		// Store and broadcast assistant message
		const sessionMessages = this.messages.get(sessionId) || [];
		sessionMessages.push(assistantMessage);
		this.messages.set(sessionId, sessionMessages);

		this.postMessage({
			type: 'chat/messageAppended',
			sessionId,
			message: assistantMessage,
		});

		// Simulate streaming response
		const responseText = `I received your message: "${userText}"\n\nThis is a simulated response. The chat UI is working! 🎉\n\nTo connect this to a real backend, the ChatController needs to be updated to communicate with the OpenCode server at ${this.serverUrl}.`;
		
		const words = responseText.split(' ');
		let content = '';

		for (let i = 0; i < words.length; i++) {
			await new Promise(resolve => setTimeout(resolve, 50));
			
			const delta = (i > 0 ? ' ' : '') + words[i];
			content += delta;

			this.postMessage({
				type: 'chat/messageDelta',
				sessionId,
				messageId: assistantMessageId,
				partId,
				delta,
				part: {
					id: partId,
					messageId: assistantMessageId,
					type: 'text',
					content,
				},
			});
		}

		// Update session title from first user message
		const session = this.sessions.get(sessionId);
		if (session && !session.title) {
			session.title = userText.slice(0, 50) + (userText.length > 50 ? '...' : '');
			session.time.updated = Date.now();
			this.sessions.set(sessionId, session);
		}

		// Notify completion
		this.postMessage({
			type: 'chat/requestState',
			sessionId,
			state: 'finished',
		});
	}

	private async handleAbort(message: WebviewToExtensionMessage & { type: 'chat/abort' }): Promise<void> {
		// TODO: Implement actual abort logic with backend
		this.postMessage({
			type: 'chat/requestState',
			sessionId: message.sessionId,
			state: 'aborted',
		});
	}

	private async handleListSessions(message: WebviewToExtensionMessage & { type: 'chat/listSessions' }): Promise<void> {
		const sessions = Array.from(this.sessions.values())
			.sort((a, b) => (b.time.updated || b.time.created) - (a.time.updated || a.time.created));

		this.postMessage({
			type: 'chat/sessionsListed',
			requestId: message.requestId,
			sessions,
		});
	}

	public dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}
