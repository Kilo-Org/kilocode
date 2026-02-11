---
"kilo-code": patch
---

Fix attached images being lost when editing a message with checkpoint

When editing a message that has a checkpoint, the images attached to the edited message were not being included in the `editMessageConfirm` webview message. This caused images to be silently dropped and not sent to the backend.

The fix adds the `images` field to the message payload in both the checkpoint and non-checkpoint edit confirmation paths.

Fixes #3489
