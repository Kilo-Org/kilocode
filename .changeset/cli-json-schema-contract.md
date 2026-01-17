---
"@kilocode/cli": minor
"@kilocode/core-schemas": minor
---

Add JSON schema contract (v1.0.0) for CLI --json/--json-io modes

Output messages now include:

- schemaVersion: Version identifier for automation compatibility
- messageId: Unique identifier for message tracking
- event: Unified event type for semantic categorization
- status: Message completion status (partial/complete)

Input messages support both versioned (v1.0.0) and legacy formats for backward compatibility.
