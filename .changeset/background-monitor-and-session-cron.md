---
"@kilocode/cli": minor
---

Add a `monitor` action to the `background_process` tool that streams a long command's output back as it arrives, bounded by a line cap (default 200) and a wall-time cap (default 120000 ms) so a waiting agent reads progress instead of polling `logs`. Existing `background_process` actions are unchanged. Add session cron scheduling through `cron_create`, `cron_list`, and `cron_delete`: a recurring 5-field expression or a one-shot time/delay fires the session between turns after it goes idle, missed windows are not replayed, fire times carry deterministic jitter, each task expires seven days after creation, and tasks survive `--resume`.
