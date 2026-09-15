---
"kilo-code": minor
---

Add a Reasoning Blocks display setting with Expanded, Preview, and Headline modes. Headline shows only the reasoning header and streaming indicator until you open the block, and your open or closed choice is kept while the response streams. Preview keeps a short capped scrolling preview while the agent writes and stays compact after it finishes, and blocks from earlier sessions start collapsed. Expanded keeps the full text open. The setting replaces Auto-Collapse Reasoning; existing `auto_collapse_reasoning: true` configurations map to Preview.

Keep the Preview viewport anchored to the newest reasoning text after the block finishes, so later tool calls no longer make it jump back to the top.

Background subagent transcripts use the same Reasoning Blocks setting instead of always showing the capped preview.
