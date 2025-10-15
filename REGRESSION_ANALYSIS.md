# Double Terminal Bug - Regression Analysis

## Summary

The double terminal creation bug was introduced in commit `a9c1dad2c` (June 12, 2025) during a performance optimization refactor of `combineCommandSequences`.

## Root Cause

When two command messages share the **same timestamp**, the refactored code would add the same combined message twice:

1. **First loop (lines 34-120)**: Both commands with identical timestamps get processed and stored in `combinedMessages` Map. Since the Map uses `msg.ts` as the key, the second message **overwrites** the first.

2. **Second loop (lines 124-143)**: When iterating through original messages, **both** messages (at different array indices but same timestamp) trigger `combinedMessages.has(msg.ts)` → adds the **same combined message twice**.

## The Fix

Track which timestamps have already been added to prevent duplicates:

```typescript
const addedTimestamps = new Set<number>()

// In the result building loop:
if (combinedMessages.has(msg.ts)) {
	if (!addedTimestamps.has(msg.ts)) {
		result.push(combinedMessages.get(msg.ts)!)
		addedTimestamps.add(msg.ts)
	}
}
```

## Why the Hack Didn't Work

The hack in PR #3035 (lines 145-167) tried to deduplicate **after** the bug had already added duplicates. This band-aid approach:

- Only worked for consecutive duplicates
- Compared command text instead of fixing the timestamp collision
- Left the root cause unaddressed

## Test Coverage

Added test case to reproduce the bug:

```typescript
it("should not duplicate commands when they have the same timestamp", () => {
	const messages: ClineMessage[] = [
		{ type: "ask", ask: "command", text: "mkdir -p core/vscode-test-harness/src/util", ts: 1625097600000 },
		{ type: "ask", ask: "command", text: "mkdir -p core/vscode-test-harness/src/util", ts: 1625097600000 },
	]

	const result = combineCommandSequences(messages)
	expect(result).toHaveLength(1) // Should be 1, not 2
})
```

## Commit Timeline

- `a9c1dad2c` (June 12, 2025) - **Regression introduced**: Refactored loops for performance
- `159f04eef` (Oct 15, 2025) - **Band-aid applied**: Hack to hide duplicate commands
- **Current fix**: Proper resolution by tracking added timestamps
