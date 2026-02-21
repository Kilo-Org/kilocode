# Apertis Provider Design for Kilo Code

**Date:** 2026-01-20
**Status:** Approved
**Author:** Claude + User

## Overview

Apertis is a unified AI API platform providing access to 450+ models from multiple providers (OpenAI, Anthropic, Google, etc.). This document outlines the design for integrating Apertis as a model provider in Kilo Code.

## API Endpoints

| Endpoint               | Format           | Authentication          | Use Case                           |
| ---------------------- | ---------------- | ----------------------- | ---------------------------------- |
| `/v1/chat/completions` | OpenAI Chat      | `Authorization: Bearer` | General models (GPT, Gemini, etc.) |
| `/v1/messages`         | Anthropic        | `x-api-key`             | Claude models                      |
| `/v1/responses`        | OpenAI Responses | `Authorization: Bearer` | Reasoning models (o1, o3)          |
| `/api/models`          | -                | None required           | Public model list                  |
| `/v1/models`           | OpenAI           | `Authorization: Bearer` | Detailed model info                |

**Base URL:** `https://api.apertis.ai` (configurable for enterprise/self-hosted)

## Architecture

### Smart API Router

The ApertisHandler implements intelligent routing based on model ID:

```
┌─────────────────────────────────────────────────────────┐
│                  ApertisHandler                          │
├─────────────────────────────────────────────────────────┤
│  getApiFormat(modelId) → decides which API to use       │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ /v1/messages│  │/v1/responses│  │/v1/chat/complete│  │
│  │  (Claude)   │  │ (o1, etc.)  │  │   (other models)│  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Routing Rules:**

- `claude-*` → `/v1/messages` (Anthropic format)
- `o1-*`, `o3-*` or reasoning enabled → `/v1/responses` (Responses API)
- Others → `/v1/chat/completions` (OpenAI Chat)

## File Structure

### New Files

```
packages/types/src/
├── providers/
│   └── apertis.ts              # Apertis-specific types and constants

src/api/providers/
├── apertis.ts                  # Main Handler (smart routing)
├── fetchers/
│   └── apertis.ts              # Model list fetcher

webview-ui/src/components/settings/providers/
└── Apertis.tsx                 # Settings UI component
```

### Modified Files

```
packages/types/src/provider-settings.ts    # Add Apertis provider definition
src/api/providers/index.ts                 # Export ApertisHandler
src/api/index.ts                           # Register buildApiHandler case
cli/src/constants/providers/models.ts      # Add Apertis mappings
cli/src/constants/providers/labels.ts      # Add label
cli/src/constants/providers/settings.ts    # Add settings schema
webview-ui/src/i18n/locales/*/settings.json # i18n translations
```

## Provider Settings Schema

```typescript
const apertisSchema = baseProviderSettingsSchema.extend({
	// Authentication
	apertisApiKey: z.string().optional(),

	// Model selection
	apertisModelId: z.string().optional(),

	// Base URL (default: https://api.apertis.ai)
	apertisBaseUrl: z.string().optional(),

	// Responses API specific
	apertisInstructions: z.string().optional(),

	// Reasoning settings
	apertisReasoningEffort: z.enum(["low", "medium", "high"]).optional(),
	apertisReasoningSummary: z.enum(["auto", "concise", "detailed"]).optional(),
})
```

## Constants

```typescript
// packages/types/src/providers/apertis.ts

export const APERTIS_DEFAULT_BASE_URL = "https://api.apertis.ai"
export const apertisDefaultModelId = "claude-sonnet-4-20250514"
```

## Handler Implementation

```typescript
// src/api/providers/apertis.ts

export class ApertisHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private anthropicClient: Anthropic

	constructor(options: ApiHandlerOptions) {
		const baseURL = options.apertisBaseUrl || APERTIS_DEFAULT_BASE_URL

		this.client = new OpenAI({
			baseURL: `${baseURL}/v1`,
			apiKey: options.apertisApiKey,
		})

		this.anthropicClient = new Anthropic({
			baseURL: `${baseURL}/v1`,
			apiKey: options.apertisApiKey,
		})
	}

	private getApiFormat(modelId: string): "messages" | "responses" | "chat" {
		if (modelId.startsWith("claude-")) return "messages"
		if (modelId.startsWith("o1-") || modelId.startsWith("o3-")) return "responses"
		return "chat"
	}

	async *createMessage(systemPrompt, messages, metadata) {
		const format = this.getApiFormat(this.getModel().id)

		switch (format) {
			case "messages":
				yield* this.createAnthropicMessage(systemPrompt, messages, metadata)
				break
			case "responses":
				yield* this.createResponsesMessage(systemPrompt, messages, metadata)
				break
			default:
				yield* this.createChatMessage(systemPrompt, messages, metadata)
		}
	}
}
```

## Model Fetcher

```typescript
// src/api/providers/fetchers/apertis.ts

export async function getApertisModels(options?: { apiKey?: string; baseUrl?: string }): Promise<ModelRecord> {
	const baseUrl = options?.baseUrl || APERTIS_DEFAULT_BASE_URL

	// Use public endpoint (no auth required)
	const response = await fetch(`${baseUrl}/api/models`)
	const data = await response.json()

	const models: ModelRecord = {}

	for (const modelId of data.data) {
		models[modelId] = {
			contextWindow: getContextWindow(modelId),
			supportsPromptCache: modelId.startsWith("claude-"),
			supportsImages: supportsVision(modelId),
		}
	}

	return models
}
```

## UI Settings Component

Key features:

- API Key input with link to `https://apertis.ai/token`
- Model picker with dynamic model list
- Reasoning settings (shown only for o1/o3 models)
- Advanced settings (collapsible) with Base URL option

## Special Features Support

| Feature           | API           | Implementation                     |
| ----------------- | ------------- | ---------------------------------- |
| Extended Thinking | Messages API  | `thinking.budget_tokens` parameter |
| Reasoning Effort  | Responses API | `reasoning.effort` parameter       |
| Reasoning Summary | Responses API | `reasoning.summary` parameter      |
| Instructions      | Responses API | `instructions` parameter           |
| Web Search        | Responses API | `tools` with web_search type       |
| Streaming         | All APIs      | `stream: true` parameter           |

## Error Handling

- Parse Apertis error responses and convert to user-friendly messages
- Handle authentication errors (401) with link to token page
- Handle rate limits (429) with retry suggestion
- Graceful degradation when features not supported by selected API format

## Testing Strategy

1. Unit tests for API format routing logic
2. Unit tests for authentication header selection
3. Integration tests for each API format
4. Mock tests for error handling scenarios

## Implementation Order

1. `packages/types/` - Provider definitions and schema
2. `src/api/providers/apertis.ts` - Core Handler
3. `src/api/providers/fetchers/apertis.ts` - Model fetcher
4. `src/api/index.ts` - Register handler
5. `webview-ui/` - UI settings component
6. `cli/` - CLI integration
7. Tests and documentation

## References

- Apertis API Documentation: https://docs.apertis.ai
- Apertis Token Page: https://apertis.ai/token
- Context7 Library: `/apertis-ai/docs`
