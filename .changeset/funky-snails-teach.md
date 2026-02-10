---
"kilo-code": minor
"@roo-code/types": patch
---

Add AWS Bedrock Inference Profile ARN resolution support

This change adds full support for AWS Bedrock inference profiles (both `application-inference-profile` and `inference-profile` ARNs) with automatic model resolution to detect underlying model capabilities.

**What changed:**

- Added `@aws-sdk/client-bedrock` dependency for inference profile resolution
- New `BedrockInferenceProfileResolver` automatically resolves inference profile ARNs to underlying model IDs
- Enhanced Bedrock provider to detect model capabilities (prompt caching, extended context, reasoning budgets) from resolved models
- Improved settings UI with real-time ARN resolution feedback
- Added comprehensive test coverage for inference profile resolution

**Why:**
Previously, inference profile ARNs were treated as unknown models, preventing features like prompt caching from being enabled. This change enables full feature support for inference profiles.

**How to use:**
Configure AWS Bedrock provider with an inference profile ARN (e.g., `arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/my-profile`) and the extension will automatically resolve it to detect the underlying model's capabilities.
