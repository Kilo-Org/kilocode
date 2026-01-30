# Z.ai Handler Logging and Verification

This document describes the logging and verification capabilities of the Z.ai provider handler.

## Overview

The Z.ai handler includes comprehensive logging to verify that:

- The correct API endpoint is being called based on `zaiApiLine` configuration
- Authentication headers are properly set with the provided API key
- Request parameters (model, tokens, thinking mode, etc.) are correctly formatted
- Response data is properly parsed from Z.ai's API response format

## Logging Points

### 1. Request Routing Logs

**Location:** `createStream()` method override

Two types of logs are produced:

#### GLM-4.7 Thinking Mode Request

```
Z.ai GLM-4.7 thinking mode request
{
  model: "glm-4.7",
  useReasoning: true,
  enableReasoningEffort: true,
  reasoningEffort: "medium"
}
```

This log appears when:

- The selected model is `glm-4.7` (has reasoning support)
- The handler is routing to special thinking mode handling

#### Standard Model Request

```
Z.ai standard model request
{
  model: "glm-4.5",
  supportsReasoningEffort: false
}
```

This log appears for non-thinking models like `glm-4.5`, `glm-4.5-air`, `glm-4.5v`.

### 2. API Request Logs

**Location:** `createStreamWithThinking()` method (for GLM-4.7 models)

```
Z.ai API request
{
  provider: "Z.ai",
  baseUrl: "https://api.z.ai/api/coding/paas/v4",
  model: "glm-4.7",
  maxTokens: 25600,
  temperature: 0.5,
  hasTools: false,
  hasToolChoice: false,
  thinkingMode: "enabled",
  messageCount: 1,
  zaiApiLine: "international_coding"
}
```

**Key verification points:**

- `baseUrl`: Confirms the correct endpoint is configured
    - `https://api.z.ai/api/coding/paas/v4` for international_coding
    - `https://open.bigmodel.cn/api/coding/paas/v4` for china_coding
    - `https://api.z.ai/api/paas/v4` for international_api
    - `https://open.bigmodel.cn/api/paas/v4` for china_api
- `model`: Confirms correct model ID
- `thinkingMode`: Confirms thinking is enabled/disabled correctly
    - `"enabled"` when reasoning is on for GLM-4.7
    - `"disabled"` when reasoning is off for GLM-4.7
- `zaiApiLine`: Confirms the API line configuration

### 3. API Error Logs

**Location:** `createStreamWithThinking()` method (on error)

```
Z.ai API request failed
{
  provider: "Z.ai",
  model: "glm-4.7",
  baseUrl: "https://api.z.ai/api/coding/paas/v4",
  error: "Authentication failed: Invalid API key"
}
```

## Response Logging

### Message Completion Logs

**Location:** `createMessage()` method override

**Started:**

```
Z.ai createMessage started
{
  model: "glm-4.7",
  messageCount: 2
}
```

**Completed:**

```
Z.ai createMessage completed
{
  model: "glm-4.7",
  hasReasoningContent: true,
  estimatedResponseTokens: 250
}
```

**Verification points:**

- `hasReasoningContent`: Confirms whether reasoning_content was received in stream
- `estimatedResponseTokens`: Rough token count of response text

## Configuration Verification

### Endpoint Selection

The handler verifies the correct endpoint based on `zaiApiLine`:

| zaiApiLine             | Region        | Endpoint                                      |
| ---------------------- | ------------- | --------------------------------------------- |
| `international_coding` | International | `https://api.z.ai/api/coding/paas/v4`         |
| `china_coding`         | China         | `https://open.bigmodel.cn/api/coding/paas/v4` |
| `international_api`    | International | `https://api.z.ai/api/paas/v4`                |
| `china_api`            | China         | `https://open.bigmodel.cn/api/paas/v4`        |

The `baseUrl` in the log confirms which endpoint is active.

### Authentication Verification

The handler requires `zaiApiKey` which is passed to the OpenAI client as the API key header.

To verify authentication is working:

1. Check that OpenAI client is initialized with the correct API key
2. Monitor for authentication-related errors in the error logs
3. Verify the handler doesn't throw on instantiation for valid API keys

### Model Response Format Verification

Z.ai responses can include `reasoning_content` field (for GLM-4.7 thinking mode):

```json
{
	"choices": [
		{
			"delta": {
				"reasoning_content": "Let me think...",
				"content": "Here is my response..."
			}
		}
	],
	"usage": {
		"prompt_tokens": 100,
		"completion_tokens": 50
	}
}
```

The handler logs whether `hasReasoningContent` was received, confirming the response format is correct.

## Testing Verification Logs

The logging is tested in two test files:

### 1. `zai.spec.ts` - Functional Tests

Tests verify:

- Correct endpoint URL for each `zaiApiLine`
- Correct API key is passed
- Request parameters are properly constructed
- Response data is correctly parsed (reasoning_content, text, usage)

### 2. `zai-logging.integration.spec.ts` - Logging Integration Tests

Tests verify:

- Logger is called with correct arguments
- Logging includes all required metadata
- Error logging works when API calls fail
- Response characteristics are logged accurately

## Accessing Logs

### In VSCode Extension

Logs appear in the VSCode Output channel:

1. Open Output panel (View > Output)
2. Select "Kilo Code" from the dropdown
3. Look for "Z.ai" entries

### In CLI Mode

Logs are written to console during development/testing.

### For Test Verification

Run the Z.ai test suite:

```bash
cd src
pnpm test api/providers/__tests__/zai
```

This will run:

- 38 functional tests (endpoints, models, thinking mode)
- 6 logging integration tests (verification of request/response handling)

## Troubleshooting

### Missing Endpoint Logs

If you don't see `Z.ai API request` logs, the handler may not be using the thinking mode path.

- Verify the model is `glm-4.7` (check `model` field in logs)
- Verify `enableReasoningEffort` is set in configuration

### Wrong Endpoint Being Used

If `baseUrl` in logs doesn't match expected endpoint:

- Check that `zaiApiLine` is correctly set in configuration
- Verify the Z.ai handler is being instantiated (check `ZAiHandler` class logs)

### Authentication Failures

If error logs show authentication errors:

- Verify `zaiApiKey` is correct
- Check that API key has appropriate permissions for selected `zaiApiLine`
- Try regenerating the API key in Z.ai account settings

### Missing Reasoning Content

If `hasReasoningContent: false` but you expected reasoning:

- Verify model is `glm-4.7` (not `glm-4.5` or others)
- Verify `enableReasoningEffort: true` in configuration
- Check that `thinkingMode: "enabled"` in request logs
