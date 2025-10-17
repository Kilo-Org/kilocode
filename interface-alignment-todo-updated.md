# Interface Alignment TODO: Ghost → CompletionProvider-like API (UPDATED)

## Goal

Align AutoTriggerStrategy and GhostStreamingParser interfaces with CompletionProvider's API pattern. Output `AutocompleteOutcome` and translate back to `GhostSuggestionsState` for UI.

## Key Changes from Original Plan

- **Single Output**: GhostStreamingParser outputs `AutocompleteOutcome` only
- **Translation Layer**: Add `AutocompleteOutcome → GhostSuggestionsState` converter for UI
- **Type Duplication**: Duplicate types in Ghost to avoid coupling with continuedev
- **Testing**: Only test new code, not existing functionality

## Git Workflow

1. Copy planning documents to safe location
2. `git checkout main`
3. `git pull`
4. `git checkout -b feature/ghost-interface-alignment`
5. Restore planning documents
6. Commit planning documents first
7. Implement changes in phases

---

## Implementation Plan

### Phase 1: Create Shared Types & Conversion Utilities

**File: `src/services/ghost/types.ts`**

- [ ] Duplicate `AutocompleteInput` interface from continuedev
- [ ] Duplicate `AutocompleteOutcome` interface from continuedev
- [ ] Add `PromptResult` interface:
    ```typescript
    interface PromptResult {
    	systemPrompt: string
    	userPrompt: string
    	prefix: string
    	suffix: string
    	completionId: string
    }
    ```
- [ ] Add conversion utilities:
    - `contextToAutocompleteInput(context: GhostSuggestionContext): AutocompleteInput`
    - `extractPrefixSuffix(document: TextDocument, position: Position): { prefix: string, suffix: string }`
    - `autocompleteOutcomeToSuggestions(outcome: AutocompleteOutcome, document: TextDocument): GhostSuggestionsState`

**Tests:**

- [ ] Create `src/services/ghost/__tests__/types.conversion.test.ts`
- [ ] Test `contextToAutocompleteInput()` conversion
- [ ] Test `extractPrefixSuffix()` with edge cases
- [ ] Test `autocompleteOutcomeToSuggestions()` conversion

---

### Phase 2: Update AutoTriggerStrategy (BREAKING CHANGE)

**File: `src/services/ghost/strategies/AutoTriggerStrategy.ts`**

**Changes:**

- [ ] Change `getPrompts(context: GhostSuggestionContext)` to `getPrompts(input: AutocompleteInput): PromptResult`
- [ ] Extract prefix/suffix from input instead of document
- [ ] Update `getUserPrompt()` to use prefix/suffix
- [ ] Update `getCommentsUserPrompt()` similarly
- [ ] Return `PromptResult` with prefix/suffix included
- [ ] Update `shouldTreatAsComment()` to work with prefix

**Tests:**

- [ ] Update `src/services/ghost/strategies/__tests__/AutoTriggerStrategy.test.ts`
- [ ] Test prompts with new input format
- [ ] Test prefix/suffix are correctly included in result

---

### Phase 3: Update GhostStreamingParser (BREAKING CHANGE)

**File: `src/services/ghost/GhostStreamingParser.ts`**

**Changes:**

- [ ] Change `initialize(context: GhostSuggestionContext)` to `initialize(input: AutocompleteInput, prefix: string, suffix: string)`
- [ ] Store `input`, `prefix`, `suffix` as private fields
- [ ] Change `processChunk()` return type to include `AutocompleteOutcome | undefined`
- [ ] Change `finishStream()` return type similarly
- [ ] Remove `generateSuggestions()` method (no longer needed)
- [ ] Add `generateCompletionString()` method that converts parsed changes to completion text
- [ ] Update `processChunk()` to build `AutocompleteOutcome` instead of `GhostSuggestionsState`

**New Interface:**

```typescript
interface StreamingParseResult {
	outcome: AutocompleteOutcome | undefined
	isComplete: boolean
	hasNewContent: boolean
}
```

**Tests:**

- [ ] Update `src/services/ghost/__tests__/GhostStreamingParser.test.ts`
- [ ] Test `AutocompleteOutcome` generation
- [ ] Test completion string generation from diffs
- [ ] Ensure existing test cases still work with new output

---

### Phase 4: Create Translation Layer

**File: `src/services/ghost/GhostOutcomeTranslator.ts` (NEW)**

**Purpose:** Convert `AutocompleteOutcome` back to `GhostSuggestionsState` for UI

**Implementation:**

- [ ] Create `GhostOutcomeTranslator` class
- [ ] Add `translate(outcome: AutocompleteOutcome, document: TextDocument): GhostSuggestionsState` method
- [ ] Parse completion string and apply to document
- [ ] Generate diff operations (add/delete lines)
- [ ] Return `GhostSuggestionsState` compatible with existing UI

**Algorithm:**

1. Get current document content
2. Apply completion at cursor position
3. Generate unified diff between original and modified
4. Convert diff to `GhostSuggestionsState` format

**Tests:**

- [ ] Create `src/services/ghost/__tests__/GhostOutcomeTranslator.test.ts`
- [ ] Test simple completions (single line)
- [ ] Test multi-line completions
- [ ] Test completions with deletions
- [ ] Verify output matches UI expectations

---

### Phase 5: Update GhostProvider (BREAKING CHANGE)

**File: `src/services/ghost/GhostProvider.ts`**

**Changes:**

- [ ] Add `private outcomeTranslator: GhostOutcomeTranslator` field
- [ ] Add `convertToAutocompleteInput(document: TextDocument, range?: Range): AutocompleteInput` helper
- [ ] Update `codeSuggestion()` to create `AutocompleteInput`
- [ ] Update `provideCodeSuggestions()` to accept `AutocompleteInput`
- [ ] Update call to `autoTriggerStrategy.getPrompts()` with new signature
- [ ] Extract prefix/suffix from `PromptResult`
- [ ] Update `streamingParser.initialize()` call with new parameters
- [ ] After streaming, get `AutocompleteOutcome` from parser
- [ ] Use `outcomeTranslator.translate()` to convert to `GhostSuggestionsState`
- [ ] Update telemetry to use `AutocompleteOutcome` data

**Tests:**

- [ ] Update `src/services/ghost/__tests__/GhostProvider.spec.ts`
- [ ] Test `convertToAutocompleteInput()` conversion
- [ ] Test full flow with translation layer
- [ ] Verify UI still receives correct suggestions

---

### Phase 6: Update GhostContext

**File: `src/services/ghost/GhostContext.ts`**

**Changes:**

- [ ] Update `generate()` to also return `AutocompleteInput`
- [ ] Or create `generateAutocompleteInput()` as alternative method
- [ ] Ensure recent operations are captured in `recentlyEditedRanges`

**Tests:**

- [ ] Add tests for `AutocompleteInput` generation
- [ ] Verify recent operations are correctly captured

---

### Phase 7: Integration & Testing

**Integration Tests:**

- [ ] Create `src/services/ghost/__tests__/integration.alignment.test.ts`
- [ ] Test full flow: VSCode event → AutocompleteInput → Prompts → Streaming → Outcome → Translation → UI
- [ ] Test with real-world scenarios (typing, comments, multi-line)

**Regression Tests:**

- [ ] Run all existing Ghost tests: `cd src && npx vitest run services/ghost/__tests__/`
- [ ] Verify UI still displays suggestions correctly
- [ ] Test auto-trigger functionality
- [ ] Test manual trigger (keybinding)

---

## Architecture After Changes

```
VSCode Event
    ↓
GhostProvider.convertToAutocompleteInput()
    ↓
AutocompleteInput
    ↓
AutoTriggerStrategy.getPrompts()
    ↓
PromptResult (with prefix/suffix)
    ↓
LLM Streaming
    ↓
GhostStreamingParser.processChunk()
    ↓
AutocompleteOutcome
    ↓
GhostOutcomeTranslator.translate()
    ↓
GhostSuggestionsState
    ↓
UI Decorations
```

---

## Success Criteria

- [ ] All existing Ghost tests pass
- [ ] New conversion/translation tests have coverage
- [ ] No performance regression
- [ ] UI continues to work identically
- [ ] `AutocompleteInput` and `AutocompleteOutcome` are properly populated
- [ ] Ready for CompletionProvider swap next week

---

## Files to Create/Modify

### New Files:

- `src/services/ghost/GhostOutcomeTranslator.ts`
- `src/services/ghost/__tests__/GhostOutcomeTranslator.test.ts`
- `src/services/ghost/__tests__/types.conversion.test.ts`
- `src/services/ghost/__tests__/integration.alignment.test.ts`

### Modified Files:

- `src/services/ghost/types.ts`
- `src/services/ghost/strategies/AutoTriggerStrategy.ts`
- `src/services/ghost/GhostStreamingParser.ts`
- `src/services/ghost/GhostProvider.ts`
- `src/services/ghost/GhostContext.ts`
- `src/services/ghost/strategies/__tests__/AutoTriggerStrategy.test.ts`
- `src/services/ghost/__tests__/GhostStreamingParser.test.ts`
- `src/services/ghost/__tests__/GhostProvider.spec.ts`
