# apply_diff

The `apply_diff` tool makes precise, surgical changes to files by specifying exactly what content to replace. It uses multiple sophisticated strategies for finding and applying changes while maintaining proper code formatting and structure.

## Parameters

The tool accepts these parameters:

- `path` (required): The path of the file to modify relative to the current working directory.
- `diff` (required): The search/replace block defining the changes. **Line numbers are mandatory within the diff content format** for all currently implemented strategies.

**Note**: While the system is designed to be extensible with different diff strategies, all currently implemented strategies require line numbers to be specified within the diff content itself using the `:start_line:` marker.

## What It Does

This tool applies targeted changes to existing files using sophisticated strategies to locate and replace content precisely. Unlike simple search and replace, it uses intelligent matching algorithms (including fuzzy matching) that adapt to different content types and file sizes, with fallback mechanisms for complex edits.

## When is it used?

- When Kilo Code needs to make precise changes to existing code without rewriting entire files.
- When refactoring specific sections of code while maintaining surrounding context.
- When fixing bugs in existing code with surgical precision.
- When implementing feature enhancements that modify only certain parts of a file.

## Key Features

- Uses intelligent fuzzy matching with configurable confidence thresholds (typically 0.8-1.0).
- Provides context around matches using `BUFFER_LINES` (default 40).
- Employs an overlapping window approach for searching large files.
- Preserves code formatting and indentation automatically.
- Combines overlapping matches for improved confidence scoring.
- Shows changes in a diff view for user review and editing before applying.
- Tracks consecutive errors per file (`consecutiveMistakeCountForApplyDiff`) to prevent repeated failures.
- Validates file access against `.kilocodeignore` rules.
- Handles multi-line edits effectively.

## Limitations

- Works best with unique, distinctive code sections for reliable identification.
- Performance can vary with very large files or highly repetitive code patterns.
- Fuzzy matching might occasionally select incorrect locations if content is ambiguous.
- Each diff strategy has specific format requirements.
- Complex edits might require careful strategy selection or manual review.

## How It Works

When the `apply_diff` tool is invoked, it follows this process:

1.  **Parameter Validation**: Validates required `path` and `diff` parameters.
2.  **KiloCodeIgnore Check**: Validates if the target file path is allowed by `.kilocodeignore` rules.
3.  **File Analysis**: Loads the target file content.
4.  **Match Finding**: Uses the selected strategy's algorithms (exact, fuzzy, overlapping windows) to locate the target content, considering confidence thresholds and context (`BUFFER_LINES`).
5.  **Change Preparation**: Generates the proposed changes, preserving indentation.
6.  **User Interaction**:
    - Displays the changes in a diff view.
    - Allows the user to review and potentially edit the proposed changes.
    - Waits for user approval or rejection.
7.  **Change Application**: If approved, applies the changes (potentially including user edits) to the file.
8.  **Error Handling**: If errors occur (e.g., match failure, partial application), increments the `consecutiveMistakeCountForApplyDiff` for the file and reports the failure type.
9.  **Feedback**: Returns the result, including any user feedback or error details.

## Diff Strategy

Kilo Code uses this strategy for applying diffs:

### MultiSearchReplaceDiffStrategy

An enhanced search/replace format supporting multiple changes in one request. **Line numbers are mandatory for each search block.**

- **Best for**: Multiple, distinct changes where line numbers are known or can be estimated.
- **Requires**: Exact match for the `SEARCH` block content, including whitespace and indentation. The `:start_line:` marker is **required** within each SEARCH block. Markers within content must be escaped (`\`).

Example format for the `<diff>` block:

```diff
<<<<<<< SEARCH
:start_line:10
:end_line:12
-------
    // Old calculation logic
    const result = value * 0.9;
    return result;
=======
    // Updated calculation logic with logging
    console.log(`Calculating for value: ${value}`);
    const result = value * 0.95; // Adjusted factor
    return result;
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:25
:end_line:25
-------
    const defaultTimeout = 5000;
=======
    const defaultTimeout = 10000; // Increased timeout
>>>>>>> REPLACE
```
