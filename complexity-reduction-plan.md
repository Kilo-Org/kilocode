# Complexity Reduction Plan for PR #3889

## Goal

Reduce implementation complexity while maintaining core request deduplication functionality.

## Current Complexity Issues

### 1. State Management Overhead

**Current:** 3 separate state tracking mechanisms

- `pendingRequests: Map<string, PendingSuggestion>`
- `pendingDebounceResolvers: Array<() => void>`
- `lastDebouncedPrompt: { prompt, prefix, suffix }`

### 2. Nested Promise Logic

**Current:** Complex promise-within-promise pattern with IIFE

### 3. Multiple Abort Check Points

**Current:** 4+ places checking `abortController.signal.aborted`

### 4. Debounce + Deduplication Coupling

**Current:** Tightly coupled debouncing and deduplication logic

---

## Proposed Simplifications

### Phase 1: Consolidate State Management

#### Action 1.1: Merge Debounce State into PendingSuggestion

```typescript
interface PendingSuggestion {
	prefix: string
	suffix: string
	prompt: GhostPrompt // Add this
	promise: Promise<LLMRetrievalResult>
	abortController: AbortController
	resolvers: Array<() => void> // Merge debounce resolvers here
	isDebounced: boolean // Track if still in debounce phase
}
```

**Benefits:**

- Single source of truth for request state
- Eliminates `pendingDebounceResolvers` and `lastDebouncedPrompt`
- Reduces state variables from 3 to 1

#### Action 1.2: Simplify Cache Key Strategy

```typescript
// Instead of composite key, use simpler approach
private getCacheKey(prefix: string, suffix: string): string {
    // For exact matches only
    return `${prefix.length}:${suffix.length}:${prefix}${suffix}`
}

// For reuse checking, don't use cache key
private canReuseRequest(pending: PendingSuggestion, prefix: string, suffix: string): boolean {
    return pending.suffix === suffix && prefix.startsWith(pending.prefix)
}
```

**Benefits:**

- Clearer separation between exact match and reuse logic
- Easier to understand and debug

---

### Phase 2: Simplify Async Flow

#### Action 2.1: Remove IIFE Pattern

```typescript
// Current: Complex IIFE
const promise = (async (): Promise<LLMRetrievalResult> => {
    // ... complex logic
})()

// Simplified: Direct async function
private createRequest(prompt: GhostPrompt, prefix: string, suffix: string): {
    promise: Promise<LLMRetrievalResult>,
    abortController: AbortController
} {
    const abortController = new AbortController()
    const promise = this.executeRequest(prompt, prefix, suffix, abortController)
    return { promise, abortController }
}

private async executeRequest(
    prompt: GhostPrompt,
    prefix: string,
    suffix: string,
    abortController: AbortController
): Promise<LLMRetrievalResult> {
    // Simplified linear flow
}
```

**Benefits:**

- Clearer execution flow
- Easier to test individual components
- Better error handling

#### Action 2.2: Centralize Abort Handling

```typescript
private handleAbortedRequest(error: unknown): boolean {
    return error instanceof Error &&
           (error.name === "AbortError" || error.message.includes("aborted"))
}

// Use consistently everywhere:
if (this.handleAbortedRequest(error)) {
    return  // Silent ignore
}
```

**Benefits:**

- Single place to modify abort behavior
- Consistent handling across codebase

---

### Phase 3: Decouple Debouncing from Deduplication

#### Action 3.1: Extract Debouncer Class

```typescript
class RequestDebouncer {
	private timer: NodeJS.Timeout | null = null
	private pending: (() => void) | null = null

	debounce(fn: () => void, delay: number): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer)
		}

		return new Promise((resolve) => {
			this.pending = resolve
			this.timer = setTimeout(() => {
				fn()
				this.pending?.()
				this.pending = null
				this.timer = null
			}, delay)
		})
	}

	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		this.pending?.()
		this.pending = null
	}
}
```

**Benefits:**

- Reusable debouncing logic
- Simpler to test in isolation
- Cleaner main class

#### Action 3.2: Separate Deduplication Logic

```typescript
class RequestDeduplicator {
	private pending = new Map<string, PendingSuggestion>()

	findReusable(prefix: string, suffix: string): PendingSuggestion | null {
		// Check exact match
		const key = this.getKey(prefix, suffix)
		if (this.pending.has(key)) {
			return this.pending.get(key)!
		}

		// Check type-ahead reuse
		for (const request of this.pending.values()) {
			if (this.canReuse(request, prefix, suffix)) {
				return request
			}
		}

		return null
	}

	add(key: string, request: PendingSuggestion): void {
		this.pending.set(key, request)
	}

	remove(key: string): void {
		this.pending.delete(key)
	}

	cancelObsolete(prefix: string, suffix: string): void {
		for (const [key, request] of this.pending.entries()) {
			if (!this.canReuse(request, prefix, suffix)) {
				request.abortController.abort()
				this.pending.delete(key)
			}
		}
	}
}
```

**Benefits:**

- Single responsibility principle
- Easier to unit test
- Can be reused elsewhere

---

### Phase 4: Simplify Main Flow

#### Action 4.1: Streamline fetchAndCacheSuggestion

```typescript
private async fetchAndCacheSuggestion(
    prompt: GhostPrompt,
    prefix: string,
    suffix: string
): Promise<void> {
    // 1. Check for reusable request
    const reusable = this.deduplicator.findReusable(prefix, suffix)
    if (reusable) {
        return this.reuseRequest(reusable, prefix, suffix)
    }

    // 2. Cancel obsolete requests
    this.deduplicator.cancelObsolete(prefix, suffix)

    // 3. Create and track new request
    const request = this.createNewRequest(prompt, prefix, suffix)
    this.deduplicator.add(this.getCacheKey(prefix, suffix), request)

    // 4. Wait for completion
    try {
        await request.promise
    } catch (error) {
        if (!this.handleAbortedRequest(error)) {
            console.error("Error getting completion:", error)
        }
    }
}
```

**Benefits:**

- Linear, easy-to-follow flow
- Clear separation of concerns
- Each step has single responsibility

#### Action 4.2: Simplify Suggestion Adjustment

```typescript
private adjustSuggestion(
    suggestion: string,
    originalPrefix: string,
    currentPrefix: string
): string | null {
    if (!currentPrefix.startsWith(originalPrefix)) {
        return null  // Can't adjust
    }

    const typedAhead = currentPrefix.slice(originalPrefix.length)
    if (!suggestion.startsWith(typedAhead)) {
        return null  // Suggestion doesn't match
    }

    return suggestion.slice(typedAhead.length)
}
```

**Benefits:**

- Pure function, easy to test
- Clear return semantics
- No side effects

---

## Implementation Order

### Step 1: Extract Helper Classes (Low Risk)

1. Create `RequestDebouncer` class
2. Create `RequestDeduplicator` class
3. Add unit tests for both

### Step 2: Refactor State Management (Medium Risk)

1. Consolidate state into single `PendingSuggestion` interface
2. Update all references
3. Verify tests still pass

### Step 3: Simplify Async Flow (Medium Risk)

1. Remove IIFE pattern
2. Extract `executeRequest` method
3. Centralize abort handling

### Step 4: Refactor Main Logic (Low Risk)

1. Simplify `fetchAndCacheSuggestion`
2. Extract `adjustSuggestion` as pure function
3. Update tests

### Step 5: Cleanup (Low Risk)

1. Remove unused variables
2. Add clear comments
3. Update documentation

---

## Expected Outcomes

### Metrics

| Metric                | Current | Target | Reduction    |
| --------------------- | ------- | ------ | ------------ |
| Lines in main method  | ~200    | ~100   | 50%          |
| State variables       | 3       | 1      | 67%          |
| Cyclomatic complexity | High    | Medium | ~40%         |
| Number of classes     | 1       | 3      | More modular |

### Benefits

1. **Maintainability:** Easier to understand and modify
2. **Testability:** Each component can be tested in isolation
3. **Reusability:** Helper classes can be used elsewhere
4. **Debuggability:** Clearer execution flow
5. **Performance:** Same or better (less state tracking)

### Risks

1. **Regression:** Mitigated by comprehensive test suite
2. **Time:** ~4-6 hours of refactoring
3. **Review:** Additional review cycle needed

---

## Alternative: Minimal Simplification

If full refactoring is too risky, consider these quick wins:

### Quick Win 1: Remove Debounce Complexity

Remove the "divergence detection" in debouncing - just use simple debounce:

```typescript
private debouncedFetchAndCacheSuggestion(
    prompt: GhostPrompt,
    prefix: string,
    suffix: string
): Promise<void> {
    if (this.debounceTimer) {
        clearTimeout(this.debounceTimer)
    }

    return new Promise(resolve => {
        this.debounceTimer = setTimeout(async () => {
            await this.fetchAndCacheSuggestion(prompt, prefix, suffix)
            resolve()
        }, DEBOUNCE_DELAY_MS)
    })
}
```

**Saves:** ~50 lines

### Quick Win 2: Simplify Reuse Check

```typescript
private findReusablePendingRequest(prefix: string, suffix: string): PendingSuggestion | null {
    // Only check exact match for now
    return this.pendingRequests.get(this.getCacheKey(prefix, suffix)) || null
}
```

**Saves:** ~15 lines

### Quick Win 3: Remove Redundant Abort Checks

Keep only essential abort checks:

- Before starting request
- In error handler
  **Saves:** ~10 lines

**Total Quick Wins:** ~75 lines reduction (37% reduction)

---

## Recommendation

**Preferred:** Full refactoring (Phase 1-5)

- Best long-term maintainability
- Cleaner architecture
- Better testability

**If time-constrained:** Minimal simplification

- Quick wins only
- Maintains current functionality
- Can refactor later

**Next Steps:**

1. Review this plan with team
2. Decide on approach
3. Create subtasks for implementation
4. Update PR with chosen simplifications
