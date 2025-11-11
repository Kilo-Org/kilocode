# Autocomplete Implementation Review Brief

## Context

We have two autocomplete implementations both using Codestral. The codebase currently supports toggling between them via `useNewAutocomplete` setting.

**Decision Required:** We will consolidate to a single implementation which at first will use codestral but with both the fim and chat-completion endpoints available, but must also be easily extensible and tunable to other models with their quirks - we will offer users a few models to choose from. Some of the autocomplete features are subtle since they depend on or compensate for the exact behavior of unpredictable LLMs, they need to deal with intrinsically asynchronous events (and concurrency is tricky), and perceived user latency matters but cost does too. That means there are quite a few tweaks to the various implementations, and presumably these exist for a reason - so we want to keep the features, but merged into one implementation. The "new" implementation is based on continue.dev and if there's a conflict between two bits of tuning (especially on prompting, debouncing, avoiding repetition), it's usually (though not always) the case that that implementation has the behavior to keep. On the other hand, the classic implementation is better integrated into the rest of the codebase - in particular, we want to keep the LLM-api calling bits centralized with the other, non-autocomplete code, and classic already does that whereas continue has its own LLM API calling logic (but that might contain improvements worth porting, too...).

**Which implementation should be the base?**

- Option A: Use Classic as base, port features from New
- Option B: Use New as base, port features from Classic

Once the base is selected, we will:

1. Identify features from the non-selected implementation that must be ported
2. Estimate effort to port those features
3. Deprecate and remove the non-selected implementation
4. Remove components (or at least turn into merely very thin wrappers) such as the continue-dev based BaseLLM implementations (integrating only key differentiators into our existing LLM integrations). We don't want multiple implementations for the same functionality, so stuff the more general kilocode extension already does needs to go.

This decision impacts development effort, risk of bugs, token cost, and maintainability. It should not affect the user since we're keeping all the features either way.

---

## Source Files to Study

### Classic Implementation

- **Main Provider**: [`src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts`](src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts)

- **Prompting**: [`src/services/ghost/classic-auto-complete/HoleFiller.ts`](src/services/ghost/classic-auto-complete/HoleFiller.ts)

- **Context**: [`src/services/ghost/classic-auto-complete/GhostContextProvider.ts`](src/services/ghost/classic-auto-complete/GhostContextProvider.ts)

- **Filtering**: [`src/services/ghost/classic-auto-complete/uselessSuggestionFilter.ts`](src/services/ghost/classic-auto-complete/uselessSuggestionFilter.ts)

### New (continue-based) Implementation

- **Wrapper**: [`src/services/ghost/new-auto-complete/NewAutocompleteProvider.ts`](src/services/ghost/new-auto-complete/NewAutocompleteProvider.ts)

- **Main Orchestrator**: [`src/services/continuedev/core/vscode-test-harness/src/autocomplete/completionProvider.ts`](src/services/continuedev/core/vscode-test-harness/src/autocomplete/completionProvider.ts)

- **Core Logic**: [`src/services/continuedev/core/autocomplete/CompletionProvider.ts`](src/services/continuedev/core/autocomplete/CompletionProvider.ts)

- **Model Templates**: [`src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts`](src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts)

- **Prompt Rendering**: [`src/services/continuedev/core/autocomplete/templating/index.ts`](src/services/continuedev/core/autocomplete/templating/index.ts)

- **Generator Reuse**: [`src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts`](src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts)

- **Debouncing**: [`src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts`](src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts)

- **Postprocessing**: [`src/services/continuedev/core/autocomplete/postprocessing/index.ts`](src/services/continuedev/core/autocomplete/postprocessing/index.ts)

---

## Key Areas to Investigate

### 1. Codestral Prompt Format

**Question**: What prompt format does Codestral expect for optimal performance?

**Evidence to Review**:

- Codestral API documentation: https://docs.mistral.ai/capabilities/code_generation/
- Classic sends: XML-based `<COMPLETION>...</COMPLETION>` format
    - See [`HoleFiller.ts:10-105`](src/services/ghost/classic-auto-complete/HoleFiller.ts:10-105)
- New sends: Native FIM format `[SUFFIX]...[PREFIX]...`
    - See [`AutocompleteTemplate.ts:87-126`](src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts:87-126)

**What to determine**:

- Which format is Codestral trained on?
- Does format choice impact quality/cost/latency?
- Is the difference material in practice?

### 2. Caching Strategy

**Question**: Which caching approach provides better hit rates for FIM scenarios?

**Evidence to Review**:

- Classic: Suffix-aware cache with partial match handling
    - See [`GhostInlineCompletionProvider.ts:30-63`](src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts:30-63)
- New: Prefix-only LRU cache
    - See [`CompletionProvider.ts:189-194`](src/services/continuedev/core/autocomplete/CompletionProvider.ts:189-194)

**What to determine**:

- How often does suffix change between requests?
- Does suffix-awareness improve cache hit rate materially?
- What is the memory/complexity trade-off?

### 3. Concurrent Request Handling

**Question**: How do the implementations handle rapid typing and request overlaps?

**Evidence to Review**:

- Classic: Polling-based cancellation flag
    - See [`GhostInlineCompletionProvider.ts:235-237`](src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts:235-237)
- New: Debouncing + AbortController + Generator Reuse
    - Debouncing: [`AutocompleteDebouncer.ts`](src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts)
    - Generator Reuse: [`GeneratorReuseManager.ts`](src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts)

**What to determine**:

- How frequently do overlapping requests occur in practice?
- What is the cost impact of wasted API calls?
- Does generator reuse complexity justify its benefits?

### 4. Token Management

**Question**: How do the implementations handle context window limits?

**Evidence to Review**:

- Classic: No explicit token limit handling
    - Context gathered in [`GhostContextProvider.ts:35-77`](src/services/ghost/classic-auto-complete/GhostContextProvider.ts:35-77)
- New: Token-aware pruning with proportional reduction
    - See [`templating/index.ts:140-211`](src/services/continuedev/core/autocomplete/templating/index.ts:140-211)

**What to determine**:

- How often does context exceed token limits in practice?
- What happens when limits are exceeded (error vs. truncation)?
- Is the pruning logic complexity justified?

### 5. Filtering and Quality

**Question**: Which filtering approach produces better completions?

**Evidence to Review**:

- Classic: Basic useless suggestion filter
    - See [`uselessSuggestionFilter.ts:9-28`](src/services/ghost/classic-auto-complete/uselessSuggestionFilter.ts:9-28)
- New: Multi-stage filtering with model-specific postprocessing
    - See [`postprocessing/index.ts:90-191`](src/services/continuedev/core/autocomplete/postprocessing/index.ts:90-191)

**What to determine**:

- How often do "bad" completions slip through classic's filter?
- Are the model-specific fixes addressing real production issues?
- What is the false positive rate for filtering?

### 6. Code Complexity vs. Feature Value

**Question**: What is the optimal complexity/feature trade-off?

**Evidence to Review**:

- Classic: ~400 LOC, simple architecture
- New: ~3000+ LOC, modular but complex

**What to determine**:

- Which features are essential for production use?
- What is the maintenance burden for each approach?
- Can we achieve 80% of benefits with 20% of complexity?

### 7. Any other features or tweaks you notice

The ultimate aim it to serve the user the best, cheapest, fastest autocomplete, so feel free to take other code into account if you notice it matters.

---

## Desirable Outcomes

Any solution should optimize for:

1. **Correctness**: Completions that follow Codestral's expected behavior
2. **Performance**: Low latency for users during normal typing patterns
3. **Cost Efficiency**: Minimal wasted API calls and token usage
4. **Quality**: High acceptance rate for shown completions
5. **Reliability**: Proper handling of edge cases and concurrent requests
6. **Maintainability**: Code that is understandable and modifiable
7. **Robustness**: Graceful handling of errors and context window limits

---

## Test Scenarios to Consider

When evaluating implementations, consider these real-world patterns:

### Scenario 1: Rapid Typing

```
User types: "const result = api.fetch"
- 14 keystrokes in ~2 seconds
- Expected: 1-2 API calls, not 14
```

### Scenario 2: Backspace Correction

```
User types: "const resu"
LLM suggests: "lt = ..."
User backspaces to: "const res"
- Expected: New suggestion, not cached "lt = ..."
```

### Scenario 3: Multi-file Context

```
File A imports function from File B
User coding in File A at call site
- Expected: Context from File B influences completion
```

### Scenario 4: Large Files

```
Working in 5000-line file
Context gathering collects 10 nearby functions
- Expected: No context window errors
- Expected: Relevant context prioritized over distant code
```

### Scenario 5: Model Quirks

```
Codestral sometimes returns leading spaces
Codestral sometimes returns double newlines
- Expected: Cleanup applied consistently
```

---

## Review Deliverable

Please provide:

1. **Base Selection**: Choose either Classic or New as the foundation

    - Justify based on architecture, correctness, and maintainability
    - Consider technical debt and alignment with aim of best-in-class autocomplete.
    - The best base is the one that makes the OVERALL plan best; not the one that works best WITHOUT merging in features. This is a question of programming approach.

2. **Feature Gap Analysis**: For each implementation

    - List features unique to Classic that should be ported to New (if New is selected as base)
    - List features unique to New that should be ported to Classic (if Classic is selected as base)
    - Prioritize features as: Critical / Important / Nice-to-have / Skip

3. **Porting Effort Estimate**: For features that need to be ported

    - Technical complexity (Easy / Medium / Hard)
    - Estimated development time
    - Dependencies and risks

4. **Implementation Plan**:

    - Step-by-step migration approach
    - Code removal strategy for deprecated implementation
    - Testing and validation plan

5. **Risk Analysis**:
    - Technical risks with selected base
    - Migration risks
    - Mitigation strategies

Please carefully consider whether we should port the classic implmentation into the new implementation, or the reverse: port the new implementation into the classic implementation.
