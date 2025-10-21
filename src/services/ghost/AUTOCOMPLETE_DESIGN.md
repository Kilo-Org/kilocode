# Ghost Autocomplete Design

## Overview

The Ghost autocomplete system provides code suggestions using two visualization methods:

1. **Inline Ghost Completions** - Native VS Code ghost text that completes the current line/code at cursor
2. **SVG Decorations** - Visual overlays showing additions, deletions, and modifications elsewhere in the file

## Decision Logic

The system chooses between inline ghost completions and SVG decorations based on these rules:

### Only Additions Mode (Default)

**Only Additions Mode** (enabled by default): When `onlyAdditions` setting is enabled (default: true), the system only shows:

- Pure addition operations (`+`)
- Modifications (`/`) where the added content starts with the deleted content (common prefix completions)

All other modifications and deletions are filtered out and will not be shown at all.

This is the default behavior to keep autocomplete focused on forward-only suggestions near the cursor, preventing disruptive replacements.

### When to Use Inline Ghost Completions

Inline ghost completions are shown when ALL of the following conditions are met:

1. **Filtering Check**: Group passes the `onlyAdditions` filter (if enabled)
2. **Distance Check**: Suggestion is within 5 lines of the cursor
3. **Operation Type**:
    - **Pure Additions** (`+`): Always use inline when near cursor and passes filter
    - **Modifications** (`/`): Use inline when there's a common prefix between old and new content
    - **Deletions** (`-`): Never use inline (always use SVG when visible)

### When to Use SVG Decorations

SVG decorations are shown when:

- Suggestion is more than 5 lines away from cursor
- Operation is a deletion (`-`) (only when `onlyAdditions` is disabled)
- Operation is a modification (`/`) with no common prefix (only when `onlyAdditions` is disabled)
- Any non-selected suggestion group in the file (when inline completion is not active)

**Important**: When inline completion is active for the selected group, ALL other groups are hidden from SVG decorations to prevent showing multiple suggestions simultaneously.

### Mutual Exclusivity

**Important**: The system NEVER shows both inline ghost completion and SVG decoration for the same suggestion. When a suggestion qualifies for inline ghost completion, it is explicitly excluded from SVG decoration rendering.

## Implementation Details

### Flow

1. **Suggestion Generation** (`GhostProvider.provideCodeSuggestions()`)

    - LLM generates suggestions as search/replace operations
    - Operations are parsed and grouped by the `GhostStreamingParser`
    - Suggestions are stored in `GhostSuggestionsState`

2. **Rendering Decision** (`GhostProvider.render()`)

    - Updates inline completion provider with current suggestions
    - Uses `shouldTriggerInline()` to determine if inline completion should be shown
    - Triggers or hides VS Code inline suggest command accordingly
    - Calls `displaySuggestions()` to show SVG decorations for appropriate groups

3. **Inline Completion Provider** (`GhostInlineCompletionProvider.provideInlineCompletionItems()`)

    - VS Code calls this when inline suggestions are requested
    - Filters suggestions based on `onlyAdditions` setting
    - Handles IntelliSense detection to prevent conflicts
    - Returns completion item with:
        - Text to insert (without common prefix for modifications)
        - Range to insert at (cursor position or calculated position)
        - Command to accept suggestion

4. **SVG Decoration Display** (`GhostProvider.displaySuggestions()`)

    - Gets skip indices from inline completion provider via `getSkipGroupIndices()`
    - Skip indices include:
        - Groups filtered by `onlyAdditions` setting
        - Selected group if using inline completion
        - ALL other groups when inline completion is active (prevents multiple suggestions)
    - Passes skip indices to `GhostDecorations.displaySuggestions()`
    - SVG decorations render only non-skipped groups

5. **IntelliSense Conflict Prevention**
    - Inline provider detects IntelliSense via `context.selectedCompletionInfo`
    - Calls `onIntelliSenseDetected()` callback when detected
    - Ghost provider cancels suggestions to prevent conflicts
    - Ensures IntelliSense takes priority

## Examples

### Example 1: Single-Line Completion (Modification with Common Prefix)

**User types:**

```javascript
const y =
```

**LLM Response:**

```xml
<change>
  <search><![CDATA[const y =<<<AUTOCOMPLETE_HERE>>>]]></search>
  <replace><![CDATA[const y = divideNumbers(4, 2);]]></replace>
</change>
```

**Result:**

- Operation type: Modification (`/`)
- Common prefix: `const y =`
- Distance from cursor: 0 lines
- **Shows**: Inline ghost completion with ` divideNumbers(4, 2);`
- **Does not show**: SVG decoration

**Visual:**

```javascript
const y = divideNumbers(4, 2);
         ^^^^^^^^^^^^^^^^^^^^^^ (ghost text)
```

Additional examples:
• const x = 1 → const x = 123: Shows ghost "23" after cursor
• function foo → function fooBar: Shows ghost "Bar" after cursor

### Example 2: Multi-Line Addition

**User types:**

```javascript
// Add error handling
```

**LLM Response:**

```xml
<change>
  <search><![CDATA[// Add error handling<<<AUTOCOMPLETE_HERE>>>]]></search>
  <replace><![CDATA[// Add error handling
try {
  const result = processData();
  return result;
} catch (error) {
  console.error('Error:', error);
}]]></replace>
</change>
```

**Result:**

- Operation type: Modification with empty deleted content (treated as addition)
- Distance from cursor: 0-1 lines
- **Shows**: Inline ghost completion with multi-line code
- **Does not show**: SVG decoration

**Visual:**

```javascript
// Add error handling
try {
  const result = processData();
  return result;
} catch (error) {
  console.error('Error:', error);
}
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ (all ghost text)
```

### Example 3: Pure Addition After Comment

**User types:**

```javascript
// implement function to add two numbers
```

**LLM Response:**

```xml
<change>
  <search><![CDATA[<<<AUTOCOMPLETE_HERE>>>]]></search>
  <replace><![CDATA[function addNumbers(a: number, b: number): number {
  return a + b;
}]]></replace>
</change>
```

**Result:**

- Operation type: Modification with placeholder-only deleted content (treated as pure addition)
- Distance from cursor: 1 line (next line after comment)
- **Shows**: Inline ghost completion on next line with function implementation
- **Does not show**: SVG decoration

**Visual:**

```javascript
// implement function to add two numbers
function addNumbers(a: number, b: number): number {
  return a + b;
}
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ (all ghost text on next line)
```

### Example 4: Replacement Without Common Prefix

**User has:**

```javascript
var x = 10
```

**LLM suggests:**

```javascript
const x = 10
```

**Result:**

- Operation type: Modification (`/`)
- Common prefix: `` (empty - no match)
- **Shows**: SVG decoration with red strikethrough on `var` and green highlight on `const`
- **Does not show**: Inline ghost completion

### Example 5: Far Away Addition

**User cursor at line 1, suggestion at line 50:**

**Result:**

- Distance from cursor: 49 lines (>5)
- **Shows**: SVG decoration at line 50
- **Does not show**: Inline ghost completion

### Example 6: Multiple Suggestions in File

**File has 3 suggestion groups:**

1. Line 5 (selected, near cursor)
2. Line 20 (not selected)
3. Line 40 (not selected)

**Result:**

- **Line 5**: Shows inline ghost completion (selected + near cursor)
- **Line 20**: Shows SVG decoration (not selected)
- **Line 40**: Shows SVG decoration (not selected)

## Current Implementation Status

✅ **Fully Implemented and Working:**

- **Only Additions Mode** (default): Filters suggestions to show only pure additions and common prefix completions
- **Inline ghost completions** for pure additions near cursor
- **Inline ghost completions** for modifications with common prefix near cursor
- **Inline ghost completions** for comment-driven completions (placeholder-only modifications)
- **SVG decorations** for deletions (when `onlyAdditions` disabled)
- **SVG decorations** for far suggestions (>5 lines)
- **SVG decorations** for modifications without common prefix (when `onlyAdditions` disabled)
- **SVG decorations** for non-selected groups (when inline completion not active)
- **Mutual exclusivity** between inline and SVG - only one suggestion shown at a time
- **IntelliSense conflict prevention** - detects and cancels ghost suggestions when IntelliSense is active
- **TAB navigation** through valid suggestions (skips placeholder groups and filtered groups)
- **Universal language support** (not limited to JavaScript/TypeScript)
- **Multi-line completion handling** with proper newline prefixes
- **Synthetic group creation** for separated deletion+addition pairs with common prefix

## Code Architecture

### **Main Provider**: [`src/services/ghost/GhostProvider.ts`](src/services/ghost/GhostProvider.ts)

**Core Methods:**

- [`render()`](src/services/ghost/GhostProvider.ts:427): Main rendering coordinator - delegates to inline provider and decorations
- [`displaySuggestions()`](src/services/ghost/GhostProvider.ts:475): Gets skip indices from inline provider and displays decorations
- [`selectNextSuggestion()`](src/services/ghost/GhostProvider.ts:618) / [`selectPreviousSuggestion()`](src/services/ghost/GhostProvider.ts:645): TAB navigation using inline provider's valid group finders
- [`provideCodeSuggestions()`](src/services/ghost/GhostProvider.ts:309): Main suggestion generation flow
- [`onIntelliSenseDetected()`](src/services/ghost/GhostProvider.ts:769): Cancels suggestions when IntelliSense detected

**Event Handlers:**

- [`handleTypingEvent()`](src/services/ghost/GhostProvider.ts:779): Auto-trigger logic with IntelliSense conflict prevention
- [`onDidChangeTextEditorSelection()`](src/services/ghost/GhostProvider.ts:261): Clears timer on selection changes

### **Inline Completion**: [`src/services/ghost/GhostInlineCompletionProvider.ts`](src/services/ghost/GhostInlineCompletionProvider.ts)

**Decision Logic:**

- [`shouldShowGroup()`](src/services/ghost/GhostInlineCompletionProvider.ts:59): Implements `onlyAdditions` filtering logic
- [`shouldUseInlineCompletion()`](src/services/ghost/GhostInlineCompletionProvider.ts:104): Centralized decision for inline vs SVG
- [`shouldTriggerInline()`](src/services/ghost/GhostInlineCompletionProvider.ts:186): Determines if inline should be triggered
- [`getSkipGroupIndices()`](src/services/ghost/GhostInlineCompletionProvider.ts:214): Returns groups to skip in SVG decorations

**Group Navigation:**

- [`findNextValidGroup()`](src/services/ghost/GhostInlineCompletionProvider.ts:297): Finds next valid group to show
- [`findPreviousValidGroup()`](src/services/ghost/GhostInlineCompletionProvider.ts:334): Finds previous valid group to show
- [`selectClosestValidGroup()`](src/services/ghost/GhostInlineCompletionProvider.ts:371): Ensures selected group is valid

**Content Calculation:**

- [`getEffectiveGroup()`](src/services/ghost/GhostInlineCompletionProvider.ts:405): Handles separated deletion+addition groups, creates synthetic groups
- [`getCompletionText()`](src/services/ghost/GhostInlineCompletionProvider.ts:567): Calculates ghost text content with proper prefix/suffix handling
- [`getInsertionRange()`](src/services/ghost/GhostInlineCompletionProvider.ts:682): Determines where to insert completion
- [`shouldTreatAsAddition()`](src/services/ghost/GhostInlineCompletionProvider.ts:552): Determines if deletion+addition should be treated as pure addition

**Main Entry Point:**

- [`provideInlineCompletionItems()`](src/services/ghost/GhostInlineCompletionProvider.ts:725): VS Code API entry point with IntelliSense detection

**Utilities:**

- [`isPlaceholderOnlyDeletion()`](src/services/ghost/GhostInlineCompletionProvider.ts:45): Checks for placeholder-only deletions
- [`findCommonPrefix()`](src/services/ghost/GhostInlineCompletionProvider.ts:394): Finds common prefix between strings

### **SVG Decorations**: [`src/services/ghost/GhostDecorations.ts`](src/services/ghost/GhostDecorations.ts)

- [`displaySuggestions()`](src/services/ghost/GhostDecorations.ts:73): Shows decorations with skip indices filtering
- [`displayEditOperationGroup()`](src/services/ghost/GhostDecorations.ts:30): Displays modifications with diff highlighting
- [`displayAdditionsOperationGroup()`](src/services/ghost/GhostDecorations.ts:144): Displays pure additions with highlighting
- [`createDeleteOperationRange()`](src/services/ghost/GhostDecorations.ts:57): Creates deletion ranges (when visible)

## Testing

Comprehensive test coverage across multiple test files:

**[`GhostInlineCompletionProvider.spec.ts`](src/services/ghost/__tests__/GhostInlineCompletionProvider.spec.ts):**

- Comment-driven completions
- Modifications with/without common prefix
- Distance-based decisions
- Multiple suggestion scenarios
- Edge cases for inline completion

**[`GhostStreamingParser.test.ts`](src/services/ghost/__tests__/GhostStreamingParser.test.ts):**

- XML parsing of LLM responses
- Operation grouping logic
- Multi-group scenarios

**[`GhostStreamingIntegration.test.ts`](src/services/ghost/__tests__/GhostStreamingIntegration.test.ts):**

- End-to-end streaming scenarios
- Integration between parser and provider

**Test Coverage:** Comprehensive coverage across the ghost autocomplete system

## Key Features

### Only Additions Mode

The `onlyAdditions` setting (default: true) provides a focused, non-disruptive autocomplete experience:

- Shows only forward-progressing suggestions (pure additions)
- Allows common prefix completions (e.g., "functio" → "function foo()")
- Hides all destructive changes (deletions, replacements without common prefix)
- Reduces cognitive load by keeping suggestions simple

### IntelliSense Conflict Prevention

The system actively prevents conflicts with VS Code's native IntelliSense:

- Detects when IntelliSense is showing suggestions via `context.selectedCompletionInfo`
- Automatically cancels ghost suggestions when IntelliSense is active
- Ensures IntelliSense takes priority for immediate, context-specific completions
- Explicitly hides cached inline suggestions during typing to prevent conflicts

### Mutual Exclusivity

The system ensures only one suggestion is visible at a time:

- When inline completion is shown for selected group, ALL other groups are hidden from SVG decorations
- Prevents visual confusion from multiple suggestions
- User sees exactly one actionable suggestion at a time
- TAB key navigates to next valid suggestion

### Synthetic Group Creation

The system intelligently combines separated deletion+addition groups:

- When a deletion and addition group have a common prefix but were separated by grouping logic
- Creates synthetic modification groups for proper inline completion handling
- Ensures common prefix completions work correctly even with separated operations
- Handles edge cases like differing newLine values in operations
