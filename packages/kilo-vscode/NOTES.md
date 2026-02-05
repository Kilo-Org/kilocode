# Chat UI Integration - Implementation Notes

This document describes the chat UI integration architecture for the Kilo VS Code extension.

## Architecture Overview

The chat UI follows a layered architecture with clear separation between the VS Code extension host and the webview:

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Webview (Solid.js)                        │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────┐  │
│  │    ChatView     │───▶│ TransportProvider │───▶│ ChatTransport │  │
│  │   (UI Layer)    │    │   (Solid Context) │    │  (Messaging)  │  │
│  └─────────────────┘    └──────────────────┘    └───────┬───────┘  │
└─────────────────────────────────────────────────────────┼───────────┘
                                                          │
                              window.postMessage / onDidReceiveMessage
                                                          │
┌─────────────────────────────────────────────────────────┼───────────┐
│                      Extension Host (Node.js)           │           │
│  ┌─────────────────┐    ┌──────────────────┐    ┌──────▼────────┐  │
│  │  KiloProvider   │───▶│  ChatController  │───▶│  HttpClient   │  │
│  │ (WebviewPanel)  │    │   (Message Hub)  │    │  (REST API)   │  │
│  └─────────────────┘    └────────┬─────────┘    └───────────────┘  │
│                                  │                                  │
│                                  │              ┌───────────────┐  │
│                                  └─────────────▶│   SSEClient   │  │
│                                                 │  (Streaming)  │  │
│                                                 └───────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
                                              ┌───────────────────┐
                                              │   CLI Backend     │
                                              │  (opencode-cli)   │
                                              └───────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| [`src/shared/chat-protocol.ts`](src/shared/chat-protocol.ts) | Typed message protocol shared between extension and webview |
| [`src/controllers/ChatController.ts`](src/controllers/ChatController.ts) | Extension-host controller bridging webview to CLI backend |
| [`webview-ui/src/transport/chat-transport.ts`](webview-ui/src/transport/chat-transport.ts) | Webview-side transport layer with request/response semantics |
| [`webview-ui/src/transport/TransportProvider.tsx`](webview-ui/src/transport/TransportProvider.tsx) | Solid.js context provider for transport state |
| [`webview-ui/src/views/ChatView.tsx`](webview-ui/src/views/ChatView.tsx) | Main chat UI component |
| [`src/services/cli-backend/http-client.ts`](src/services/cli-backend/http-client.ts) | HTTP client for CLI backend REST API |
| [`src/services/cli-backend/sse-client.ts`](src/services/cli-backend/sse-client.ts) | SSE client for streaming events |

## Message Protocol

### Location

The message protocol is defined in [`src/shared/chat-protocol.ts`](src/shared/chat-protocol.ts).

### Message Types

#### Webview → Extension Messages

| Type | Purpose |
|------|---------|
| `chat/init` | Initialize the chat, sent when webview is ready |
| `chat/loadSession` | Load a session by ID or create/load default |
| `chat/sendPrompt` | Send a user prompt to the assistant |
| `chat/abort` | Abort the current request |
| `chat/setModel` | Set the model for future requests |
| `chat/permissionReply` | Reply to a permission request |
| `chat/listSessions` | List available sessions |
| `chat/createSession` | Create a new session |

#### Extension → Webview Messages

| Type | Purpose |
|------|---------|
| `chat/sessionLoaded` | Session loaded with full state |
| `chat/messageAppended` | New message added to session |
| `chat/messageUpdated` | Message info updated |
| `chat/messageDelta` | Streaming delta for message part |
| `chat/requestState` | Request state change (started/finished/aborted) |
| `chat/sessionStatus` | Session status change |
| `chat/error` | Error notification |
| `chat/permissionRequest` | Permission request from backend |
| `chat/sessionsList` | List of available sessions |
| `chat/sessionCreated` | Session created notification |
| `chat/sessionUpdated` | Session updated notification |
| `chat/todosUpdated` | Todo list updated |

### Adding New Message Types

1. Add the message interface to [`src/shared/chat-protocol.ts`](src/shared/chat-protocol.ts):
   ```typescript
   export interface ChatNewFeatureMessage extends BaseMessage {
     type: "chat/newFeature"
     // ... fields
   }
   ```

2. Add to the appropriate union type:
   - `WebviewToExtensionMessage` for webview → extension
   - `ExtensionToWebviewMessage` for extension → webview

3. Add the type string to the corresponding Set:
   - `WEBVIEW_MESSAGE_TYPES` for webview messages
   - `EXTENSION_MESSAGE_TYPES` for extension messages

4. Handle the message in:
   - [`ChatController.ts`](src/controllers/ChatController.ts) for webview → extension
   - [`chat-transport.ts`](webview-ui/src/transport/chat-transport.ts) for extension → webview

## Debugging

### Extension Host Debugging

1. **Output Channel**: All extension logs go to the "Extension Host" output channel (not Debug Console)
2. **Log Prefix**: All debug output is prefixed with `[Kilo New]` for easy filtering
3. **View Logs**: 
   - Open VS Code Output panel (View → Output)
   - Select "Extension Host" from the dropdown

### Webview Debugging

1. **Open DevTools**: Command Palette → "Developer: Open Webview Developer Tools"
2. **Console Logs**: All webview logs are prefixed with `[Kilo New]`
3. **Network Tab**: Useful for debugging message passing (though messages go through VS Code API, not network)

### Common Debug Scenarios

**Messages not being received:**
```typescript
// Add logging in ChatController.handleWebviewMessage
console.log("[Kilo New] ChatController: Received message:", message.type);

// Add logging in ChatTransport.handleMessage
console.log("[Kilo New] ChatTransport: Received message:", message.type, message);
```

**SSE events not arriving:**
```typescript
// Check SSE connection in ChatController
console.log("[Kilo New] ChatController: SSE event:", event.type);
```

**Session state issues:**
```typescript
// Log session state in TransportProvider
console.log("[Kilo New] TransportProvider: Session state:", {
  sessionId: currentSession()?.id,
  messageCount: messages.length,
  status: sessionStatus(),
});
```

## Known Limitations

### Model Selection
- Model selection UI exists but is not fully implemented
- The `chat/setModel` message is received but not processed by the backend
- Currently uses the default model configured in the CLI backend

### Minimal ChatView
- The current [`ChatView.tsx`](webview-ui/src/views/ChatView.tsx) is a minimal implementation
- Full OpenCode [`session.tsx`](webview-ui/src/opencode-app/pages/session.tsx) is not yet integrated
- Missing features from full OpenCode UI:
  - File tree integration
  - Terminal integration
  - Context tabs
  - Sortable tabs
  - Full markdown rendering

### Streaming Deltas
- Message deltas are received but the UI doesn't show streaming text
- Parts are updated in place rather than streamed character-by-character

### Permission UI
- Basic permission request UI is implemented
- Missing detailed permission descriptions and context

### Session Management
- Basic session loading and creation works
- Session switching UI not implemented
- Session history/list view not implemented

### Attachments
- Attachment types are defined in the protocol
- File attachment sending is partially implemented
- Image attachments not implemented
- Selection attachments not implemented

## Future Improvements

### Short Term
- [ ] Integrate full OpenCode session.tsx with all contexts
- [ ] Add streaming text display for message deltas
- [ ] Implement model selection dropdown
- [ ] Add session switcher UI

### Medium Term
- [ ] Add file attachments support (drag & drop, file picker)
- [ ] Add terminal integration
- [ ] Add file tree integration
- [ ] Implement markdown rendering with syntax highlighting

### Long Term
- [ ] Add MCP (Model Context Protocol) integration
- [ ] Add voice input support
- [ ] Add image generation/editing support
- [ ] Add collaborative features

## Testing

### Running Tests
```bash
pnpm test
```

### Running Single Test
```bash
pnpm test -- --grep "test name"
```

### Manual Testing
1. Start the extension in debug mode (F5)
2. Open the Kilo sidebar
3. Check Extension Host output for logs
4. Open Webview DevTools for webview logs

## Build

### Full Build
```bash
pnpm compile
```

### Watch Mode
```bash
pnpm watch
```

### Lint
```bash
pnpm lint
```
