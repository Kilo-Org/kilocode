---
"kilo-code": minor
---

Add a "New Chat with Text" command that opens a new chat with the given text in the prompt box. The text is only sent when asked to: the Command Palette asks "Send the message now?" as a second step (default No), and other extensions can call `kilo-code.new.newChatWithText` with `{ text, send }`, where `send` defaults to false. It also works in editors that cannot paste into a webview.
