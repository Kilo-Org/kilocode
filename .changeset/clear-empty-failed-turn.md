---
"@kilocode/cli": patch
---

Clear a failed turn that produced no output from the conversation when the next message is sent, so an "An error occurred" placeholder no longer lingers in history. A turn that wrote text or ran a tool before failing is kept, since its record explains changes already made.
