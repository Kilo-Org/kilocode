# Copy Button Copies Extra Fields

**Priority:** P1
**Status:** 🔨 Partial (assigned)
**Issue:** [#6085](https://github.com/Kilo-Org/kilocode/issues/6085)

## Problem

The copy button on code blocks in the chat sometimes copies more than just the visible code. For example, it copies the surrounding markdown fence markers (` ``` `) in addition to the code content. The rendered UI doesn't show the fences, but they end up in the clipboard.

## Remaining Work

- Audit the copy logic on the code block component: confirm whether it copies from the raw markdown source or from the rendered DOM text content
- The copy should extract only the inner code content — not the fence markers, language identifier, or any other metadata
- Verify fix works for all code block types (bash, python, json, etc.) and for fenced blocks inside tool output messages

## Implementation Notes

- The copy button is part of the code block rendering in kilo-ui or the webview's markdown component
- If copying from raw markdown: strip the leading/trailing ` ``` ` lines and optional language tag before writing to clipboard
- If copying from DOM: use the `textContent` of the inner `<code>` element, not the outer `<pre>`
