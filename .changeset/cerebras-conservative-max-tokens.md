---
"kilo-code": patch
---

fix(cerebras): use conservative max_tokens and add integration header

**Conservative max_tokens:**
Cerebras rate limiter estimates token consumption using max_completion_tokens upfront rather than actual usage. When agentic tools automatically set this to the model maximum (e.g., 64K), users exhaust their quota prematurely and get rate-limited despite minimal actual token consumption.

This fix uses a conservative default of 8K tokens instead of the model maximum. This is sufficient for most agentic tool use while preserving rate limit headroom.

**Integration header:**
Added `X-Cerebras-3rd-Party-Integration: kilocode` header to all Cerebras API requests for tracking and analytics.
