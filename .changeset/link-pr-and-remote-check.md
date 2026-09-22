---
"@kilocode/cli": patch
---

Link a session to its pull request reliably, on GitHub, GitLab and Bitbucket. An explicit link (`link_pr`, `kilo pr link`, or the app's set-PR-link action) always wins, and a check every 5 minutes asks the session's own git host whether an open pull request exists for its branch. A stale link is cleared when that check finds the pull request no longer open, so the app row updates when the pull request closes.
