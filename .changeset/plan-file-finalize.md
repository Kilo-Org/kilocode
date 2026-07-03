---
"@kilocode/cli": patch
"kilo-code": patch
---

Report the plan file that was actually saved in Plan mode: point the "Plan is ready" link, the follow-up prompt, and the new-session handoff at the real file instead of a wrongly generated name, and fail plan_exit with a clear error when no plan was written.
