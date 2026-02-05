# packages/kilo-vscode

VS Code extension providing a chat interface to connect with an opencode server.

## Architecture

The extension has two main parts:

1. **Extension (Node.js)** - `src/extension.ts`, `src/sidebar.ts`, `src/server.ts`
   - Runs in VS Code's extension host (Node.js environment)
   - Handles server discovery and health checking
   - Manages webview lifecycle and message passing

2. **Webview (Browser)** - `src/webview/`
   - Runs in a sandboxed browser context within VS Code
   - Uses SolidJS for UI (same as main app)
   - Communicates with extension via `postMessage`

## Key Patterns

### Extension <-> Webview Communication

```typescript
// Extension sends to webview
webview.postMessage({ type: "server", server: { url, version } })

// Webview receives
window.addEventListener("message", (e) => handleMessage(e.data))

// Webview sends to extension
vscode.postMessage({ type: "ready" })
```

### State Persistence

Webview state survives hide/show cycles via VS Code API:

```typescript
const vscode = acquireVsCodeApi<State>()
vscode.getState() // Restore
vscode.setState(newState) // Persist
```

### Server Discovery

The extension polls `http://localhost:4096/global/health` to detect a running opencode server. When found, it passes the server URL to the webview.

## File Structure

```
src/
├── extension.ts       # Extension entry point
├── sidebar.ts         # WebviewViewProvider implementation
├── server.ts          # Server discovery logic
└── webview/
    ├── App.tsx        # Main component composition
    ├── index.tsx      # Webview entry point
    ├── types.ts       # Shared type definitions
    ├── styles.css     # VS Code themed styles
    ├── context/
    │   ├── server.tsx # Server connection state
    │   └── session.tsx # Session and message state
    └── components/
        ├── StatusIndicator.tsx
        ├── MessageList.tsx
        ├── Message.tsx
        └── PromptInput.tsx
```

## Development

1. Install dependencies: `pnpm install`
2. Start watchers: `pnpm dev`
3. Press F5 in VS Code to launch Extension Development Host
4. Open the Kilo sidebar to see the webview

## Build

- `pnpm compile` - Full build
- `pnpm build:webview` - Build webview only
- `pnpm package` - Production build

## Testing

- Run `pnpm test` to execute VS Code integration tests
- Tests require VS Code to be installed

## VS Code CSS Variables

Use VS Code CSS variables for theming to match the user's theme:

- `--vscode-foreground`, `--vscode-background`
- `--vscode-button-background`, `--vscode-button-foreground`
- `--vscode-input-background`, `--vscode-input-border`
- See full list: https://code.visualstudio.com/api/references/theme-color

## Content Security Policy

The webview CSP allows:

- Scripts: nonce-based only
- Styles: inline and local resources
- Connections: localhost HTTP/HTTPS only
- Images: local, HTTPS, and data URIs
