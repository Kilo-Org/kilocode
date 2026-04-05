# HTTP Request Timeouts

**Priority:** P1

Health check has a 3s timeout via `AbortController`. SSE has a 15s heartbeat timeout. General SDK calls have no timeouts.

## Remaining Work

- Add configurable request timeout (default: 60s) around SDK calls in KiloProvider
- Add shorter connect timeout where possible (default: 10s)
- Ensure timeout cleanup on successful response (no leaked timers)
