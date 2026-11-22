---
"kilo-code": patch
---

Report a clear configuration error when an Azure resource name or a Google Vertex location is not a plain resource name or region, send the AI Gateway credential from the environment only to a Cloudflare AI Gateway endpoint, and send the Google Cloud access token of the OpenAI-compatible Vertex path only to a Vertex API host, including the Vertex mTLS hosts. A Vertex location is validated only when the request endpoint is derived from it, so a provider configured with its own endpoint keeps working. An endpoint option that is blank or only whitespace counts as unset, so the endpoint derives from the region instead of being sent as given. When no location option is set, the location falls back to the Google Cloud region that the environment names before the provider default, and it is validated there too. For the Vertex Anthropic provider, a configured project or region now decides the request endpoint ahead of the environment, so the two cannot disagree.
