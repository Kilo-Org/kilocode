# Ghost Autocomplete Design

## Overview

The Ghost autocomplete system provides code suggestions using two visualization methods:

1. **Inline Ghost Completions** - Native VS Code ghost text that completes the current line/code at cursor
2. **SVG Decorations** - Visual overlays showing additions, deletions, and modifications elsewhere in the file

## Decision Logic

The system chooses between inline ghost completions and SVG decorations based on these rules:

### Only Additions Mode (Default)

**Only Additions Mode** (enabled by default): When `onlyAdditions` setting is enabled, only pure addition operations (`+`) will be suggested and displayed using inline ghost completions. All modifications (`/`) and deletions (`-`) are completely ignored and will not be shown.

This is the default behavior to keep autocomplete focused on pure additions near the cursor.

### When to Use Inline Ghost Completions

Inline ghost completions are shown when ALL of the following conditions are met:

1. **Distance Check**: Suggestion is within 5 lines of the cursor
2. **Operation Type**:
    - **Pure Additions** (`+`): Always use inline when near cursor
    - **Modifications** (`/`): Use inline when there's a common prefix between old and new content (only when `onlyAdditions` is disabled)
    - **Deletions** (`-`): Never use inline (always use SVG, only when `onlyAdditions` is disabled)

### When to Use SVG Decorations

SVG decorations are shown when:

- Suggestion is more than 5 lines away from cursor
- Operation is a deletion (`-`)
- Operation is a modification (`/`) with no common prefix
- Any non-selected suggestion group in the file

### Mutual Exclusivity

**Important**: The system NEVER shows both inline ghost completion and SVG decoration for the same suggestion. When a suggestion qualifies for inline ghost completion, it is explicitly excluded from SVG decoration rendering.

## Implementation Details

### Flow

1. **Suggestion Generation** (`GhostProvider.provideCodeSuggestions()`)

    - LLM generates suggestions as search/replace operations
    - Operations are parsed and grouped by the `GhostStreamingParser`

2. **Rendering Decision** (`GhostProvider.render()`)

    - Determines if selected group should trigger inline completion
    - Checks distance from cursor
    - Checks operation type and common prefix
    - If conditions met, triggers VS Code inline suggest command

3. **Inline Completion Provider** (`GhostInlineCompletionProvider.provideInlineCompletionItems()`)

    - VS Code calls this when inline suggestions are requested
    - Returns completion item with:
        - Text to insert (without common prefix for modifications)
        - Range to insert at (cursor position or calculated position)

4. **SVG Decoration Display** (`GhostProvider.displaySuggestions()`)
    - Calculates if selected group uses inline completion
    - Passes `selectedGroupUsesInlineCompletion` flag to decorations
    - SVG decorations skip the selected group if flag is true

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

- Inline ghost completions for pure additions near cursor
- Inline ghost completions for modifications with common prefix near cursor
- Inline ghost completions for comment-driven completions (placeholder-only modifications)
- SVG decorations for deletions
- SVG decorations for far suggestions (>5 lines)
- SVG decorations for modifications without common prefix
- SVG decorations for non-selected groups
- Mutual exclusivity between inline and SVG for same suggestion
- TAB navigation through multiple suggestions (skips internal placeholder groups)
- Universal language support (not limited to JavaScript/TypeScript)

## Code Architecture

### **Main Provider**: `src/services/ghost/GhostProvider.ts`

- [`shouldUseInlineCompletion()`](src/services/ghost/GhostProvider.ts:516-610): Centralized decision logic
- [`getEffectiveGroupForInline()`](src/services/ghost/GhostProvider.ts:488-534): Handles placeholder-only deletions
- [`render()`](src/services/ghost/GhostProvider.ts:571-603): Triggers inline completion
- [`displaySuggestions()`](src/services/ghost/GhostProvider.ts:640-703): Manages SVG decorations with proper exclusions
- [`selectNextSuggestion()`](src/services/ghost/GhostProvider.ts:851-898) / [`selectPreviousSuggestion()`](src/services/ghost/GhostProvider.ts:900-947): TAB navigation with placeholder skipping

### **Inline Completion**: `src/services/ghost/GhostInlineCompletionProvider.ts`

- [`getEffectiveGroup()`](src/services/ghost/GhostInlineCompletionProvider.ts:37-63): Handles separated deletion+addition groups
- [`shouldTreatAsAddition()`](src/services/ghost/GhostInlineCompletionProvider.ts:75-84): Universal detection logic
- [`getCompletionText()`](src/services/ghost/GhostInlineCompletionProvider.ts:86-128): Calculates ghost text content
- [`provideInlineCompletionItems()`](src/services/ghost/GhostInlineCompletionProvider.ts:158-216): Main entry point (simplified)

### **SVG Decorations**: `src/services/ghost/GhostDecorations.ts`

- [`displaySuggestions()`](src/services/ghost/GhostDecorations.ts:73-140): Shows decorations with group exclusions

## Testing

Comprehensive test coverage in [`GhostInlineCompletionProvider.spec.ts`](src/services/ghost/__tests__/GhostInlineCompletionProvider.spec.ts):

- Comment-driven completions
- Modifications with/without common prefix
- Distance-based decisions
- Multiple suggestion scenarios
- All edge cases

**All tests pass**: 28/28 across ghost system
