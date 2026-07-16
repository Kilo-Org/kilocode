---
"kilo-code": patch
---

Fix reverted messages not appearing after editing and resubmitting. When a message was reverted and then resubmitted, the new message and its reply stayed hidden until a full VS Code or Kilo restart. The extension now clears the stale revert marker client-side when the first post-revert message arrives, so new messages show immediately.
