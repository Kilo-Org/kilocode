/**
 * ChatController
 *
 * Extension-host controller that bridges the webview to the CLI backend.
 * Handles incoming messages from the webview, routes them to the backend,
 * and streams responses back to the webview.
 */

import * as vscode from "vscode";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  ChatInitMessage,
  ChatLoadSessionMessage,
  ChatSendPromptMessage,
  ChatAbortMessage,
  ChatSetModelMessage,
  ChatPermissionReplyMessage,
  ChatListSessionsMessage,
  ChatCreateSessionMessage,
  ChatMessage,
  ViewContext,
} from "../shared/chat-protocol";
import { isWebviewMessage } from "../shared/chat-protocol";
import type { HttpClient } from "../services/cli-backend/http-client";
import type { SSEClient } from "../services/cli-backend/sse-client";
import type { SSEEvent, SessionInfo, MessagePart } from "../services/cli-backend/types";

/**
 * Configuration for the ChatController
 */
export interface ChatControllerConfig {
  httpClient: HttpClient
  sseClient: SSEClient
  workspaceDirectory: string
}

/**
 * ChatController manages the communication between the webview and CLI backend.
 */
export class ChatController implements vscode.Disposable {
  private readonly webview: vscode.Webview;
  private readonly httpClient: HttpClient;
  private readonly sseClient: SSEClient;
  private readonly workspaceDirectory: string;
  private readonly disposables: vscode.Disposable[] = [];

  // Session state
  private currentSessionId: string | null = null;
  private currentRequestId: string | null = null;
  private viewContext: ViewContext | null = null;

  // Track active requests for abort handling
  private activeRequests = new Map<string, { sessionId: string; aborted: boolean }>();

  constructor(webview: vscode.Webview, config: ChatControllerConfig) {
    this.webview = webview;
    this.httpClient = config.httpClient;
    this.sseClient = config.sseClient;
    this.workspaceDirectory = config.workspaceDirectory;

    // Set up message handler
    this.disposables.push(
      webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message))
    );

    // Set up SSE event handler
    const unsubscribeSSE = this.sseClient.onEvent((event) => this.handleSSEEvent(event));
    this.disposables.push({ dispose: unsubscribeSSE });

    // Set up SSE error handler
    const unsubscribeError = this.sseClient.onError((error) => this.handleSSEError(error));
    this.disposables.push({ dispose: unsubscribeError });

    console.log("[Kilo New] ChatController: Initialized");
  }

  /**
   * Handle incoming messages from the webview
   */
  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isWebviewMessage(message)) {
      console.warn("[Kilo New] ChatController: Received unknown message:", message);
      return;
    }

    console.log("[Kilo New] ChatController: Received message:", message.type);

    switch (message.type) {
      case "chat/init":
        await this.handleInit(message);
        break;
      case "chat/loadSession":
        await this.handleLoadSession(message);
        break;
      case "chat/sendPrompt":
        await this.handleSendPrompt(message);
        break;
      case "chat/abort":
        await this.handleAbort(message);
        break;
      case "chat/setModel":
        await this.handleSetModel(message);
        break;
      case "chat/permissionReply":
        await this.handlePermissionReply(message);
        break;
      case "chat/listSessions":
        await this.handleListSessions(message);
        break;
      case "chat/createSession":
        await this.handleCreateSession(message);
        break;
    }
  }

  /**
   * Handle chat/init message
   */
  private async handleInit(message: ChatInitMessage): Promise<void> {
    console.log("[Kilo New] ChatController: Handling init with context:", message.context);
    this.viewContext = message.context;

    // Connect SSE if not already connected
    this.sseClient.connect(this.workspaceDirectory);
  }

  /**
   * Handle chat/loadSession message
   */
  private async handleLoadSession(message: ChatLoadSessionMessage): Promise<void> {
    console.log("[Kilo New] ChatController: Loading session:", message.sessionId);

    try {
      let session: SessionInfo;
      let messages: Array<{ info: { id: string; sessionID: string; role: "user" | "assistant"; time: { created: number; completed?: number } }; parts: MessagePart[] }>;

      if (message.sessionId) {
        // Load existing session
        session = await this.httpClient.getSession(message.sessionId, this.workspaceDirectory);
        messages = await this.httpClient.getMessages(message.sessionId, this.workspaceDirectory);
      } else {
        // Create new session or load most recent
        const sessions = await this.httpClient.listSessions(this.workspaceDirectory);
        if (sessions.length > 0) {
          // Load most recent session
          session = sessions[0];
          messages = await this.httpClient.getMessages(session.id, this.workspaceDirectory);
        } else {
          // Create new session
          session = await this.httpClient.createSession(this.workspaceDirectory);
          messages = [];
        }
      }

      this.currentSessionId = session.id;

      // Convert messages to ChatMessage format
      const chatMessages: ChatMessage[] = messages.map((m) => ({
        ...m.info,
        parts: m.parts,
      }));

      // Send sessionLoaded response
      this.postMessage({
        type: "chat/sessionLoaded",
        requestId: message.requestId,
        session,
        messages: chatMessages,
        status: { type: "idle" },
        pendingPermissions: [],
        todos: [],
      });

      console.log("[Kilo New] ChatController: Session loaded:", session.id);
    } catch (error) {
      this.sendError(
        "Failed to load session",
        error,
        message.requestId,
        message.sessionId
      );
    }
  }

  /**
   * Handle chat/sendPrompt message
   */
  private async handleSendPrompt(message: ChatSendPromptMessage): Promise<void> {
    console.log("[Kilo New] ChatController: Sending prompt to session:", message.sessionId);

    const requestId = message.requestId || `req_${Date.now()}`;
    this.currentRequestId = requestId;
    this.activeRequests.set(requestId, { sessionId: message.sessionId, aborted: false });

    try {
      // Notify request started
      this.postMessage({
        type: "chat/requestState",
        sessionId: message.sessionId,
        state: { status: "started", requestId },
      });

      // Build message parts from text and attachments
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = [
        { type: "text", text: message.text },
      ];

      // Add file attachments if present
      if (message.attachments) {
        for (const attachment of message.attachments) {
          if (attachment.type === "file" && attachment.path) {
            parts.push({
              type: "file",
              mime: attachment.mimeType || "text/plain",
              url: `file://${attachment.path}`,
            });
          }
        }
      }

      // Send message to backend
      const response = await this.httpClient.sendMessage(
        message.sessionId,
        parts,
        this.workspaceDirectory
      );

      // Check if aborted while waiting
      const requestState = this.activeRequests.get(requestId);
      if (requestState?.aborted) {
        console.log("[Kilo New] ChatController: Request was aborted:", requestId);
        return;
      }

      // Send the user message that was created
      this.postMessage({
        type: "chat/messageAppended",
        sessionId: message.sessionId,
        message: {
          ...response.info,
          parts: response.parts,
        },
      });

      // Note: The assistant response will come via SSE events
      console.log("[Kilo New] ChatController: Prompt sent, waiting for SSE response");
    } catch (error) {
      this.activeRequests.delete(requestId);
      this.currentRequestId = null;

      // Notify request finished with error
      this.postMessage({
        type: "chat/requestState",
        sessionId: message.sessionId,
        state: { status: "finished", requestId },
      });

      this.sendError(
        "Failed to send prompt",
        error,
        message.requestId,
        message.sessionId
      );
    }
  }

  /**
   * Handle chat/abort message
   */
  private async handleAbort(message: ChatAbortMessage): Promise<void> {
    console.log("[Kilo New] ChatController: Aborting session:", message.sessionId);

    // Mark current request as aborted
    if (this.currentRequestId) {
      const requestState = this.activeRequests.get(this.currentRequestId);
      if (requestState) {
        requestState.aborted = true;
      }
    }

    try {
      await this.httpClient.abortSession(message.sessionId, this.workspaceDirectory);

      // Notify request aborted
      if (this.currentRequestId) {
        this.postMessage({
          type: "chat/requestState",
          sessionId: message.sessionId,
          state: {
            status: "aborted",
            requestId: this.currentRequestId,
            reason: "User requested abort",
          },
        });
        this.activeRequests.delete(this.currentRequestId);
        this.currentRequestId = null;
      }

      console.log("[Kilo New] ChatController: Session aborted");
    } catch (error) {
      this.sendError("Failed to abort session", error, undefined, message.sessionId);
    }
  }

  /**
   * Handle chat/setModel message
   */
  private async handleSetModel(message: ChatSetModelMessage): Promise<void> {
    console.log("[Kilo New] ChatController: Setting model:", message.model);
    // TODO: Implement model setting when backend supports it
    // For now, just acknowledge the message
    console.log("[Kilo New] ChatController: Model setting not yet implemented in backend");
  }

  /**
   * Handle chat/permissionReply message
   */
  private async handlePermissionReply(message: ChatPermissionReplyMessage): Promise<void> {
    console.log(
      "[Kilo New] ChatController: Permission reply:",
      message.permissionRequestId,
      message.reply
    );

    try {
      await this.httpClient.respondToPermission(
        message.sessionId,
        message.permissionRequestId,
        message.reply,
        this.workspaceDirectory
      );
      console.log("[Kilo New] ChatController: Permission response sent");
    } catch (error) {
      this.sendError(
        "Failed to respond to permission",
        error,
        message.requestId,
        message.sessionId
      );
    }
  }

  /**
   * Handle chat/listSessions message
   */
  private async handleListSessions(message: ChatListSessionsMessage): Promise<void> {
    console.log("[Kilo New] ChatController: Listing sessions");

    try {
      const sessions = await this.httpClient.listSessions(this.workspaceDirectory);

      this.postMessage({
        type: "chat/sessionsList",
        requestId: message.requestId,
        sessions,
      });

      console.log("[Kilo New] ChatController: Listed", sessions.length, "sessions");
    } catch (error) {
      this.sendError("Failed to list sessions", error, message.requestId);
    }
  }

  /**
   * Handle chat/createSession message
   */
  private async handleCreateSession(message: ChatCreateSessionMessage): Promise<void> {
    console.log("[Kilo New] ChatController: Creating session");

    try {
      const session = await this.httpClient.createSession(this.workspaceDirectory);
      this.currentSessionId = session.id;

      this.postMessage({
        type: "chat/sessionCreated",
        requestId: message.requestId,
        session,
      });

      console.log("[Kilo New] ChatController: Session created:", session.id);
    } catch (error) {
      this.sendError("Failed to create session", error, message.requestId);
    }
  }

  /**
   * Handle SSE events from the backend
   */
  private handleSSEEvent(event: SSEEvent): void {
    console.log("[Kilo New] ChatController: SSE event:", event.type);

    // Filter events by session ID
    if ("sessionID" in event.properties) {
      if (this.currentSessionId && event.properties.sessionID !== this.currentSessionId) {
        return;
      }
    }

    switch (event.type) {
      case "session.created":
        this.postMessage({
          type: "chat/sessionCreated",
          session: event.properties.info,
        });
        break;

      case "session.updated":
        this.postMessage({
          type: "chat/sessionUpdated",
          session: event.properties.info,
        });
        break;

      case "session.status":
        this.postMessage({
          type: "chat/sessionStatus",
          sessionId: event.properties.sessionID,
          status: event.properties.status,
        });

        // If status is idle and we have an active request, mark it as finished
        if (event.properties.status.type === "idle" && this.currentRequestId) {
          this.postMessage({
            type: "chat/requestState",
            sessionId: event.properties.sessionID,
            state: { status: "finished", requestId: this.currentRequestId },
          });
          this.activeRequests.delete(this.currentRequestId);
          this.currentRequestId = null;
        }
        break;

      case "session.idle":
        // Session became idle - mark request as finished
        if (this.currentRequestId) {
          this.postMessage({
            type: "chat/requestState",
            sessionId: event.properties.sessionID,
            state: { status: "finished", requestId: this.currentRequestId },
          });
          this.activeRequests.delete(this.currentRequestId);
          this.currentRequestId = null;
        }
        break;

      case "message.updated":
        this.postMessage({
          type: "chat/messageUpdated",
          sessionId: event.properties.info.sessionID,
          message: event.properties.info,
        });
        break;

      case "message.part.updated":
        // This is the streaming delta event
        if (this.currentSessionId) {
          this.postMessage({
            type: "chat/messageDelta",
            sessionId: this.currentSessionId,
            messageId: "", // The backend doesn't include messageId in part updates
            part: event.properties.part,
            delta: event.properties.delta,
          });
        }
        break;

      case "permission.asked":
        this.postMessage({
          type: "chat/permissionRequest",
          request: event.properties,
        });
        break;

      case "todo.updated":
        this.postMessage({
          type: "chat/todosUpdated",
          sessionId: event.properties.sessionID,
          todos: event.properties.items,
        });
        break;

      case "server.connected":
      case "server.heartbeat":
        // Ignore server lifecycle events
        break;

      case "permission.replied":
        // Permission was handled, no need to forward
        break;
    }
  }

  /**
   * Handle SSE errors
   */
  private handleSSEError(error: Error): void {
    console.error("[Kilo New] ChatController: SSE error:", error);
    this.sendError("Connection error", error);
  }

  /**
   * Post a message to the webview
   */
  private postMessage(message: ExtensionToWebviewMessage): void {
    console.log("[Kilo New] ChatController: Posting message:", message.type);
    this.webview.postMessage(message);
  }

  /**
   * Send an error message to the webview
   */
  private sendError(
    humanMessage: string,
    error: unknown,
    requestId?: string,
    sessionId?: string
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    console.error("[Kilo New] ChatController:", humanMessage, errorMessage);

    this.postMessage({
      type: "chat/error",
      requestId,
      sessionId,
      message: `${humanMessage}: ${errorMessage}`,
      code: "BACKEND_ERROR",
      debug: {
        stack,
        context: { originalError: errorMessage },
      },
    });
  }

  /**
   * Dispose of the controller
   */
  dispose(): void {
    console.log("[Kilo New] ChatController: Disposing");
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.activeRequests.clear();
  }
}
