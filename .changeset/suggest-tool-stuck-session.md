---
"kilo-code": patch
"@kilocode/cli": patch
---

Fix a stuck session state when the suggest tool was left open. If the suggestion was never accepted or dismissed (for example, because VS Code was closed while it was showing), the session stayed marked as busy and any follow-up messages appeared queued forever. The session is now marked idle while waiting for a response to a suggestion. The suggest tool is also no longer offered to the model during `kilo run`, where there is no UI to respond to it.
