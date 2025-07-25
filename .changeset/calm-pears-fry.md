---
"kilo-code": patch
---

The chat box is no longer cleared when clicking buttons

Previously, if either of the buttons in the agent chat was clicked, the ChatTextArea would get cleared. Now, the ChatTextArea will only get cleared if a message is sent as part of the response.
