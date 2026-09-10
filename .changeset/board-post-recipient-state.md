---
"@kilocode/cli": patch
"kilo-code": patch
---

Report the direct recipient execution state in board_post results and warn when that recipient stopped, failed, was cancelled, or is unknown, so agents do not assume a finished subagent will read the message.
