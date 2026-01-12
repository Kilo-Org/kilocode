---
"@kilocode/cli": patch
---

feat(cli): add word-by-word cursor navigation

Adds support for word-by-word cursor navigation in the CLI text input:

- `Meta+b` / `Meta+Left` to move to the beginning of the previous word
- `Meta+f` / `Meta+Right` to move to the beginning of the next word

This enhances the editing experience with Emacs-style keybindings and standard Meta+Arrow key navigation.
