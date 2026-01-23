---
"kilo-code": patch
---

Add comprehensive request/response logging to Z.ai provider handler for verification and debugging. Logs now capture endpoint configuration, authentication details, request parameters (model, tokens, thinking mode), and response characteristics including reasoning content. Includes 6 new integration tests verifying logging behavior across all API endpoints (international_coding, china_coding, international_api, china_api).
