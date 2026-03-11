# Plan: Fix Chat Input Cursor Position Shift

## 1. Problem Statement

The cursor/caret in the chat input appears at a visually shifted position from the actual text. This affects usability especially when editing in the middle of prompts or using autocomplete features.

## 2. Architecture Comparison: kilocode-legacy vs kilocode

### kilocode-legacy (React)

- **Component:** `webview-ui/src/components/chat/ChatTextArea.tsx` (~2045 lines)
- Uses `react-textarea-autosize` (DynamicTextArea)
- Highlight overlay uses Tailwind classes that mirror textarea: `font-vscode-font-family`, `text-vscode-editor-font-size`, `leading-vscode-editor-line-height`, `py-1.5 px-2`, `pr-9`, `pb-16`
- Both textarea and overlay have identical Tailwind-based padding/font/lineheight classes
- Explicit cursor management via `intendedCursorPosition` state + `useLayoutEffect`
- Three autocomplete systems: @mentions (ContextMenu.tsx), /slash commands (SlashCommandMenu.tsx), FIM ghost text (useChatAutocompleteText hook)
- Scroll sync on every scroll + highlight update event

### kilocode (SolidJS)

- **Component:** `packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx` (~640 lines)
- Uses plain `<textarea>` with manual height adjustment
- Highlight overlay styled in `packages/kilo-vscode/webview-ui/src/styles/chat.css`
- Both use `font-family: var(--vscode-font-family)`, `font-size: 13px`, `line-height: 1.4`, `padding: 8px 8px calc(8px + 1.4em)`
- Two autocomplete systems: @file mentions (useFileMention hook), FIM ghost text
- Scroll sync via `syncHighlightScroll()` called on input/scroll/paste events

## 3. Root Causes Identified

### A. Missing `border: none` on textarea (HIGH PRIORITY)

- **File:** `packages/kilo-vscode/webview-ui/src/styles/chat.css`
- The `.prompt-input` textarea does not explicitly set `border: none`. Browser default textarea borders create a pixel offset between the overlay text position and the textarea content area.
- The overlay has no border, but the textarea has a default browser border.
- The legacy repo avoids this by having both use matching `border: 1px solid transparent`.
- **Fix:** Add `border: none` to `.prompt-input` (or `border: 1px solid transparent` and mirror on overlay).

### B. Missing `box-sizing: border-box` on overlay (HIGH PRIORITY)

- **File:** `packages/kilo-vscode/webview-ui/src/styles/chat.css`
- The textarea has `box-sizing: border-box` (line ~724), but `.prompt-input-highlight-overlay` does not explicitly set it.
- If there's no global `box-sizing` rule covering divs, padding is added outside the content box, causing width/position mismatches.
- **Fix:** Add `box-sizing: border-box` to `.prompt-input-highlight-overlay`.

### C. Scroll synchronization single-frame lag (MEDIUM PRIORITY)

- **File:** `packages/kilo-vscode/webview-ui/src/components/chat/PromptInput.tsx`
- `syncHighlightScroll()` is called on `onScroll`, `handleInput`, and `handlePaste`, but paste uses `requestAnimationFrame` which introduces a one-frame lag.
- During that frame, the overlay and caret are misaligned.
- The legacy repo syncs scroll in the `updateHighlights` callback which runs synchronously.
- **Fix:** Call `syncHighlightScroll()` synchronously after paste, or use a MutationObserver/ResizeObserver to keep them in sync continuously.

### D. `scrollbar-gutter: stable` mismatch risk (MEDIUM PRIORITY)

- Both textarea and overlay use `scrollbar-gutter: stable`, but if one shows a scrollbar and the other doesn't (e.g., overlay has `overflow-y: auto` but textarea's scrollbar behavior differs), their content widths will differ, causing text wrapping differences.
- **Fix:** Ensure both elements have identical overflow and scrollbar-gutter behavior, or hide the overlay scrollbar with CSS.

### E. Potential `white-space`/word-wrap edge cases (LOW PRIORITY)

- The overlay uses `white-space: pre-wrap; word-wrap: break-word` explicitly. The textarea relies on default browser wrapping. While these are usually equivalent, there can be edge cases with Unicode or very long words.
- **Fix:** Explicitly set `white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word` on both elements.

### F. Ghost text acceptance doesn't explicitly set cursor (LOW PRIORITY)

- `acceptSuggestion()` in PromptInput.tsx sets `textareaRef.value = newText` but doesn't call `setSelectionRange()`. It relies on browser default behavior.
- The legacy repo uses `document.execCommand("insertText")` which preserves undo and cursor position.
- **Fix:** After accepting ghost text, explicitly call `textareaRef.setSelectionRange(newText.length, newText.length)`.

## 4. Recommended Fix Order

1. **Fix A + B** (CSS fixes — likely resolves the reported issue immediately)
2. **Fix C + D** (scroll/scrollbar alignment)
3. **Fix E + F** (edge cases)

## 5. Testing Checklist

- [ ] Type a long prompt and verify caret aligns with visible text at every position
- [ ] Use @file mention autocomplete, verify cursor position after selection
- [ ] Accept FIM ghost text with Tab, verify cursor position
- [ ] Paste multi-line text, verify no temporary misalignment
- [ ] Test with various VS Code themes (light/dark)
- [ ] Test with different font sizes in VS Code settings
- [ ] Scroll the textarea and verify overlay stays in sync
- [ ] Test in edit mode (ChatRow) if applicable
