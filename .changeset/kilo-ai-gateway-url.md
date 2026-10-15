---
"@kilocode/cli": minor
"kilo-code": minor
---

Route Kilo Gateway traffic (chat, models, embeddings, autocomplete, transcription) through `https://ai-gateway.kilo.ai/api/v1` by default, and support a `KILO_AI_GATEWAY_URL` environment variable to override it. Setting only `KILO_API_URL` keeps routing gateway traffic through that server.
