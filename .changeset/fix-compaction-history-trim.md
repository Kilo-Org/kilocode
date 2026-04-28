---
"@kilocode/cli": patch
---

Fix sessions with large image attachments becoming unusable after compaction. When a conversation includes big inline images, the outgoing request can exceed the gateway's body-size limit even after a successful summary. The CLI now trims pre-summary messages for all successful summaries (including manual `/compact`) and strips media attachments from older turns once a summary exists, so follow-up prompts stay under the gateway limit and the session keeps working.
