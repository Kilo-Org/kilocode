# Connection State UI (Loading / Error / Reconnecting)

**Priority:** P0
**Status:** 🔨 Partial

## What Exists

- `ServerProvider` tracks `connectionState` signal ("connecting"/"connected"/"disconnected"/"error")
- `PromptInput` disables the textarea when disconnected and shows "Connecting to server..." placeholder
- `AboutKiloCodeTab` shows a connection status dot

## Remaining Work

- Loading spinner overlay with "Connecting to Kilo..." when state is `"connecting"`
- Reconnecting indicator (depends on [SSE Auto-Reconnect](../infrastructure/sse-auto-reconnect.md) adding `"reconnecting"` state)
- Error panel with message and "Retry" button when state is `"error"`
- Gate the chat interface — only render when `"connected"`

## Implementation Notes

```tsx
// In App.tsx or ChatView.tsx:
<Switch fallback={<ChatInterface />}>
  <Match when={server.connectionState() === "connecting"}>
    <LoadingPanel message="Connecting to Kilo..." />
  </Match>
  <Match when={server.connectionState() === "reconnecting"}>
    <LoadingPanel message="Reconnecting..." showSpinner />
  </Match>
  <Match when={server.connectionState() === "error"}>
    <ErrorPanel message={server.error()} onRetry={() => reconnect()} />
  </Match>
</Switch>
```

Files to change:

- [`webview-ui/src/App.tsx`](../../webview-ui/src/App.tsx) or [`webview-ui/src/components/chat/ChatView.tsx`](../../webview-ui/src/components/chat/ChatView.tsx) — add connection state gating
- New components for loading/error panels (consider kilo-ui `Spinner` and `Card`)
