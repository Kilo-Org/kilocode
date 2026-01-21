---
"webview-ui": patch
---

Fix auto-scrolling issue when auto-approve section is added after command

When the last item in a scrollable list is a command and an auto-approve section (like FollowUpSuggest with countdown) is added below it after the first render, auto-scrolling would stop because the user was technically no longer at the bottom.

The fix:
1. Track the previous message count to detect when new content is added
2. When new content is added and the user was at the bottom, maintain sticky follow by setting `stickyFollowRef.current = true`
3. This ensures auto-scrolling continues to work even after the auto-approve section is added
