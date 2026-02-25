# HTTP Request Timeouts

**Priority:** P1
**Status:** ❌ Not started
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## Remaining Work

- Add configurable request timeout (default: 60s) using `AbortController` in `HttpClient.request()`
- Add shorter connect timeout where possible (default: 10s)
- Ensure timeout cleanup on successful response (no leaked timers)

Note: `HttpClient.request()` already accepts an optional `signal?: AbortSignal` parameter and passes it to `fetch()`, but no timeout is ever created — the signal is only used for user-initiated cancellation in one caller.

## Implementation Notes

```typescript
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 60_000)
try {
  const response = await fetch(url, { ...options, signal: controller.signal })
  // ...
} finally {
  clearTimeout(timeout)
}
```

Files to change:

- [`src/services/cli-backend/http-client.ts`](../../src/services/cli-backend/http-client.ts) — add `AbortController` with timeout to `request()`
