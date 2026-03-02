# Dedicated Output Channel

**Priority:** P2
**Status:** 🔨 Partial
**Source:** [JetBrains plugin analysis](../../LESSONS_LEARNED_JETBRAINS.md)

## What Exists

- Agent Manager creates `vscode.window.createOutputChannel("Kilo Agent Manager")` for setup script output

## Remaining Work

- Create a general `vscode.window.createOutputChannel("Kilo Code")` during activation
- Centralized logging utility with log levels (debug, info, warn, error)
- Route all `[Kilo New]` log messages to this channel
- Keep console.log as a secondary target for debugging
- Dispose the channel on deactivation
- Migrate existing `console.log("[Kilo New] ...")` calls throughout KiloProvider, connection-service, http-client, sse-client

## Implementation Notes

```typescript
// In extension.ts activate():
const output = vscode.window.createOutputChannel("Kilo Code")
context.subscriptions.push(output)

// Utility function:
function log(level: string, message: string): void {
  const timestamp = new Date().toISOString()
  const formatted = `[${timestamp}] [${level}] ${message}`
  output.appendLine(formatted)
  console.log(`[Kilo New] ${formatted}`)
}
```

Files to change:

- [`src/extension.ts`](../../src/extension.ts) — create output channel
- New file `src/utils/logger.ts` — centralized logging utility
- All files currently using `console.log("[Kilo New] ...")` — migrate to logger
