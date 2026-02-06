---
"kilo-code": minor
---

Added FileModificationNotificationService to notify external extensions about file operations (create, modify, delete). This enables integration with source control extensions that cannot rely on VSCode's file system API when Background Editing is enabled.
