---
"@kilocode/cli": patch
---

Fix session transcripts losing their final messages when the CLI exits — pending uploads are now flushed on shutdown and as soon as a session closes.
