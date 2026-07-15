---
"@kilocode/cli": patch
---

Prevent stalled model streams from leaving agent and subagent sessions stuck indefinitely. Apply a 60,000 ms chunk idle timeout by default for all AI SDK model streams, with prepared request/model/agent overrides and provider-level fallbacks still winning as before.
