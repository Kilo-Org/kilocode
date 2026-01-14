---
"@kilocode/cli": patch
---

Fix multiline paste regression where pasting text with newlines would submit after the first line

This fixes a regression introduced in PR #4831 where removing `completePaste()` and `clearBuffers()` from the cleanup function caused paste buffers to be lost during component re-renders/unmounts. When this happened, remaining pasted text was processed as raw input, causing newlines to trigger immediate submission.
