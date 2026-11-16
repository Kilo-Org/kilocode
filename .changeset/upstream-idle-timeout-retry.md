---
"@kilocode/cli": patch
"kilo-code": patch
---

Retry AI provider timeouts that arrive mid-response instead of ending the turn. A server-side timeout such as "Upstream idle timeout exceeded" is now retried automatically without leaving partial text behind, and a dedicated error card explains that the provider's server timed out.