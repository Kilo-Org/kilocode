---
"@kilocode/cli": patch
---

Detect the session pull-request link from local git signals, the PR URL a session prints in its own output, and at most one REST lookup, so Kilo no longer burns the GitHub GraphQL rate limit probing for a PR on a timer.
