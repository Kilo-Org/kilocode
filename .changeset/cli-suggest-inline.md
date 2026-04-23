---
"@kilocode/cli": patch
---

CLI suggestions now render inline in the conversation at the position of the suggest tool call, instead of as a separate bar above the prompt input. The inline bar renders as a single full-width row with a subtle background and clickable action buttons, matching the VS Code extension. Dismissal happens automatically when you send a new prompt. Blocking suggestions still use the above-prompt overlay.
