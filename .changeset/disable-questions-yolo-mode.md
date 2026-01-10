---
"kilo-code": patch
---

Disable ask_followup_question tool when yolo mode is enabled to prevent the agent from asking itself questions and auto-answering them. Applied to:
- XML tool descriptions (system prompt)
- Native tool filtering
- Tool execution (returns error message if model still tries to use the tool from conversation history)
