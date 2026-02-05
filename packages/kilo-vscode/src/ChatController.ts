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
import type {
	HttpClient,
	SSEClient,
	SSEEvent,
	SessionInfo as BackendSessionInfo,
	MessagePart as BackendMessagePart,
} from './services/cli-backend';

export interface ChatControllerOptions {
	extensionUri: vscode.Uri;
	workspaceFolder?: string;
}

export class ChatController implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private webview: vscode.Webview | undefined;
	private sessions: Map<string, SessionInfo> = new Map();
	private messages: Map<string, ChatMessage[]> = new Map();
	private currentSessionId: string | null = null;
	private messageCounter = 0;
	private partCounter = 0;
	
	// Backend clients (injected from KiloProvider)
	private httpClient: HttpClient | null = null;
	private sseClient: SSEClient | null = null;
	private sseUnsubscribe: (() => void) | null = null;
	
	// Workspace configuration
	private workspaceFolder: string;

	constructor(private options: ChatControllerOptions) {
		this.workspaceFolder = options.workspaceFolder || 
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 
			'';
	}

	/**
	 * Set the backend clients for API communication
	 */
	public setBackendClients(httpClient: HttpClient, sseClient: SSEClient): void {
		this.httpClient = httpClient;
		this.sseClient = sseClient;
		
		// Subscribe to SSE events
		this.sseUnsubscribe = this.sseClient.onEvent((event) => {
			this.handleSSEEvent(event);
		});
		
		console.log('[Kilo New] ChatController: Backend clients configured');
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
		const workspaceFolder = message.workspaceFolder || this.workspaceFolder;
		this.workspaceFolder = workspaceFolder;
		
		// Build configuration
		const config: ChatConfig = {
			serverUrl: this.httpClient ? 'connected' : 'disconnected',
			workspaceFolder,
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

		// Load sessions from backend if connected
		let sessions: SessionInfo[] = [];
		if (this.httpClient) {
			try {
				const backendSessions = await this.httpClient.listSessions(workspaceFolder);
				sessions = backendSessions.map(s => this.convertBackendSession(s));
				// Cache sessions locally
				for (const session of sessions) {
					this.sessions.set(session.id, session);
				}
			} catch (error) {
				console.error('[Kilo New] ChatController: Failed to load sessions:', error);
			}
		} else {
			sessions = Array.from(this.sessions.values());
		}

		this.postMessage({
			type: 'chat/initialized',
			requestId: message.requestId,
			config,
			sessions,
			session: sessions[0],
		});
	}

	private async handleLoadSession(message: WebviewToExtensionMessage & { type: 'chat/loadSession' }): Promise<void> {
		const { sessionId } = message;
		
		// Try to load from backend first
		if (this.httpClient) {
			try {
				const backendSession = await this.httpClient.getSession(sessionId, this.workspaceFolder);
				const session = this.convertBackendSession(backendSession);
				this.sessions.set(sessionId, session);
				this.currentSessionId = sessionId;
				
				// Load messages from backend
				const backendMessages = await this.httpClient.getMessages(sessionId, this.workspaceFolder);
				const messages = backendMessages.map(m => this.convertBackendMessage(m, sessionId));
				this.messages.set(sessionId, messages);
				
				this.postMessage({
					type: 'chat/sessionLoaded',
					requestId: message.requestId,
					session,
					messages,
				});
				return;
			} catch (error) {
				console.error('[Kilo New] ChatController: Failed to load session from backend:', error);
			}
		}
		
		// Fall back to local cache
		const session = this.sessions.get(sessionId);
		if (!session) {
			this.postMessage({
				type: 'chat/error',
				requestId: message.requestId,
				error: `Session not found: ${sessionId}`,
			});
			return;
		}

		const messages = this.messages.get(sessionId) || [];
		this.currentSessionId = sessionId;

		this.postMessage({
			type: 'chat/sessionLoaded',
			requestId: message.requestId,
			session,
			messages,
		});
	}

	private async handleCreateSession(message: WebviewToExtensionMessage & { type: 'chat/createSession' }): Promise<void> {
		// Create session via backend if connected
		if (this.httpClient) {
			try {
				const backendSession = await this.httpClient.createSession(this.workspaceFolder);
				const session = this.convertBackendSession(backendSession);
				this.sessions.set(session.id, session);
				this.messages.set(session.id, []);
				this.currentSessionId = session.id;
				
				this.postMessage({
					type: 'chat/sessionCreated',
					requestId: message.requestId,
					session,
				});
				return;
			} catch (error) {
				console.error('[Kilo New] ChatController: Failed to create session:', error);
				this.postMessage({
					type: 'chat/error',
					requestId: message.requestId,
					error: error instanceof Error ? error.message : 'Failed to create session',
				});
				return;
			}
		}
		
		// Fall back to local session creation (for testing without backend)
		const sessionId = `local_session_${Date.now()}`;
		const session: SessionInfo = {
			id: sessionId,
			time: {
				created: Date.now(),
			},
		};

		this.sessions.set(sessionId, session);
		this.messages.set(sessionId, []);
		this.currentSessionId = sessionId;

		this.postMessage({
			type: 'chat/sessionCreated',
			requestId: message.requestId,
			session,
		});
	}

	private async handleSendPrompt(message: WebviewToExtensionMessage & { type: 'chat/sendPrompt' }): Promise<void> {
		let { sessionId } = message;
		const { text, agent, model } = message;

		// If the webview sent a local placeholder session id, we need to create a real backend session first
		if (sessionId.startsWith('local_session_') && this.httpClient) {
			console.log('[Kilo New] ChatController: Detected local session id, creating backend session first');
			try {
				const backendSession = await this.httpClient.createSession(this.workspaceFolder);
				const newSession = this.convertBackendSession(backendSession);
				
				// Migrate local session data to the new backend session
				const localMessages = this.messages.get(sessionId) || [];
				this.sessions.delete(sessionId);
				this.messages.delete(sessionId);
				
				this.sessions.set(newSession.id, newSession);
				this.messages.set(newSession.id, localMessages);
				
				// Update sessionId to use the real backend id
				sessionId = newSession.id;
				
				// Notify webview of the session id change
				this.postMessage({
					type: 'chat/sessionCreated',
					requestId: message.requestId,
					session: newSession,
				});
				
				console.log('[Kilo New] ChatController: Migrated local session to backend session:', sessionId);
			} catch (error) {
				console.error('[Kilo New] ChatController: Failed to create backend session:', error);
				this.postMessage({
					type: 'chat/requestState',
					sessionId,
					state: 'error',
					error: error instanceof Error ? error.message : 'Failed to create backend session',
				});
				return;
			}
		}

		this.currentSessionId = sessionId;

		// Notify that request has started
		this.postMessage({
			type: 'chat/requestState',
			sessionId,
			state: 'started',
		});

		// Create user message locally for immediate display
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

		// Send to backend if connected
		if (this.httpClient) {
			try {
				// Send message to backend - response will come via SSE events
				await this.httpClient.sendMessage(
					sessionId,
					[{ type: 'text', text }],
					this.workspaceFolder
				);
				// Note: The assistant response will be streamed via SSE events
				// which are handled in handleSSEEvent()
			} catch (error) {
				console.error('[Kilo New] ChatController: Failed to send message:', error);
				this.postMessage({
					type: 'chat/requestState',
					sessionId,
					state: 'error',
					error: error instanceof Error ? error.message : 'Failed to send message',
				});
			}
		} else {
			// No backend connected - send error
			this.postMessage({
				type: 'chat/requestState',
				sessionId,
				state: 'error',
				error: 'Backend not connected. Please ensure the OpenCode server is running.',
			});
		}
	}

	/**
	 * Handle SSE events from the backend
	 */
	private handleSSEEvent(event: SSEEvent): void {
		console.log('[Kilo New] ChatController: 📥 SSE event received:', event.type);
		
		// Only process events for the current session
		if ('sessionID' in event.properties) {
			const eventSessionId = event.properties.sessionID;
			if (this.currentSessionId && eventSessionId !== this.currentSessionId) {
				console.log('[Kilo New] ChatController: ⏭️ Skipping event for different session:', eventSessionId, 'current:', this.currentSessionId);
				return;
			}
		}

		switch (event.type) {
			case 'message.updated': {
				// A new message was created or updated
				const { info } = event.properties;
				console.log('[Kilo New] ChatController: 📝 message.updated - role:', info.role, 'id:', info.id, 'sessionID:', info.sessionID);
				
				if (info.role === 'assistant') {
					// Create or update assistant message
					const existingMessages = this.messages.get(info.sessionID) || [];
					const existingIndex = existingMessages.findIndex(m => m.id === info.id);
					
					if (existingIndex === -1) {
						// New assistant message
						console.log('[Kilo New] ChatController: ✨ Creating new assistant message:', info.id);
						const assistantMessage: ChatMessage = {
							id: info.id,
							sessionId: info.sessionID,
							role: 'assistant',
							time: { created: info.time.created },
							parts: [],
						};
						existingMessages.push(assistantMessage);
						this.messages.set(info.sessionID, existingMessages);
						
						console.log('[Kilo New] ChatController: 📤 Posting chat/messageAppended to webview');
						this.postMessage({
							type: 'chat/messageAppended',
							sessionId: info.sessionID,
							message: assistantMessage,
						});
					} else {
						console.log('[Kilo New] ChatController: 🔄 Assistant message already exists:', info.id);
					}
				}
				break;
			}

			case 'message.part.updated': {
				// A message part was updated (streaming content)
				// Note: messageID can be at event.properties.messageID OR event.properties.part.messageID
				// depending on the backend version
				const { part, delta } = event.properties;
				const messageID = event.properties.messageID || (part as { messageID?: string }).messageID;
				console.log('[Kilo New] ChatController: 📝 message.part.updated - messageID:', messageID, 'partId:', part.id, 'type:', part.type, 'delta length:', delta?.length);
				
				if (!messageID) {
					console.warn('[Kilo New] ChatController: ⚠️ No messageID found in event.properties or part:', JSON.stringify(event.properties));
					break;
				}
				
				const convertedPart = this.convertBackendPart(part);
				
				// Find the message this part belongs to using messageID from the event
				const sessionMessages = this.messages.get(this.currentSessionId || '') || [];
				const message = sessionMessages.find(m => m.id === messageID);
				
				if (!message) {
					console.warn('[Kilo New] ChatController: ⚠️ No message found for messageID:', messageID, 'available messages:', sessionMessages.map(m => m.id));
					// The message might not have been created yet - store the part for later
					// For now, try to find any assistant message as fallback
					const fallbackMessage = sessionMessages.find(m => m.role === 'assistant');
					if (fallbackMessage) {
						console.log('[Kilo New] ChatController: 🔄 Using fallback assistant message:', fallbackMessage.id);
						this.updateMessagePart(fallbackMessage, convertedPart, part, messageID, delta);
					}
					break;
				}
				
				console.log('[Kilo New] ChatController: ✅ Found message for part:', message.id);
				this.updateMessagePart(message, convertedPart, part, messageID, delta);
				break;
			}

			case 'session.status': {
				const { sessionID, status } = event.properties;
				console.log('[Kilo New] ChatController: 📊 session.status -', status.type, 'for session:', sessionID);
				
				if (status.type === 'idle') {
					// Session is idle - request finished
					console.log('[Kilo New] ChatController: 📤 Posting chat/requestState (finished) to webview');
					this.postMessage({
						type: 'chat/requestState',
						sessionId: sessionID,
						state: 'finished',
					});
				} else if (status.type === 'busy') {
					// Session is busy - streaming
					console.log('[Kilo New] ChatController: 📤 Posting chat/requestState (streaming) to webview');
					this.postMessage({
						type: 'chat/requestState',
						sessionId: sessionID,
						state: 'streaming',
					});
				}
				break;
			}

			case 'session.idle': {
				const { sessionID } = event.properties;
				console.log('[Kilo New] ChatController: 📊 session.idle for session:', sessionID);
				console.log('[Kilo New] ChatController: 📤 Posting chat/requestState (finished) to webview');
				this.postMessage({
					type: 'chat/requestState',
					sessionId: sessionID,
					state: 'finished',
				});
				break;
			}

			case 'session.updated': {
				// Session info was updated (e.g., title changed)
				const { info } = event.properties;
				console.log('[Kilo New] ChatController: 📝 session.updated - id:', info.id, 'title:', info.title);
				const session = this.convertBackendSession(info);
				this.sessions.set(session.id, session);
				break;
			}
			
			default:
				console.log('[Kilo New] ChatController: ❓ Unhandled SSE event type:', event.type);
		}
	}

	/**
	 * Update a message part and post the appropriate message to the webview
	 */
	private updateMessagePart(
		message: ChatMessage,
		convertedPart: MessagePart,
		backendPart: { id: string; type: string },
		messageID: string,
		delta?: string
	): void {
		// Update or add the part
		const existingPartIndex = message.parts?.findIndex(p => p.id === backendPart.id) ?? -1;
		if (existingPartIndex >= 0 && message.parts) {
			message.parts[existingPartIndex] = convertedPart;
		} else {
			message.parts = message.parts || [];
			message.parts.push(convertedPart);
		}
		
		// Send delta for streaming text
		if (delta && backendPart.type === 'text') {
			console.log('[Kilo New] ChatController: 📤 Posting chat/messageDelta to webview - messageId:', messageID, 'partId:', backendPart.id);
			this.postMessage({
				type: 'chat/messageDelta',
				sessionId: this.currentSessionId || '',
				messageId: messageID,
				partId: backendPart.id,
				delta,
				part: convertedPart,
			});
		} else {
			// Send full part update for non-text parts
			console.log('[Kilo New] ChatController: 📤 Posting chat/partUpdated to webview - messageId:', messageID, 'partId:', backendPart.id);
			this.postMessage({
				type: 'chat/partUpdated',
				sessionId: this.currentSessionId || '',
				messageId: messageID,
				part: convertedPart,
			});
		}
	}

	private async handleAbort(message: WebviewToExtensionMessage & { type: 'chat/abort' }): Promise<void> {
		const { sessionId } = message;
		
		if (this.httpClient) {
			try {
				await this.httpClient.abortSession(sessionId, this.workspaceFolder);
				this.postMessage({
					type: 'chat/requestState',
					sessionId,
					state: 'aborted',
				});
			} catch (error) {
				console.error('[Kilo New] ChatController: Failed to abort:', error);
				this.postMessage({
					type: 'chat/requestState',
					sessionId,
					state: 'error',
					error: error instanceof Error ? error.message : 'Failed to abort',
				});
			}
		} else {
			this.postMessage({
				type: 'chat/requestState',
				sessionId,
				state: 'aborted',
			});
		}
	}

	private async handleListSessions(message: WebviewToExtensionMessage & { type: 'chat/listSessions' }): Promise<void> {
		let sessions: SessionInfo[] = [];
		
		if (this.httpClient) {
			try {
				const backendSessions = await this.httpClient.listSessions(this.workspaceFolder);
				sessions = backendSessions.map(s => this.convertBackendSession(s));
				// Update local cache
				for (const session of sessions) {
					this.sessions.set(session.id, session);
				}
			} catch (error) {
				console.error('[Kilo New] ChatController: Failed to list sessions:', error);
				sessions = Array.from(this.sessions.values());
			}
		} else {
			sessions = Array.from(this.sessions.values());
		}
		
		sessions.sort((a, b) => (b.time.updated || b.time.created) - (a.time.updated || a.time.created));

		this.postMessage({
			type: 'chat/sessionsListed',
			requestId: message.requestId,
			sessions,
		});
	}

	/**
	 * Convert backend session to protocol session
	 */
	private convertBackendSession(backend: BackendSessionInfo): SessionInfo {
		return {
			id: backend.id,
			title: backend.title || undefined,
			parentId: backend.parentID,
			time: {
				created: backend.time.created,
				updated: backend.time.updated,
			},
		};
	}

	/**
	 * Convert backend message to protocol message
	 */
	private convertBackendMessage(
		backend: { info: { id: string; sessionID: string; role: 'user' | 'assistant'; time: { created: number; completed?: number } }; parts: BackendMessagePart[] },
		sessionId: string
	): ChatMessage {
		return {
			id: backend.info.id,
			sessionId,
			role: backend.info.role,
			time: { created: backend.info.time.created },
			parts: backend.parts.map(p => this.convertBackendPart(p)),
		};
	}

	/**
	 * Convert backend message part to protocol message part
	 */
	private convertBackendPart(backend: BackendMessagePart): MessagePart {
		const base = {
			id: backend.id,
			messageId: '', // Will be set by caller if needed
		};

		switch (backend.type) {
			case 'text':
				return {
					...base,
					type: 'text',
					content: backend.text,
				};
			case 'tool':
				return {
					...base,
					type: 'tool-invocation',
					tool: {
						name: backend.tool,
						input: backend.state.input,
						output: backend.state.status === 'completed' ? backend.state.output : undefined,
					},
				};
			case 'reasoning':
				return {
					...base,
					type: 'text',
					content: backend.text,
				};
			default:
				return {
					...base,
					type: 'text',
					content: '',
				};
		}
	}

	public dispose(): void {
		if (this.sseUnsubscribe) {
			this.sseUnsubscribe();
			this.sseUnsubscribe = null;
		}
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}
