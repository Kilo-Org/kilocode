---
"kilo-code": patch
---

Fix sub-agent reasoning loop after context compaction (#34). Three changes: (1) inject the original task prompt into the compaction continue message for sub-agent sessions so the model can anchor on its objective after compaction; (2) treat empty sub-agent output as a failure instead of silently returning NO_FINDINGS; (3) add `subagent_steps` config option to cap sub-agent turns and prevent runaway reasoning loops. Also fixes multi-round compaction nesting bloat by excluding synthetic parts when searching for the original task.
