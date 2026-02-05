# Chat Webview Implementation Notes

This document describes the architecture for the chat UI in the VS Code extension webview.

## Architecture Overview

The chat UI follows a message-passing architecture where:

1. **Webview** - Renders the chat UI using Solid.js
2. **Extension Host** - Handles business logic and backend communication
3. **Backend** - OpenCode server (to be connected)

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
│  │  │chat-store │  │         │  └───────────────────────┘  ││
│  │  └───────────┘  │         │                             ││
│  └─────────────────┘         └─────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                              ┌─────────────────┐
                              │  OpenCode Server│
                              │  (localhost:8741)│
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

## Known Limitations

1. **Mock Backend**: Currently uses simulated responses. Needs to connect to actual OpenCode server.
2. **No Persistence**: Sessions are in-memory only, lost on extension reload.
3. **Limited UI**: Basic chat UI, doesn't include all features from opencode-app (file tree, terminal, code diff view).
4. **Missing Dependencies**: The copied opencode-app code has dependencies on `@opencode-ai/ui`, `@kilocode/sdk`, etc. that are not available. The ChatView uses standalone implementation.

## Next Steps

1. **Connect to OpenCode Backend**
   - Update ChatController to use actual OpenCode SDK
   - Configure server URL from settings
   - Handle authentication

2. **Add Session Persistence**
   - Store sessions using VS Code's globalState or workspace state
   - Load previous sessions on startup

3. **Integrate More opencode-app Components**
   - Add dependencies to package.json
   - Gradually replace ChatView with opencode-app's SessionView
   - Wire up the full context providers

4. **Add Features**
   - File attachments
   - Code diff review
   - Terminal integration
   - Model/agent selection UI

## Testing

Manual test steps:

1. Run extension in VS Code Extension Development Host (`F5`)
2. Open the Kilo Code sidebar
3. Chat UI should render
4. Type a message and send
5. User message appears immediately
6. Simulated assistant response streams in
7. Check devtools console for any errors
