---
"@kilocode/cli": minor
---

Add `--on-task-completed <prompt>` flag to send a custom prompt to the agent when the task completes. This flag requires `--auto` mode and allows users to define any follow-up action (e.g., creating a PR, running tests, generating documentation). The prompt is sent to the agent after the main task completes, enabling flexible post-task automation.
