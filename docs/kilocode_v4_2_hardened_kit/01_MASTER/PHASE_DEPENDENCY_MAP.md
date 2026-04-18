# Phase Dependency Map

## Major block graph
A -> B -> C -> D -> E -> F -> G -> H -> I

## Parallelization notes
- Phases 17-25 can overlap once 17 and 19 are stable.
- Phases 27-34 can overlap after 27.
- Phases 45-49 can be developed in parallel after 45.
- Phases 53-56 can overlap after 53.
- Phases 59-66 can overlap after 59 and 61.
- Phase 72 requires all prior critical rows to be updated in the truth matrix.

## Hard unlock rules
- No ZeroClaw execution phase may pass before governance risk rules exist.
- No release phase may pass before rollback path is documented.
- No speech phase may pass without input, output, and error-path evidence.
