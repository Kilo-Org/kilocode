---
"kilo-code": patch
---

Report a clear configuration error when an Azure resource name or a Google Vertex location is not a plain resource name or region, send the AI Gateway credential from the environment only to a Cloudflare AI Gateway endpoint, and send the Google Cloud access token of the OpenAI-compatible Vertex path only to a Vertex API host. A Vertex location is validated only when the request endpoint is derived from it, so a provider configured with its own endpoint keeps working.
