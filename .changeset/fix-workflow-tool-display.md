---
"kilo-code": patch
---

Fix workflow tool display bug - always send tool message to webview even when auto-execute is enabled

When AUTO_EXECUTE_WORKFLOW experiment is enabled, the workflow tool message was created in the backend but never sent to the webview. This caused the workflow UI to not appear. The fix ensures that the tool message is always sent to the webview via task.ask() regardless of the auto-execute setting, so users can see what workflow is being executed.
