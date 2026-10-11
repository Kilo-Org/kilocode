---
"kilo-code": patch
---

Retry provider connection resets (`Connection reset by server`) through the normal retry path with backoff instead of pausing the session waiting for network reconnection. Connection resets are transient server-side failures when the error is marked retryable; only genuine network disconnections still trigger the offline wait.
