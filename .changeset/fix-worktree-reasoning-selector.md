---
"kilo-code": patch
---

Fix the reasoning-variant (and mode) picker in the New Worktree dialog so selecting a variant actually applies. The pickers portaled their popover to the page body, where the dialog's modal overlay intercepted pointer events and swallowed the click before the option handler ran. Render the popovers inline (`portal={false}`), matching the model picker already fixed for the same reason.
