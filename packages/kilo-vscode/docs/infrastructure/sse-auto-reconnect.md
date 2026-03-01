# SSE Auto-Reconnect with Exponential Backoff

**Priority:** P0
**Status:** ❌ Not started
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## Remaining Work

- Auto-reconnect on SSE connection loss with exponential backoff (2s → 4s → 8s → … → 30s cap)
- Reset backoff delay on successful reconnect
- Add `"reconnecting"` state to `ConnectionState` in both extension and webview
- Surface reconnecting state in the webview UI (e.g., banner or status indicator)
- Clean up reconnect timer on intentional disconnect/dispose

## Implementation Notes

The JetBrains plugin implements exponential backoff reconnection. Pattern:

```typescript
// In SSEClient
private reconnectDelay = 2000
private readonly maxReconnectDelay = 30000
private shouldReconnect = true

// On error: schedule reconnect
this.reconnectTimeout = setTimeout(() => {
  this.doConnect(directory)
}, this.reconnectDelay)
this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)

// On success: reset delay
this.reconnectDelay = 2000
```

Files to change:

- [`src/services/cli-backend/sse-client.ts`](../../src/services/cli-backend/sse-client.ts) — add reconnect logic
- [`src/services/cli-backend/connection-service.ts`](../../src/services/cli-backend/connection-service.ts) — add `"reconnecting"` to `ConnectionState`
- [`webview-ui/src/types/messages.ts`](../../webview-ui/src/types/messages.ts) — add `"reconnecting"` to webview `ConnectionState`
- [`webview-ui/src/App.tsx`](../../webview-ui/src/App.tsx) — show reconnecting state in UI
