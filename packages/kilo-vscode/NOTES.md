# Chat Webview Implementation Notes

This document describes the architecture for the chat UI in the VS Code extension webview.

## Architecture Overview

The chat UI follows a message-passing architecture where:

1. **Webview** - Renders the chat UI using Solid.js
2. **Extension Host** - Handles business logic and backend communication
3. **Backend** - OpenCode server (connected via CLI backend services)

```
┌─────────────────────────────────────────────────────────────┐
│                        VS Code                               │
│  ┌─────────────────┐         ┌─────────────────────────────┐│
│  │    Webview      │ Message │     Extension Host          ││
│  │  ┌───────────┐  │ Passing │  ┌───────────────────────┐  ││
│  │  │ ChatView  │◄─┼────────►┼──│   ChatController      │  ││
│  │  └───────────┘  │         │  └───────────────────────┘  ││
│  │  ┌───────────┐  │         │           │                 ││
│  │  │ transport │  │         │           ▼                 ││
│  │  └───────────┘  │         │  ┌───────────────────────┐  ││
│  │  ┌───────────┐  │         │  │   KiloProvider        │  ││
│  │  │chat-store │  │         │  │   (HttpClient, SSE)   │  ││
│  │  └───────────┘  │         │  └───────────────────────┘  ││
│  └─────────────────┘         └─────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                              ┌─────────────────┐
                              │  OpenCode Server│
                              │  (localhost:PORT)│
                              └─────────────────┘
```

## File Locations

### Protocol Types
- **Location**: `src/shared/protocol.ts`
- **Purpose**: Defines typed messages for webview ↔ extension communication
- **Includes**: All message types, chat data structures, request/response types

### Webview Side

| File | Purpose |
|------|---------|
| `webview-ui/src/lib/transport.ts` | Message passing wrapper with request/response semantics |
| `webview-ui/src/lib/chat-store.ts` | Solid.js store for chat state management |
| `webview-ui/src/lib/vscode-platform.ts` | Platform adapter for VS Code webview environment |
| `webview-ui/src/ChatView.tsx` | Main chat UI component |
| `webview-ui/src/chat-view.css` | Styles for the chat UI |

### Extension Host Side

| File | Purpose |
|------|---------|
| `src/ChatController.ts` | Handles chat messages and backend bridging |
| `src/KiloProvider.ts` | Webview provider with message routing |

### CLI Backend Services

| File | Purpose |
|------|---------|
| `src/services/cli-backend/http-client.ts` | HTTP client for REST API calls (sessions, messages, permissions) |
| `src/services/cli-backend/sse-client.ts` | SSE client for real-time streaming events |
| `src/services/cli-backend/server-manager.ts` | Server lifecycle management |
| `src/services/cli-backend/types.ts` | Type definitions for backend API |

## Message Protocol

### Webview → Extension Messages

| Message Type | Purpose |
|--------------|---------|
| `chat/init` | Initialize chat, get config and sessions |
| `chat/loadSession` | Load a specific session's messages |
| `chat/createSession` | Create a new chat session |
| `chat/sendPrompt` | Send user message to assistant |
| `chat/abort` | Cancel ongoing request |
| `chat/listSessions` | Get list of all sessions |

### Extension → Webview Messages

| Message Type | Purpose |
|--------------|---------|
| `chat/initialized` | Response to init with config |
| `chat/sessionLoaded` | Session data with messages |
| `chat/sessionCreated` | New session created |
| `chat/messageAppended` | New message added to session |
| `chat/messageDelta` | Streaming content delta |
| `chat/partUpdated` | Message part updated |
| `chat/requestState` | Request state change (started/streaming/finished/error) |
| `chat/error` | Error occurred |

## How to Debug

### Extension Host Logs
- Open "Extension Host" output channel in VS Code
- All messages prefixed with `[Kilo New]`

### Webview Logs
- Command Palette → "Developer: Open Webview Developer Tools"
- Check Console tab for JavaScript logs

### Common Issues

1. **Messages not received**: Check that webview is properly set on ChatController
2. **Styling issues**: VS Code CSS variables may not be available, use fallbacks
3. **TypeScript errors**: Ensure path aliases are configured in both tsconfig.json and esbuild.js

## Backend Connection

The chat webview is now connected to the OpenCode backend via CLI backend services:

### How It Works

1. **Server Discovery**: `ServerManager` discovers or starts the OpenCode server
2. **HTTP Client**: `HttpClient` handles REST API calls for:
   - Creating/loading sessions
   - Sending messages
   - Aborting requests
   - Permission responses
3. **SSE Client**: `SSEClient` receives real-time streaming events:
   - `message.updated` - New message created
   - `message.part.updated` - Streaming content deltas
   - `session.status` - Session state changes (idle/busy)
   - `session.idle` - Request completed

### Connection Flow

```
1. KiloProvider.initializeConnection()
   ├── ServerManager.getServer() → {port, password}
   ├── Create HttpClient(config)
   ├── Create SSEClient(config)
   ├── ChatController.setBackendClients(http, sse)
   └── SSEClient.connect(workspaceDir)

2. User sends message
   ├── ChatController.handleSendPrompt()
   ├── HttpClient.sendMessage() → Backend
   └── SSE events stream back → ChatController.handleSSEEvent()
```

### Authentication

The backend uses HTTP Basic Auth with:
- Username: `opencode`
- Password: Generated by server (obtained from ServerManager)

## Known Limitations

1. **Limited UI**: Basic chat UI, doesn't include all features from opencode-app (file tree, terminal, code diff view).
2. **Missing Dependencies**: The copied opencode-app code has dependencies on `@opencode-ai/ui`, `@kilocode/sdk`, etc. that are not available. The ChatView uses standalone implementation.
3. **Session Persistence**: Sessions are stored on the backend, but local cache is lost on extension reload.

## Next Steps

1. **Add Session Persistence**
   - Cache sessions using VS Code's globalState or workspace state
   - Restore session list on startup

2. **Integrate More opencode-app Components**
   - Add dependencies to package.json
   - Gradually replace ChatView with opencode-app's SessionView
   - Wire up the full context providers

3. **Add Features**
   - File attachments
   - Code diff review
   - Terminal integration
   - Model/agent selection UI

## Testing

Manual test steps:

1. Ensure OpenCode backend is running locally
2. Run extension in VS Code Extension Development Host (`F5`)
3. Open the Kilo Code sidebar
4. Chat UI should render
5. Type a message and send
6. User message appears immediately
7. Assistant response streams in from the backend
8. Check devtools console for any errors

### Verifying Backend Connection

1. Check Extension Host logs for:
   - `[Kilo New] KiloProvider: ✅ Server obtained`
   - `[Kilo New] KiloProvider: 🔗 Backend clients passed to ChatController`
   - `[Kilo New] SSE: ✅ EventSource opened successfully`

2. When sending a message, look for:
   - `[Kilo New] ChatController received message: chat/sendPrompt`
   - `[Kilo New] KiloProvider: 📨 Received SSE event: message.part.updated`
