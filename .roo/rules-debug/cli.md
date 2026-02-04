# CLI Debugging with File-Based Logging

When debugging the CLI, `console.log` will break the TUI (Terminal User Interface). Use file-based logging to capture debug output without interfering with the application's display.

## File-Based Logging Strategy

1. **Write logs to a temporary file instead of console**:

    - Create a log file at a known location, e.g., `/tmp/roo-cli-debug.log`
    - Use `fs.appendFileSync()` to write timestamped log entries
    - Example logging utility:

        ```typescript
        import fs from "fs"
        const DEBUG_LOG = "/tmp/roo-cli-debug.log"

        function debugLog(message: string, data?: unknown) {
        	const timestamp = new Date().toISOString()
        	const entry = data
        		? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}\n`
        		: `[${timestamp}] ${message}\n`
        	fs.appendFileSync(DEBUG_LOG, entry)
        }
        ```

2. **Clear the log file before each debugging session**:
    - Run `echo "" > /tmp/roo-cli-debug.log` or use `fs.writeFileSync(DEBUG_LOG, "")` at app startup during debugging

## Iterative Debugging Workflow

Follow this feedback loop to systematically narrow down issues:

1. **Add targeted logging** at suspected problem areas based on your hypotheses
2. **Instruct the user** to reproduce the issue using the CLI normally
3. **Read the log file** after the user completes testing:
    - Run `cat /tmp/roo-cli-debug.log` to retrieve the captured output
4. **Analyze the log output** to gather clues about:
    - Execution flow and timing
    - Variable values at key points
    - Which code paths were taken
    - Error conditions or unexpected states
5. **Refine your logging** based on findings—add more detail where needed, remove noise
6. **Ask the user to test again** with updated logging
7. **Repeat** until the root cause is identified

## Best Practices

- Log entry/exit points of functions under investigation
- Include relevant variable values and state information
- Use descriptive prefixes to categorize logs: `[STATE]`, `[EVENT]`, `[ERROR]`, `[FLOW]`
- Log both the "happy path" and error handling branches
- When dealing with async operations, log before and after `await` statements
- For user interactions, log the received input and the resulting action

## Example Debug Session

```typescript
// Add logging to investigate a picker selection issue
debugLog("[FLOW] PickerSelect onSelect called", { selectedIndex, item })
debugLog("[STATE] Current selection state", { currentValue, isOpen })

// After async operation
const result = await fetchOptions()
debugLog("[FLOW] fetchOptions completed", { resultCount: result.length })
```

Then ask: "Please reproduce the issue by [specific steps]. When you're done, let me know and I'll analyze the debug logs."
