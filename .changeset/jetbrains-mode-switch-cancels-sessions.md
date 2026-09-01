---
"@kilocode/kilo-jetbrains": patch
---

Fix switching chat mode cancelling running tasks in every open worktree, and explain any task Kilo stops on its own

Picking a mode in the chat prompt used to be saved as the CLI's global default, which made the CLI reload and cancel every task that was running anywhere. The mode now stays in the IDE and travels with each message, and it is still remembered for new chats.

When Kilo does stop a task without being asked — a settings or provider change, for example — the chat now shows why, offers Retry, and raises a notification, instead of quietly reporting "Stopped".
