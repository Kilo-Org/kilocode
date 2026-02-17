---
"@roo-code/types": minor
---

Add support for Claude Sonnet 4.6 and Claude Opus 4.6 on Amazon Bedrock

- Added `anthropic.claude-sonnet-4-6` with tiered pricing:
  - Standard (≤200K context): $3.00 input, $15.00 output, $3.75 cache write, $0.30 cache read
  - Long Context (>200K, 1M): $6.00 input, $22.50 output, $7.50 cache write, $0.60 cache read

- Added `anthropic.claude-opus-4-6` with tiered pricing:
  - Standard (≤200K context): $5.00 input, $25.00 output, $6.25 cache write, $0.50 cache read
  - Long Context (>200K, 1M): $10.00 input, $37.50 output, $12.50 cache write, $1.00 cache read

Both models support:
- 200K context window (extendable to 1M with beta flag)
- 8K max tokens
- Images, prompt caching, reasoning budget, and native tools
- Global Inference
- Added to `BEDROCK_1M_CONTEXT_MODEL_IDS` and `BEDROCK_GLOBAL_INFERENCE_MODEL_IDS`
