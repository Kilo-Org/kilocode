# Hole-Filling Strategy - Implementation Checklist

## Phase 1: Core Changes

### 1.1 Update Constants

- [ ] Change `CURSOR_MARKER` in [`ghostConstants.ts`](src/services/ghost/classic-auto-complete/ghostConstants.ts:4) from `"<<<AUTOCOMPLETE_HERE>>>"` to `"<<HOLE>>"`
- [ ] Search codebase for any hardcoded references to old marker string

### 1.2 Update AutoTriggerStrategy Prompts

- [ ] Rewrite [`getBaseSystemInstructions()`](src/services/ghost/classic-auto-complete/AutoTriggerStrategy.ts:6) to describe `<HOLE>content</HOLE>` format

    - Remove all search/replace XML format instructions
    - Remove CDATA wrapper instructions
    - Add clear hole-filling format specification
    - Emphasize single hole at cursor position

- [ ] Update [`getUserPrompt()`](src/services/ghost/classic-auto-complete/AutoTriggerStrategy.ts:95) method

    - Change all references from `<<<AUTOCOMPLETE_HERE>>>` to `<<HOLE>>`
    - Simplify instructions for hole-filling approach
    - Remove search block requirements

- [ ] Update [`getCommentsSystemInstructions()`](src/services/ghost/classic-auto-complete/AutoTriggerStrategy.ts:127) method

    - Adapt for hole-filling format
    - Remove search/replace references

- [ ] Update [`getCommentsUserPrompt()`](src/services/ghost/classic-auto-complete/AutoTriggerStrategy.ts:152) method
    - Change cursor marker references to `<<HOLE>>`

## Phase 2: Parser Rewrite

### 2.1 Create New Extraction Logic

- [ ] Create new `extractHoleContent()` function in [`GhostStreamingParser.ts`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:1)
    - Parse `<HOLE>content</HOLE>` tags using regex
    - Return extracted content string
    - Handle incomplete streaming (partial tags)
    - Handle empty hole content

### 2.2 Simplify Main Parser

- [ ] Rewrite [`parseGhostResponse()`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:216) function
    - Replace `extractCompletedChanges()` call with `extractHoleContent()`
    - Directly construct suggestion from hole content
    - Remove complex change application logic
    - Simplify to just insert hole content at cursor position

### 2.3 Update Sanitization

- [ ] Simplify [`sanitizeXMLConservative()`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:23) function

    - Remove CDATA sanitization logic
    - Add logic to close incomplete `<HOLE>` tags
    - Add logic to close incomplete `</HOLE>` tags

- [ ] Update [`isResponseComplete()`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:66) function
    - Check for complete `<HOLE>...</HOLE>` structure
    - Remove search/replace/change tag checks

### 2.4 Remove Obsolete Code

- [ ] Remove [`extractCompletedChanges()`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:250) function
- [ ] Remove [`findBestMatch()`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:84) function and related helpers:
    - `isNewline()`
    - `isNonNewlineWhitespace()`
    - `skipChars()`
- [ ] Remove [`generateModifiedContent()`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:263) function
- [ ] Remove [`ParsedChange`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:11) interface
- [ ] Remove [`MatchResult`](src/services/ghost/classic-auto-complete/GhostStreamingParser.ts:75) interface

## Phase 3: Test Updates

### 3.1 Update AutoTriggerStrategy Tests

- [ ] Update [`AutoTriggerStrategy.test.ts`](src/services/ghost/classic-auto-complete/__tests__/AutoTriggerStrategy.test.ts:1)
    - Change all marker references to `<<HOLE>>`
    - Update prompt expectation tests

### 3.2 Update Parser Tests

- [ ] Rewrite [`GhostStreamingParser.test.ts`](src/services/ghost/classic-auto-complete/__tests__/GhostStreamingParser.test.ts:1)

    - Replace search/replace test cases with hole-filling tests
    - Add tests for `extractHoleContent()` function
    - Test incomplete hole tags during streaming
    - Test empty hole content
    - Test hole with special characters

- [ ] Update [`GhostStreamingParser.sanitization.test.ts`](src/services/ghost/classic-auto-complete/__tests__/GhostStreamingParser.sanitization.test.ts:1)

    - Adapt sanitization tests for hole format
    - Remove CDATA-related tests
    - Add tests for incomplete hole tag sanitization

- [ ] Update [`GhostStreamingParser.fuzzy-length-bug.test.ts`](src/services/ghost/classic-auto-complete/__tests__/GhostStreamingParser.fuzzy-length-bug.test.ts:1)

    - Adapt or remove (fuzzy matching no longer needed)

- [ ] Update [`GhostStreamingParser.user-issue.test.ts`](src/services/ghost/classic-auto-complete/__tests__/GhostStreamingParser.user-issue.test.ts:1)
    - Adapt user issue tests for hole format

### 3.3 Run Test Suite

- [ ] Run all tests: `cd src && npx vitest run services/ghost/classic-auto-complete/__tests__/`
- [ ] Fix any failing tests
- [ ] Ensure 100% test coverage maintained

## Phase 4: Integration & Validation

### 4.1 Manual Testing

- [ ] Test with actual LLM responses in development
- [ ] Verify streaming behavior works correctly
- [ ] Test comment-driven development flow
- [ ] Test auto-trigger scenarios
- [ ] Test edge cases (empty responses, malformed XML, etc.)

### 4.2 Documentation

- [ ] Update any inline documentation referencing old format
- [ ] Add comments explaining hole-filling approach
- [ ] Document breaking change for release notes

## Phase 5: Cleanup

- [ ] Search for any remaining references to old marker format
- [ ] Remove the plan markdown files (`hole-filling-strategy-plan.md`, `hole-filling-todo.md`)
- [ ] Final test run to ensure everything works

## Success Criteria

- ✅ All tests pass
- ✅ LLM correctly responds with `<HOLE>content</HOLE>` format
- ✅ Suggestions appear correctly at cursor position
- ✅ Streaming works without errors
- ✅ No references to old search/replace format remain
- ✅ Code is cleaner and simpler than before
