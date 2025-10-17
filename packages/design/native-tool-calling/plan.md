# Native Function Calling Support - Architecture Plan

## Overview

Create reusable helper functions to make it easier for OpenAI-compatible providers to support native function calling (JSON tool style). This approach provides maximum flexibility with minimal coupling between providers.

## Current State

### Working Implementation

[`OpenRouterHandler`](src/api/providers/openrouter.ts) has native function calling working with two key components:

1. **Request Parameters** (lines 216-221):

    - Sets `parallel_tool_calls: false`
    - Conditionally adds `tools` and `tool_choice: "required"` when `toolStyle === "json"`
    - Uses `metadata.allowedTools` from [`ApiHandlerCreateMessageMetadata`](src/api/index.ts:60-83)

2. **Stream Processing** (lines 273-306):
    - Detects `delta.tool_calls` in OpenAI streaming format
    - Validates `toolStyle === "json"`
    - Maps OpenAI tool call deltas to [`ApiStreamNativeToolCallsChunk`](src/api/transform/stream.ts:50-61) format
    - Handles incremental streaming (index-based tracking)

### Providers That Need This

From [`nativeFunctionCallingProviders`](packages/types/src/native-function-calling.ts:1-2):

- ✅ `openrouter` (implemented)
- ✅ `kilocode` (extends OpenRouterHandler)
- ⏳ `lm-studio` (needs implementation)

Additional OpenAI-compatible providers that could benefit:

- [`OpenAiHandler`](src/api/providers/openai.ts) (base OpenAI)
- [`OpenAiNativeHandler`](src/api/providers/openai-native.ts)
- [`BaseOpenAiCompatibleProvider`](src/api/providers/base-openai-compatible-provider.ts) subclasses:
    - `DeepSeekHandler`
    - `GroqHandler`
    - `XAIHandler`
    - `FireworksHandler`
    - `DeepInfraHandler`
    - `FeatherlessHandler`
    - Others using OpenAI SDK

## Solution Architecture

### Helper Module Location

Create [`src/api/providers/kilocode/nativeToolCallHelpers.ts`](src/api/providers/kilocode/nativeToolCallHelpers.ts) alongside existing utilities like [`verifyFinishReason.ts`](src/api/providers/kilocode/verifyFinishReason.ts).

### Helper Functions

#### 1. `addNativeToolCallsToParams`

Augments OpenAI completion params with tool configuration.

```typescript
/**
 * Adds native tool call configuration to OpenAI-compatible request params
 * when toolStyle is "json" and allowedTools are provided.
 *
 * @param params - The request params object to augment
 * @param options - Provider options containing toolStyle setting
 * @param metadata - Request metadata containing allowedTools
 * @returns The augmented params object
 */
function addNativeToolCallsToParams<T extends OpenAI.Chat.ChatCompletionCreateParams>(
	params: T,
	options: { toolStyle?: "xml" | "json" },
	metadata?: ApiHandlerCreateMessageMetadata,
): T
```

**Responsibilities:**

- Set `parallel_tool_calls: false` (required for sequential tool execution)
- Add `tools` array from `metadata.allowedTools` when available
- Add `tool_choice: "required"` to force tool usage
- Only apply when `options.toolStyle === "json"`

#### 2. `processNativeToolCallsFromDelta`

Processes OpenAI streaming deltas to extract and yield tool calls.

```typescript
/**
 * Processes OpenAI chat completion delta to extract native tool calls.
 * Yields ApiStreamNativeToolCallsChunk when tool calls are present.
 *
 * @param delta - The delta from OpenAI streaming response
 * @param toolStyle - Current tool style setting
 * @yields ApiStreamNativeToolCallsChunk if tool calls present
 */
function* processNativeToolCallsFromDelta(
  delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | undefined,
  toolStyle: "xml" | "json" | undefined
): Generator<ApiStreamNativeToolCallsChunk, void, undefined>
```

**Responsibilities:**

- Check if `delta.tool_calls` exists and has items
- Validate that `toolStyle === "json"` (error log if mismatch)
- Filter out invalid tool calls (missing function data)
- Map OpenAI format to [`ApiStreamNativeToolCallsChunk`](src/api/transform/stream.ts:50-61) format:
    - Preserve `index` (for tracking across deltas)
    - Preserve `id` (only in first delta)
    - Preserve `type`
    - Map `function.name` and `function.arguments`
- Yield chunk only if valid tool calls found

### Implementation Details

#### Type Compatibility

- Use OpenAI SDK types: `OpenAI.Chat.ChatCompletionCreateParams`, `ChatCompletionChunk.Choice.Delta`
- Import from `openai` package (already used by all target providers)
- Return types use existing [`ApiStreamChunk`](src/api/transform/stream.ts:1-62) types

#### Error Handling

- Defensive checks for undefined/null values
- Console error when model tries native tools but `toolStyle !== "json"`
- No throwing errors (graceful degradation)

#### Streaming Format

OpenAI's streaming tool call format:

```typescript
// First delta:
{ index: 0, id: 'call_xxx', type: 'function', function: { name: 'toolName', arguments: '' } }

// Subsequent deltas:
{ index: 0, function: { arguments: 'partial json chunk' } }
```

Our unified format accumulates these into complete tool calls.

## Migration Plan

### Phase 1: Create Helpers ✅

- [x] Create [`nativeToolCallHelpers.ts`](src/api/providers/kilocode/nativeToolCallHelpers.ts)
- [x] Implement `addNativeToolCallsToParams` function
- [x] Implement `processNativeToolCallsFromDelta` function
- [x] Add JSDoc documentation with examples

### Phase 2: Update OpenRouter (Reference)

- [ ] Import helpers in [`openrouter.ts`](src/api/providers/openrouter.ts)
- [ ] Replace manual parameter addition (lines 216-221) with `addNativeToolCallsToParams`
- [ ] Replace manual stream processing (lines 273-306) with `processNativeToolCallsFromDelta`
- [ ] Verify functionality with existing tests

### Phase 3: Update Other Providers

- [ ] Update [`lm-studio.ts`](src/api/providers/lm-studio.ts:1-150)
    - Add to [`createMessage`](src/api/providers/lm-studio.ts:41-150) params construction
    - Add to stream processing loop (around line 114)

## Benefits

### For Provider Maintainers

- **Copy-paste simplicity**: Two function calls replace ~40 lines of code
- **Consistency**: Same behavior across all providers
- **Bug fixes propagate**: Fix once, benefit everywhere
- **Less cognitive load**: No need to understand OpenAI streaming format details

### For the Codebase

- **DRY principle**: Single source of truth for tool call handling
- **Maintainability**: Changes to tool calling logic in one place
- **Testing**: Test helpers once thoroughly, trust in providers
- **Flexibility**: Providers can still customize if needed (helpers are additive)

### Example Usage

```typescript
// Before (in provider):
const params = {
	model: modelId,
	messages: convertedMessages,
	stream: true,
	parallel_tool_calls: false,
	...(this.options.toolStyle === "json" &&
		metadata?.allowedTools && {
			tools: metadata.allowedTools,
			tool_choice: "required" as const,
		}),
}

// After:
import { addNativeToolCallsToParams } from "./kilocode/nativeToolCallHelpers"

const params = addNativeToolCallsToParams(
	{
		model: modelId,
		messages: convertedMessages,
		stream: true,
	},
	this.options,
	metadata,
)
```

```typescript
// Before (in stream loop):
if (delta && delta.tool_calls && delta.tool_calls.length > 0) {
  if (this.options.toolStyle === "json") {
    const validToolCalls = delta.tool_calls
      .filter((tc) => tc.function)
      .map((tc) => ({
        index: tc.index,
        id: tc.id,
        type: tc.type,
        function: {
          name: tc.function!.name || "",
          arguments: tc.function!.arguments || "",
        },
      }))
    if (validToolCalls.length > 0) {
      yield { type: "native_tool_calls", toolCalls: validToolCalls }
    }
  } else {
    console.error("Model tried native tools but toolStyle !== 'json'")
  }
}

// After:
import { processNativeToolCallsFromDelta } from "./kilocode/nativeToolCallHelpers"

yield* processNativeToolCallsFromDelta(delta, this.options.toolStyle)
```

## Files to Create/Modify

### Create

- [`src/api/providers/kilocode/nativeToolCallHelpers.ts`](src/api/providers/kilocode/nativeToolCallHelpers.ts) - New helper module

### Modify (Phase 2-3)

- [`src/api/providers/openrouter.ts`](src/api/providers/openrouter.ts) - Reference implementation
- [`src/api/providers/lm-studio.ts`](src/api/providers/lm-studio.ts) - Add support

### Reference (No Changes)

- [`src/api/index.ts`](src/api/index.ts:60-83) - Defines `ApiHandlerCreateMessageMetadata` interface
- [`src/api/transform/stream.ts`](src/api/transform/stream.ts:50-61) - Defines `ApiStreamNativeToolCallsChunk` type
- [`packages/types/src/native-function-calling.ts`](packages/types/src/native-function-calling.ts) - Provider registry
