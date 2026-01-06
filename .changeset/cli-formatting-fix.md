---
"@kilocode/cli": patch
---

Fix CLI formatting for unknown message types, JSON content, and codebase search results

- Improved JSON parsing in CI mode with proper error handling
- Enhanced unknown message type handling with JSON formatting
- Fixed codebase search results parsing to match extension payload format
- Fixed operator precedence bug in SayMessageRouter.tsx
