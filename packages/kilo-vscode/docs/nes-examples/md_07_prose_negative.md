# Mercury Edit 2 — Quick Notes

Mercury Edit 2 is a small, fast model trained to predict the user's
next single edit given the current file, cursor position, and recent
edit history. It targets latency under 200 ms on typical files and
returns a unified-diff-like patch scoped to a window around the cursor.

Unlike chat-style completions, the model is biased toward minimal,
local changes — finishing a function body, fixing a typo, propagating
a rename — rather than generating new files from scratch.
