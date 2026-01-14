# Paste Regression Analysis

## Issue Description

Users reported a regression in the CLI where pasting large texts with multiple lines directly submits the prompt after the first line, and the rest of the text is missing or processed incorrectly. This issue appeared in the latest published release (v4.143.1).

## Root Cause Analysis

The issue was traced back to **PR #4831** ("Fix paste truncation in VSCode terminal"), which modified `cli/src/ui/providers/KeyboardProvider.tsx`.

### The Change

PR #4831 removed `completePaste()` and `clearBuffers()` from the `useEffect` cleanup function in `KeyboardProvider`. The intention was to support React StrictMode, which mounts and unmounts components rapidly in development, potentially interrupting paste operations if the cleanup logic flushed the buffer prematurely.

### The Consequence

In the previous version, if the `KeyboardProvider` effect was cleaned up (e.g., due to a re-render or unmount) while a paste was in progress, `completePaste()` would force the accumulated text to be processed as a paste event.

With the removal of `completePaste()`, if an interruption occurs during a large paste:

1.  The "paste mode" state might be lost (if the component unmounts/remounts, resetting `useRef`).
2.  Or, the bracketed paste mode is temporarily disabled (via `\x1b[?2004l`) during the cleanup/setup cycle.
3.  As a result, the remaining part of the pasted text is received by the CLI as **raw input** instead of a paste sequence.
4.  The CLI interprets the newlines in this raw text as **Enter key presses**, causing the prompt to be submitted immediately after the first line.

### Verification

We verified this by checking out the commit prior to PR #4831 (`b470266fd7f813e6269a92a80e2f66c8a2e5e9d9`), where the issue was not reproducible.

## The Fix

The fix involves restoring `completePaste()` and `clearBuffers()` to the cleanup function in `cli/src/ui/providers/KeyboardProvider.tsx`. This ensures that any pending paste buffer is processed safely if the component unmounts or re-renders, preventing raw input leakage.

While this might re-introduce the theoretical issue with React StrictMode (paste interruption during double-mount), the production stability for large pastes is prioritized.

## Modified File

`cli/src/ui/providers/KeyboardProvider.tsx`

```typescript
// Cleanup
return () => {
	// ... listeners removal ...

	// Disable bracketed paste mode
	process.stdout.write("\x1b[?2004l")

	// ... other cleanup ...

	// Flush any pending buffers
	// Note: This was previously removed to support React StrictMode, but it caused
	// issues with large pastes in production where the component might re-render
	// or unmount during a paste operation, leading to lost paste state and
	// raw input processing (submitting on newlines).
	completePaste()
	clearBuffers()
}
```
