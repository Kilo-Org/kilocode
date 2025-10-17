# Interface Alignment TODO: Ghost → CompletionProvider-like API

## Goal

Align AutoTriggerStrategy and GhostStreamingParser interfaces with CompletionProvider's API pattern, while maintaining diff-based output for the UI.

## Breaking Changes to Confirm

Before implementation, we need approval for these breaking changes:

1. **AutoTriggerStrategy.getPrompts()** signature change:

    - FROM: `getPrompts(context: GhostSuggestionContext): { systemPrompt: string, userPrompt: string }`
    - TO: `getPrompts(input: AutocompleteInput): PromptResult`
    - Where `PromptResult = { systemPrompt: string, userPrompt: string, prefix: string, suffix: string }`

2. **GhostStreamingParser** output enhancement:

    - Add `toAutocompleteOutcome()` method that converts `GhostSuggestionsState` to `AutocompleteOutcome`
    - Keep existing `processChunk()` returning `StreamingParseResult` for UI compatibility

3. **GhostProvider.provideCodeSuggestions()** signature:
    - Accept `AutocompleteInput` instead of `GhostSuggestionContext`
    - Internal conversion from VSCode context to `AutocompleteInput`

## Implementation Plan

### Phase 1: Create Shared Types (No Breaking Changes)

**File: `src/services/ghost/types.ts`**

- [ ] Add `AutocompleteInput` interface (imported or duplicated from continuedev)
- [ ] Add `AutocompleteOutcome` interface (imported or duplicated from continuedev)
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

**Tests:**

- [ ] Create `src/services/ghost/__tests__/types.conversion.test.ts`
- [ ] Test `contextToAutocompleteInput()` with various document states
- [ ] Test `extractPrefixSuffix()` with edge cases (start/end of file, empty lines)

---

### Phase 2: Update AutoTriggerStrategy (BREAKING CHANGE)

**File: `src/services/ghost/strategies/AutoTriggerStrategy.ts`**

**Breaking Change Approval Needed:**

- Change `getPrompts(context: GhostSuggestionContext)` to `getPrompts(input: AutocompleteInput)`
- Return `PromptResult` instead of `{ systemPrompt, userPrompt }`

**Implementation:**

- [ ] Update method signature to accept `AutocompleteInput`
- [ ] Extract prefix/suffix from input instead of document
- [ ] Update `getUserPrompt()` to use prefix/suffix instead of `formatDocumentWithCursor()`
- [ ] Update `getCommentsUserPrompt()` similarly
- [ ] Return `PromptResult` with prefix/suffix included
- [ ] Update `shouldTreatAsComment()` to work with prefix instead of document

**Tests:**

- [ ] Update `src/services/ghost/strategies/__tests__/AutoTriggerStrategy.test.ts`
- [ ] Verify prompts still contain cursor marker in correct position
- [ ] Test comment detection works with prefix-based approach
- [ ] Verify prefix/suffix are correctly included in result

---

### Phase 3: Enhance GhostStreamingParser (Non-Breaking Addition)

**File: `src/services/ghost/GhostStreamingParser.ts`**

**Non-Breaking Addition:**

- Add new method `toAutocompleteOutcome()` alongside existing methods

**Implementation:**

- [ ] Add `private input: AutocompleteInput | null` field
- [ ] Update `initialize()` to accept both `context` and `input`
- [ ] Add `toAutocompleteOutcome(): AutocompleteOutcome | undefined` method:
    ```typescript
    public toAutocompleteOutcome(): AutocompleteOutcome | undefined {
      if (!this.input || this.completedChanges.length === 0) {
        return undefined
      }

      return {
        completion: this.generateCompletionString(),
        prefix: this.input.manuallyPassPrefix || extractPrefix(...),
        suffix: extractSuffix(...),
        // ... other AutocompleteOutcome fields
        time: 0, // to be set by caller
        modelProvider: 'unknown', // to be set by caller
        modelName: 'unknown', // to be set by caller
        // ... etc
      }
    }
    ```
- [ ] Add `private generateCompletionString(): string` helper that converts diff operations to completion text
- [ ] Keep existing `processChunk()` and `generateSuggestions()` unchanged for UI

**Tests:**

- [ ] Add tests in `src/services/ghost/__tests__/GhostStreamingParser.test.ts`
- [ ] Test `toAutocompleteOutcome()` returns correct completion string
- [ ] Verify prefix/suffix are correctly extracted
- [ ] Test with various diff scenarios (additions, deletions, mixed)
- [ ] Ensure existing tests still pass (no regression)

---

### Phase 4: Update GhostProvider (BREAKING CHANGE)

**File: `src/services/ghost/GhostProvider.ts`**

**Breaking Change Approval Needed:**

- Change `provideCodeSuggestions(initialContext: GhostSuggestionContext)` to accept `AutocompleteInput`
- Add internal conversion from VSCode events to `AutocompleteInput`

**Implementation:**

- [ ] Add `private convertToAutocompleteInput(document: TextDocument, range?: Range): AutocompleteInput` helper
- [ ] Update `codeSuggestion()` to create `AutocompleteInput` before calling `provideCodeSuggestions()`
- [ ] Update `provideCodeSuggestions()` signature to accept `AutocompleteInput`
- [ ] Update call to `autoTriggerStrategy.getPrompts()` to use new signature
- [ ] Extract prefix/suffix from `PromptResult` for model call
- [ ] Store `AutocompleteInput` for outcome generation
- [ ] After streaming completes, call `streamingParser.toAutocompleteOutcome()` for telemetry/logging

**Tests:**

- [ ] Update `src/services/ghost/__tests__/GhostProvider.spec.ts`
- [ ] Test `convertToAutocompleteInput()` conversion
- [ ] Verify existing functionality still works
- [ ] Test that outcome is generated correctly

---

### Phase 5: Update GhostContext (Minor Update)

**File: `src/services/ghost/GhostContext.ts`**

**Implementation:**

- [ ] Update `generate()` to return both `GhostSuggestionContext` and `AutocompleteInput`
- [ ] Or create `generateAutocompleteInput()` as alternative method
- [ ] Ensure recent operations are captured in `AutocompleteInput.recentlyEditedRanges`

**Tests:**

- [ ] Add tests for new conversion method
- [ ] Verify recent operations are correctly captured

---

### Phase 6: Integration & Testing

**Integration Tests:**

- [ ] Create `src/services/ghost/__tests__/integration.alignment.test.ts`
- [ ] Test full flow: VSCode event → AutocompleteInput → Prompts → Streaming → Outcome
- [ ] Verify both old UI path (GhostSuggestionsState) and new outcome path work
- [ ] Test with real-world scenarios (typing, comments, multi-line)

**Performance Tests:**

- [ ] Benchmark conversion overhead
- [ ] Ensure no performance regression in streaming parser
- [ ] Verify memory usage is acceptable

**Regression Tests:**

- [ ] Run all existing Ghost tests: `cd src && npx vitest run services/ghost/__tests__/`
- [ ] Verify UI still displays suggestions correctly
- [ ] Test auto-trigger functionality
- [ ] Test manual trigger (keybinding)

---

## Migration Path for Next Week

Once this alignment is complete, the migration to CompletionProvider becomes straightforward:

1. **Replace AutoTriggerStrategy** with CompletionProvider's prompt generation
2. **Replace GhostStreamingParser** with CompletionProvider's streaming logic
3. **Add diff conversion layer** to convert CompletionProvider's string output to GhostSuggestionsState for UI

The aligned interfaces mean minimal changes to GhostProvider itself.

---

## Rollback Plan

If issues arise:

1. Keep old methods alongside new ones during transition
2. Add feature flag to switch between old/new implementations
3. All changes are in separate commits for easy revert

---

## Success Criteria

- [ ] All existing Ghost tests pass
- [ ] New conversion tests have 100% coverage
- [ ] No performance regression (< 5ms overhead)
- [ ] UI continues to work identically
- [ ] AutocompleteInput and AutocompleteOutcome are properly populated
- [ ] Ready for CompletionProvider swap next week
