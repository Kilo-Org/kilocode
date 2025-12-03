# Unified Autocomplete Review and Integration Plan

## Executive summary

Base selection: use Classic as the foundation and integrate key Continue-based features. This aligns with the brief’s goals of keeping LLM API calls centralized, minimizing code complexity, and preserving performance-critical behaviors, while porting the Continue innovations that materially improve quality, cost, and latency.

Direction informed by:

- Two independent reviews favor Classic as base: [review-opus.md](review-opus.md), [review-opus-B.md](review-opus-B.md)
- One review recommends New as base due to feature richness and modularity: [review-glm.md](review-glm.md)
- Direct code inspection of Classic files:
    - Main provider: [GhostInlineCompletionProvider.ts](src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts)
    - Prompting: [HoleFiller.ts](src/services/ghost/classic-auto-complete/HoleFiller.ts)
    - Context: [GhostContextProvider.ts](src/services/ghost/classic-auto-complete/GhostContextProvider.ts)
    - Filtering: [uselessSuggestionFilter.ts](src/services/ghost/classic-auto-complete/uselessSuggestionFilter.ts)
- Direct code inspection of Continue components we plan to port:
    - Codestral FIM and multi-file template: [AutocompleteTemplate.ts](src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts)
    - Token-aware prompt rendering: [index.ts](src/services/continuedev/core/autocomplete/templating/index.ts)
    - Prefix-only cache usage: [CompletionProvider.ts](src/services/continuedev/core/autocomplete/CompletionProvider.ts)
    - Reuse manager: [GeneratorReuseManager.getGenerator()](src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts:31)
    - Debouncer: [AutocompleteDebouncer.delayAndShouldDebounce()](src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts:7)
    - Postprocessing and model quirks: [postprocessCompletion()](src/services/continuedev/core/autocomplete/postprocessing/index.ts:90)

Rationale:

- Classic already integrates with the extension’s LLM layer and cost/telemetry paths, minimizing duplication and long-term maintenance.
- Classic’s suffix-aware “partial typing” cache is closer to real FIM usage than Continue’s prefix-only cache.
- Continue brings crucial techniques we should port: native FIM prompting for Codestral, token-aware pruning, debouncing, generator reuse, and robust postprocessing.

Outcome: a single, unified provider that preserves Classic’s simplicity and integration while absorbing Continue’s correctness and performance features, plus a cohesive reuse/caching subsystem supporting multiple in-flight streams.

---

## Synthesis of external reviews

Consensus themes across reviews:

- Prompting: Native Codestral FIM is superior to Classic’s XML-style completion tag; keep FIM for Codestral.
- Cost/latency: Debouncing and cancellation are essential under rapid typing; generator reuse reduces wasted tokens.
- Token limits: Token-aware pruning prevents context-window failures in large files and multi-file scenarios.
- Filtering/quality: Model-specific postprocessing improves acceptance rates by cleaning spacing, newlines, and repetitions.
- Caching: Classic’s suffix-aware cache with partial-match handling is stronger than prefix-only LRU for FIM.

Divergence:

- Base selection splits on architecture philosophy. Opus reviews prioritize Classic’s integration and lower complexity; GLM favors Continue’s modular completeness.

Synthesis given code reality:

- The Classic provider’s integration and size make it the pragmatic base.
- We will port the Continue features that produce measurable value, but not its LLM abstraction stack.

---

## Evidence from code

- Classic suffix-aware cache and partial typing reuse:
    - [findMatchingSuggestion()](src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts:30)
- Classic XML prompt design:
    - [HoleFiller.ts](src/services/ghost/classic-auto-complete/HoleFiller.ts)
- Continue native Codestral FIM prompt and multi-file framing:
    - [AutocompleteTemplate.ts](src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts)
- Continue token-aware rendering and proportional pruning:
    - [index.ts](src/services/continuedev/core/autocomplete/templating/index.ts)
- Continue streaming reuse and debouncing:
    - [GeneratorReuseManager.getGenerator()](src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts:31)
    - [AutocompleteDebouncer.delayAndShouldDebounce()](src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts:7)
- Continue model-specific postprocessing for Codestral quirks:
    - [postprocessCompletion()](src/services/continuedev/core/autocomplete/postprocessing/index.ts:90)

---

## Base selection

Select Classic as the base. Justification:

- Integration: Keeps calls through the extension’s unified LLM client and telemetry paths already used across features.
- Maintainability: ~400 LOC scope and local concepts reduce surface area for defects compared to 3000+ LOC continue stack.
- Caching and reuse: GeneratorReuseManager already covers forward-typing reuse (skipping already-typed chars) and Classic’s suffix-aware/partial-typing cache covers reuse across requests and backspaces; a hybrid reuse-first, cache-second approach best matches real FIM editing dynamics.
- Feature porting risk: Simpler and lower-risk to import the specific Continue components than to excise Classic logic into Continue’s larger framework.

---

## What to integrate from Continue (prioritized)

Critical

- Native Codestral FIM prompt and multi-file framing
    - Replace Classic’s XML tag prompt with Codestral FIM while keeping a generic path for non-FIM models.
    - Source: [AutocompleteTemplate.ts](src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts)
- Token-aware pruning
    - Use proportional prefix/suffix reduction to avoid context-window overflow.
    - Source: [index.ts](src/services/continuedev/core/autocomplete/templating/index.ts)
- Debouncing and proper cancellation
    - Introduce per-document debouncer and AbortController propagation to suppress bursts.
    - Source: [AutocompleteDebouncer.delayAndShouldDebounce()](src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts:7)
- Model-specific postprocessing
    - Add Codestral spacing/double-newline cleanup and general repetition/whitespace filters.
    - Source: [postprocessCompletion()](src/services/continuedev/core/autocomplete/postprocessing/index.ts:90)

Important

- Streaming generator reuse
    - Reuse in-flight stream when user appends to the prefix; drop duplicate already-typed chars.
    - Source: [GeneratorReuseManager.getGenerator()](src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts:31)
- Multi-file context formatting
    - Keep the “+++++ path” file framing to increase cross-file signal for Codestral FIM.
    - Source: [AutocompleteTemplate.ts](src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts)

Nice-to-have

- Additional postprocessing rules and bracket matching later if measurable benefit.
    - Example sources: [postprocessing/index.ts](src/services/continuedev/core/autocomplete/postprocessing/index.ts)

Skip

- Continue’s parallel LLM abstraction and unrelated subsystems (e.g., NextEdit).
    - We will keep centralized LLM integration.

---

## Caching and reuse strategy (cohesive design)

Goal: fuse generator reuse, debouncing, and cache to reuse already-streaming responses, and support more than one in-flight response when appropriate.

Note on FIM dynamics: GeneratorReuseManager handles forward-typing partial completion reuse by trimming already-typed characters from the stream, functionally overlapping with Classic’s partial-typing cache. The unified design will prioritize stream reuse when possible, then fall back to a suffix-aware cache when reuse is not possible (e.g., backspace, edit-in-middle, or expired stream). This aligns with a reuse-first, cache-second policy.

Proposed high-level components:

- RequestCoordinator (per text editor)
    - Orchestrates debouncing, cancellation, and stream registration.
    - Maintains a monotonically increasing request sequence and a map of inflight streams keyed by promptKey = hash(model, filepath, prunedPrefix, suffix, options).
- StreamRegistry
    - Allows multiple in-flight streams when structurally different promptKeys exist (e.g., divergence after edits).
    - If a new request’s prefix extends the pendingGeneratorPrefix + pendingCompletion, reuse the existing stream via [GeneratorReuseManager.getGenerator()](src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts:31).
    - If request backspaces or otherwise invalidates reuse, start a new stream and retire/conflict-cancel the old one with AbortController.
- SuffixAwareCache
    - Start from Classic’s [findMatchingSuggestion()](src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts:30) semantics, add small LRU bounds.
    - Promote positive streaming outcomes into cache, keyed by prefix+suffix plus language/file identity; partial-typing path continues to consume cached remainder.
- Debouncer
    - Per-document instance uses [AutocompleteDebouncer.delayAndShouldDebounce()](src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts:7).
    - Only the latest pending request after the delay proceeds; previous are considered superseded unless sharing a reuseable stream.

This yields:

- Rapid typing: minimal new API calls; streaming reuse masks latency and cost.
- Backspace: promptKey changes; old stream aborted or sidelined; cache still assists if viable.
- Multi-file: promptKey naturally incorporates the multi-file prefix.

---

## Feature gap analysis and priorities

- Keep from Classic
    - LLM integration and cost tracking via GhostModel paths
    - Suffix-aware and partial-typing cache behavior
- Port from Continue
    - Critical: Codestral FIM prompts, token-aware pruning, debouncer, model-specific postprocessing
    - Important: generator reuse, multi-file file-header framing
    - Nice-to-have: bracket matching and broader postprocessing rules

---

## Porting effort (high-level)

- FIM template swap-in and multi-file framing: Medium
- Token-aware pruning: Medium
- Debouncer and AbortController integration: Easy
- Model-specific postprocessing: Easy
- Generator reuse integration with RequestCoordinator/StreamRegistry: Medium–Hard (careful with cancellation and promptKey semantics)
- Cache consolidation (Classic semantics + small LRU): Easy–Medium

---

## Implementation plan (high-level, phased)

Phase 1: Prompting and correctness

- Replace Classic XML prompt with Codestral FIM; keep a generic prompt path for non-FIM models.
    - Sources: [AutocompleteTemplate.ts](src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts)
- Add token-aware pruning to render path.
    - Source: [index.ts](src/services/continuedev/core/autocomplete/templating/index.ts)
- Integrate model-specific postprocessing.
    - Source: [postprocessCompletion()](src/services/continuedev/core/autocomplete/postprocessing/index.ts:90)

Phase 2: Cost/latency controls

- Introduce per-editor debouncer and AbortController cancellation chain.
    - Source: [AutocompleteDebouncer.delayAndShouldDebounce()](src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts:7)
- Implement RequestCoordinator and StreamRegistry; integrate [GeneratorReuseManager.getGenerator()](src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts:31) for streaming reuse.

Phase 3: Caching unification

- Keep Classic’s suffix-aware/partial-typing behavior; wrap with bounded in-memory LRU for memory hygiene.
- Promote successful completions and incremental streaming outcomes into cache keyed by promptKey.

Phase 4: Cleanup and consolidation

- Remove continue-dev LLM stack and non-autocomplete subsystems after parity is verified.
- Remove the Classic/New toggle; keep only the unified provider entry point.

Phase 5: Validation

- Scenarios from the brief:
    - Rapid typing, backspace correction, multi-file context, large files, model quirks
- Metrics: API call rate, acceptance rate, cache hit rate, token failure rate, perceived latency.

---

## Risk analysis and mitigations

- Streaming reuse correctness under rapid edits
    - Mitigation: strict promptKeying, sequence-based supersession, exhaustive tests around extend vs backspace vs edit-in-middle.
- Token pruning aggressiveness
    - Mitigation: conservative buffers; log and compare before/after prompt lengths; fall back to safe truncation on error.
- Cache staleness or false positives
    - Mitigation: include suffix and file identity in keys; short TTL/LRU size; keep partial-typing rules narrow.
- Model variability beyond Codestral
    - Mitigation: prompt template registry with per-model selection; default to simple path for unknown models.

---

## Success criteria

- Cost: 50–80% reduction in API calls during active typing (debounce + reuse + cache).
- Quality: 10–15% increase in acceptance, driven by FIM + postprocessing + multi-file headers.
- Robustness: near-zero prompt-too-long failures in large files; graceful cancellation behavior.
- Maintainability: single provider path under ~800–1000 LOC; centralized LLM usage; clear module boundaries for prompting, pruning, postprocess, reuse, and cache.

---

## Files of interest (for implementation)

- Classic integration targets
    - Provider: [GhostInlineCompletionProvider.ts](src/services/ghost/classic-auto-complete/GhostInlineCompletionProvider.ts)
    - Prompting swap-in: [HoleFiller.ts](src/services/ghost/classic-auto-complete/HoleFiller.ts)
    - Context feed: [GhostContextProvider.ts](src/services/ghost/classic-auto-complete/GhostContextProvider.ts)
    - Filter extension: [uselessSuggestionFilter.ts](src/services/ghost/classic-auto-complete/uselessSuggestionFilter.ts)
- Continue sources to mine
    - FIM/multi-file template: [AutocompleteTemplate.ts](src/services/continuedev/core/autocomplete/templating/AutocompleteTemplate.ts)
    - Token pruning: [index.ts](src/services/continuedev/core/autocomplete/templating/index.ts)
    - Debouncer: [AutocompleteDebouncer.ts](src/services/continuedev/core/autocomplete/util/AutocompleteDebouncer.ts)
    - Reuse: [GeneratorReuseManager.ts](src/services/continuedev/core/autocomplete/generation/GeneratorReuseManager.ts)
    - Postprocessing: [postprocessing/index.ts](src/services/continuedev/core/autocomplete/postprocessing/index.ts)

---

## Final position

Adopt Classic as the unified base and import targeted continue.dev components:

- Prompting: use Codestral FIM with multi-file framing by default for Codestral models.
- Token-aware pruning: integrate proportional prefix/suffix reductions.
- Cost/latency control: add debouncing, AbortController cancellation, and streaming reuse.
- Caching: preserve Classic’s suffix-aware and partial-typing semantics with a small LRU.
- Quality: apply model-specific postprocessing, starting with Codestral whitespace/newline rules.

This delivers the best blend of correctness, latency, cost, and maintainability with a cohesive reuse-and-cache layer capable of handling multiple in-flight streams when edits legitimately diverge.
