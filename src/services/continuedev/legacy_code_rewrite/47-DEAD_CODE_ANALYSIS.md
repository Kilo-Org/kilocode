# Dead Code Analysis: Unused Flows and Options in Autocomplete/NextEdit

**Analysis Date**: 2025-10-15  
**Scope**: Code that supports flows or options that cannot be exercised by autocomplete or NextEdit consumers

## Executive Summary

This analysis identifies code blocks, configuration options, and entire subsystems that exist in the codebase but **cannot be exercised** by the autocomplete or NextEdit features. While these code paths aren't technically "dead" (they're callable), they represent functionality designed for removed features (chat, GUI, agents, tools, etc.) that can never be triggered through autocomplete/NextEdit workflows.

---

## 1. Tool/Function Calling Support (Largest Finding)

### Overview

Extensive tool calling infrastructure exists across all LLM adapters but is **completely unused** by autocomplete and NextEdit.

### Evidence

- **Autocomplete** only calls: `streamFim()` or `streamComplete()`
- **NextEdit** only calls: `chat()` (for Mercury) and `rerank()` (for editable regions)
- **Neither feature ever passes `tools` parameter** to LLM methods

### Affected Files and Code Blocks

#### Core Interface Definitions

- **`core/index.d.ts`**:
    - Lines 266-273: `ToolCallDelta` interface - never constructed
    - Lines 275-279: `ToolResultChatMessage` interface - never constructed
    - Lines 291: `toolCalls` in `ThinkingChatMessage` - never populated
    - Lines 312: `toolCalls` in `AssistantChatMessage` - never populated
    - Lines 658-673: `Tool` and `ToolChoice` interfaces - never used
    - Lines 685-686: `tools` and `toolChoice` in `BaseCompletionOptions` - never set
    - Lines 691: `tools` capability in `ModelCapability` - never checked for autocomplete/NextEdit

#### LLM Conversion and Handling

- **`core/llm/openaiTypeConverters.ts`**:
    - Lines 14-19: Tool message conversion - never executed (no tool messages)
    - Lines 39-46: Tool calls serialization - never executed
    - Lines 99-110: Tool choice and tools parameter conversion - never executed
    - Lines 154-159: Tool calls in response - never processed
    - Lines 187-204: Tool calls in streaming - never processed

#### Token Counting

- **`core/llm/countTokens.ts`**:
    - Lines 79-91: `countToolsTokens()` function - never called
    - Lines 139-141: Tool call token counting in messages - never executed
    - Lines 155-159: Tool message token counting - never executed
    - Lines 166-215: `extractToolSequence()` function - never called (validates tool sequences)
    - Lines 327-478: Tool sequence preservation logic in `pruneRawPromptFromTop()` - never triggered

#### LLM Adapters - Tool Support Code

**Anthropic Adapter** (`core/llm/openai-adapters/apis/Anthropic.ts`):

- Lines 94-118: Tool filtering and conversion logic - never executed
- Lines 141: `tool_choice` parameter - never set
- Lines 147-160: `convertToolCallsToBlocks()` method - never called
- Lines 220-242: Tool message and tool call block conversion - never executed

**Bedrock Adapter** (`core/llm/openai-adapters/apis/Bedrock.ts`):

- Lines 196-219: Tool message handling in conversation - never executed
- Lines 246-276: Tool call processing - never executed
- Lines 311-344: Tool configuration setup - never executed
- Lines 388-390: Tool config addition to body - never executed
- Lines 412-425: Tool calls in response - never processed
- Lines 494-506: Tool use in streaming deltas - never processed
- Lines 517-530: Tool use start events - never processed

**Gemini Adapter** (`core/llm/openai-adapters/apis/Gemini.ts`):

- Lines 106-114: Tool call ID mapping - never executed
- Lines 124-150: Tool calls to function calls conversion - never executed
- Lines 156-167: Tool messages to function responses - never executed
- Lines 205-222: Tool definitions conversion - never executed
- Lines 326-328: Tool calls in streaming response - never generated

**OpenRouter Caching** (`core/llm/openai-adapters/apis/OpenRouterCaching.ts`):

- Lines 139-142: Tools filtering and conversion - never executed
- Lines 148: Tools in Anthropic body - never set
- Lines 282-291: Tool cache control - never executed

**WatsonX Adapter** (`core/llm/openai-adapters/apis/WatsonX.ts`):

- Lines 162-168: Tools and tool choice parameters - never set

**OpenAI Adapter** (`core/llm/openai-adapters/apis/OpenAI.ts`):

- Lines 57-59: `parallel_tool_calls` parameter - never set

**Anthropic Utils** (`core/llm/openai-adapters/apis/AnthropicUtils.ts`):

- Lines 52-86: `openAiToolChoiceToAnthropicToolChoice()` - never called
- Lines 88-97: `openaiToolToAnthropicTool()` - never called

**Gemini Types** (`core/llm/openai-adapters/util/gemini-types.ts`):

- Lines 129-162: `convertOpenAIToolToGeminiFunction()` - never called

**Anthropic Caching** (`core/llm/openai-adapters/apis/AnthropicCachingStrategies.ts`):

- Lines 56-67: Tool definition caching - never executed
- Lines 92-103: Tool definition caching (conversation) - never executed

#### Message Utilities

- **`core/llm/messages.ts`**:
    - Lines 31: `isUserOrToolMsg()` checking for "tool" role - never returns true for tool
    - Lines 35-42: `messageHasToolCallId()` - never called
    - Lines 56-57: Empty message check for toolCalls - never relevant

#### Core LLM Base Class

- **`core/llm/index.ts`**:
    - Lines 296-303: Tool call rendering in `renderChatMessage()` - never executed
    - Lines 707-708: Tools parameter in `pruneRawPromptFromTop()` - always undefined
    - Lines 757-758: Tools parameter in message compilation - always undefined

**Impact**: Thousands of lines of code across 15+ files supporting tool calling that can never execute.

---

## 2. Image/Multimodal Support

### Overview

Image upload and multimodal content support exists but is **never used** by autocomplete or NextEdit.

### Evidence

- Autocomplete only generates text completions
- NextEdit only generates text diffs
- No code path constructs `ImageMessagePart` objects
- Message content is always strings, never `MessagePart[]` arrays with images

### Affected Files

#### Interface Definitions

- **`core/index.d.ts`**:
    - Lines 257-260: `ImageMessagePart` type - never constructed
    - Lines 262: `MessagePart` union including images - never used with images
    - Lines 264: `MessageContent` allowing image arrays - always strings in practice
    - Lines 689-691: `uploadImage` in `ModelCapability` - never checked

#### LLM Base Class

- **`core/llm/index.ts`**:
    - Line 72-74: `supportsImages()` method - always returns false, never overridden
    - Lines 706-707: `supportsImages` parameter in token counting - always false
    - Lines 756-757: `supportsImages` parameter in message compilation - always false

#### Token Counting

- **`core/llm/countTokens.ts`**:
    - Lines 352-353: `supportsImages` parameter - always false
    - Lines 362-363: `supportsImages` in interface - never true
    - Lines 369-370: `supportsImages` in type definition - never true
    - Lines 376-378: Image stripping logic - never executes (no images present)

#### Autodetection

- **`core/llm/autodetect.ts`**:
    - Lines 114-117: `supportsImages()` capability check - never returns true

#### Message Utilities

- **`core/util/messageContent.ts`**:
    - Line 24: Image stripping for tool messages - never has images
    - Entire file handles `MessagePart[]` but always receives strings

**Impact**: Image support infrastructure that can never be triggered.

---

## 3. Context Provider System

### Overview

Entire context provider subsystem exists for removed chat/GUI features.

### Affected Code

- **`core/index.d.ts`**:
    - Lines 169-183: `ContextProviderType`, `ContextIndexingType`, `ContextProviderDescription` - unused types
    - Lines 187-197: `ContextProviderExtras` interface - never constructed
    - Lines 199-210: Context submenu types - unused
    - Lines 589-621: `ContextProviderName` enum - never used (40+ provider names)

**Impact**: Context provider system designed for GUI that autocomplete/NextEdit don't use.

---

## 4. Configuration Options That Can't Be Exercised

### MinimalConfig Unused Options

- **`core/autocomplete/MinimalConfig.ts`**:
    - Line 31: `rules?: unknown[]` - never set or accessed
    - Lines 22-24: `modelsByRole.autocomplete` - array never populated
    - Lines 26-29: `selectedModelByRole.edit/chat/rerank` - never set (only `autocomplete` used)
    - Lines 118-125: `onConfigUpdate()` stub - never called
    - Lines 130-132: `registerCustomContextProvider()` stub - never called

### LLM Options That Can't Be Set

- **`core/index.d.ts`**:
    - Lines 685-686: `tools` and `toolChoice` in `BaseCompletionOptions` - never set by autocomplete/NextEdit
    - Lines 691: `tools` capability check - never performed for autocomplete/NextEdit models
    - Lines 643-646: `CacheBehavior` interface - defined but never used
    - Lines 684: `prediction` in `BaseCompletionOptions` - never set

### TabAutocompleteOptions Unused/Deprecated

- **`core/util/parameters.ts`**:
    - Lines 11-14: `slidingWindowPrefixPercentage` and `slidingWindowSize` - marked as deprecated, should be removed

**Impact**: Configuration surface area that can't be modified by consumers.

---

## 5. IDE Interface Methods With Limited/No Usage

### Methods That CAN Be Used

These are called by autocomplete/NextEdit, so they ARE exercisable:

- ✅ `getClipboardContent()` - used for clipboard snippets in autocomplete
- ✅ `getIdeInfo()` - used to check IDE type (VSCode vs JetBrains)
- ✅ `gotoDefinition()` - used by autocomplete import definitions
- ✅ `gotoTypeDefinition()` - used by static context service
- ✅ `getSignatureHelp()` - used by static context service
- ✅ `getReferences()` - used by NextEdit editable region calculator
- ✅ `getDocumentSymbols()` - used by NextEdit editable region calculator

### Methods With No Consumers

- **`core/index.d.ts`** Line 587:
    - `onDidChangeActiveTextEditor(callback)` - defined in interface but no autocomplete/NextEdit code registers callbacks

**Note**: Most IDE methods ARE used, so this is not a major area of dead code.

---

## 6. Prompt Templates System (COMPLETELY UNUSED)

### Critical Finding: Property Name Mismatch

The code checks for `promptTemplates.autocomplete` but **only populates `promptTemplates.edit`**:

**Code checks for `.autocomplete` template:**

- [`core/autocomplete/CompletionProvider.ts:170`](core/autocomplete/CompletionProvider.ts:170): `if (llm.promptTemplates?.autocomplete)`
- [`core/nextEdit/NextEditProvider.ts:345`](core/nextEdit/NextEditProvider.ts:345): `if (llm.promptTemplates?.autocomplete)`
- [`core/nextEdit/context/autocompleteContextFetching.ts:113`](core/nextEdit/context/autocompleteContextFetching.ts:113): `if (finalModel.promptTemplates?.autocomplete)`

**But templates only populate `.edit`:**

- [`core/llm/autodetect.ts:390`](core/llm/autodetect.ts:390): `templates.edit = editTemplate;`
- Search for `templates.autocomplete` assignment: **0 results**

**Result**: The condition `if (llm.promptTemplates?.autocomplete)` **NEVER evaluates to true**.

### All Unused Template Files

**Chat Templates**

- **`core/llm/templates/chat.ts`**: Entire file (285 lines)
    - Chat message formatting templates (LLAMA2, Alpaca, Zephyr, Phi2, Chatml, Openchat, Deepseek, etc.)
    - Used for removed chat feature

**Edit Templates**

- **`core/llm/templates/edit.ts`**: Entire file (210 lines)
    - All 15+ edit prompt templates that are populated into `.edit` property but never read
    - `simplifiedEditPrompt`
    - `osModelsEditPrompt`
    - `gptEditPrompt`
    - `phindEditPrompt`
    - `zephyrEditPrompt`
    - `mistralEditPrompt`
    - `alpacaEditPrompt`
    - `deepseekEditPrompt`
    - `openchatEditPrompt`
    - `xWinCoderEditPrompt`
    - `neuralChatEditPrompt`
    - `codeLlama70bEditPrompt`
    - `claudeEditPrompt`
    - `gemmaEditPrompt`
    - `llama3EditPrompt`

**Template Detection Logic**

- **`core/llm/autodetect.ts:338-394`**: `autodetectPromptTemplates()` function
    - Entire function populates `templates.edit` but autocomplete/NextEdit check `templates.autocomplete`
    - 57 lines of template selection logic that outputs to wrong property name

**Impact**: ~500 lines of template code that can never be executed due to property name mismatch between what's set (`.edit`) and what's checked (`.autocomplete`).

---

## 7. Caching Infrastructure (Commented Out/Disabled)

### Overview

Prompt caching infrastructure exists but is **disabled** throughout the codebase.

### Affected Code

- **`core/index.d.ts`**:

    - Lines 643-646: `CacheBehavior` interface - defined but never used

- **`core/llm/openai-adapters/types.ts`**:

    - Lines 60-63: `cacheBehavior` schema - commented out

- **`core/llm/openai-adapters/apis/Bedrock.ts`**:
    - Lines 288-289: Conversation caching - commented out
    - Lines 336-338: System message caching - commented out
    - Line 382: System message cache point - hardcoded to false

**Impact**: Caching feature that was started but never completed/enabled.

---

## 8. Mock/Testing Infrastructure

### Mock Messages and Streams

- **`core/index.d.ts`**:

    - Line 458: `chatStreams?: MockMessage[][]` in `LLMOptions` - used only for testing

- **`core/llm/llms/Mock.ts`**:
    - Lines 36-38: Mock chat filtering for tool messages - test-only code

**Impact**: Test infrastructure mixed with production code (though not harmful).

---

## 9. Unused LLM Interaction Logging Types

### LLM Interaction Events

- **`core/index.d.ts`**:
    - Lines 357-423: Extensive LLM interaction logging types (`LLMInteractionStartChat`, `LLMInteractionStartComplete`, `LLMInteractionChunk`, etc.)
    - Lines 441-447: `ILLMInteractionLog` and `ILLMLogger` interfaces

**Question**: Are these used by the removed GUI/telemetry systems? Need to verify if autocomplete/NextEdit log interactions.

---

## 10. Signature Help and LSP Types

### Used by Static Context

- **`core/index.d.ts`**:
    - Lines 767-807: `SignatureHelp`, `SignatureInformation`, `ParameterInformation` classes
    - ✅ These ARE used by `StaticContextService.ts` line 438

---

## 11. System Prompts for NextEdit Models

### NextEdit System Prompts

- **`core/nextEdit/constants.ts`**:
    - Lines 25-66: `INSTINCT_SYSTEM_PROMPT` - very detailed system prompt for Instinct model
    - Lines 67-68: `MERCURY_SYSTEM_PROMPT` - system prompt for Mercury model

**Note**: These ARE used by NextEdit, so they're not dead code.

---

## Summary Statistics

### High-Impact Findings (1000+ lines each)

1. **Tool/Function calling infrastructure**: ~2000+ lines across 15+ files
2. **Prompt templates system** (property mismatch): ~500 lines across 2 files + detection logic

### Medium-Impact Findings (100-1000 lines)

3. **Image/multimodal support**: ~100 lines across 5 files
4. **Context provider system**: ~100 lines of type definitions
5. **LLM interaction logging**: ~100 lines of type definitions

### Low-Impact Findings (<100 lines)

6. **Configuration options**: ~50 lines that can't be set
7. **Caching infrastructure**: ~50 lines commented out/disabled
8. **Deprecated options**: 2 deprecated parameters
9. **IDE callback registration**: 1 unused method

### Total Estimate

**~3000+ lines** of code supporting flows and options that cannot be exercised by autocomplete or NextEdit.

---

## Recommendations

### Priority 1: Remove Tool Calling Support

- Remove all tool/function calling code from LLM adapters
- Remove tool-related types from `core/index.d.ts`
- Remove tool parameter handling from `openaiTypeConverters.ts`
- Remove tool token counting from `countTokens.ts`

### Priority 2: Remove Prompt Templates Entirely

- **Critical**: The entire template system has a property name mismatch
- Remove `core/llm/templates/chat.ts` (285 lines)
- Remove `core/llm/templates/edit.ts` (210 lines)
- Remove `autodetectPromptTemplates()` from `core/llm/autodetect.ts`
- Remove `promptTemplates` property checks from autocomplete/NextEdit code

### Priority 3: Remove Image Support

- Remove `supportsImages()` method and related checks
- Remove `ImageMessagePart` type
- Simplify `MessageContent` to always be `string`
- Remove image handling from message utilities

### Priority 4: Remove Context Provider System

- Remove context provider types from `core/index.d.ts`
- Remove `ContextProviderExtras`, `ContextProviderDescription`, etc.

### Priority 5: Clean Up Configuration

- Remove unused options from `MinimalConfig`
- Remove deprecated parameters from `TabAutocompleteOptions`
- Remove `CacheBehavior` and related commented code

---

## Verification Needed

The following items need additional investigation:

1. **LLM interaction logging**: Do autocomplete/NextEdit log interactions using the `ILLMInteractionLog` system?
2. **Prediction parameter**: Is the `prediction` parameter in `BaseCompletionOptions` ever used?
3. **Custom LLM support**: Is the `CustomLLM` type and related code actually used?

---

## Conclusion

This analysis identifies approximately **3000+ lines** of code and numerous configuration options that support flows which cannot be exercised by autocomplete or NextEdit. The largest findings are:

1. **Tool calling infrastructure** (~2000 lines) - comprehensive but never invoked
2. **Prompt templates system** (~500 lines) - property name mismatch makes entire system unusable

The most critical finding is the prompt templates: autocomplete/NextEdit check for `promptTemplates.autocomplete` but the code only ever sets `promptTemplates.edit`. This means **all 15+ edit templates and the entire template detection system are completely unused** due to this mismatch.

These findings represent "non-exercisable code" rather than strictly "dead code" - the functions exist and could be called, but the autocomplete/NextEdit workflows never trigger them. Removing this code would:

1. **Reduce cognitive load** for developers
2. **Improve test coverage** (fewer untested code paths)
3. **Reduce bundle size** for deployments
4. **Simplify maintenance** (fewer dependencies and abstractions)

The next step is to verify the "Verification Needed" items and then proceed with systematic removal following the priority order above.
