---
"kilo-code": patch
"@kilocode/cli": patch
---

Stop emitting `ai.*` and `gen_ai.*` OpenTelemetry spans from AI SDK calls, and remove the PostHog bridge that forwarded them. Tool/session/indexing telemetry is unchanged.
