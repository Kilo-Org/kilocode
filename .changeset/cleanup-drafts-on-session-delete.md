---
"kilo-code": patch
---

Free webview memory for deleted VS Code sessions by clearing unsent prompt text, review comments, and pending image attachments that were retained in the per-session draft cache after `sessionDeleted`.

Also restores an in-flight failed draft into the live prompt after a session is deleted mid-send (whether user-initiated or via external CLI/TUI/cascade delete), while never rehydrating it into a prompt the user explicitly cleared.