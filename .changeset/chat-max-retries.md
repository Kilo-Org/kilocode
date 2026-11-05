---
"kilo-code": minor
---

Add `experimental.chatMaxRetries` config option to control how many times a failed chat completion is retried (e.g. on provider rate limits or 5xx errors) before the session fails. Takes precedence over the `KILO_SESSION_RETRY_LIMIT` environment variable; when neither is set the default retry limit applies.
