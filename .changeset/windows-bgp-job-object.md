---
"@kilocode/cli": patch
---

Track Windows background processes with a Job Object instead of repeatedly starting PowerShell. In a loaded-machine measurement, one idle job used 0.90 PowerShell CPU cores and four used 2.12 cores total; the native path started no PowerShell during those running-job windows. Wait for terminating runners without a PowerShell fallback and allow up to 23 seconds for Windows persistent stop and rollback to finish.
