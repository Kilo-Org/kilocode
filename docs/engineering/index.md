# Engineering System of Record

This directory is the repo-local system of record for agent-legible engineering knowledge. Keep `AGENTS.md` short and put durable detail here.

## Map

|Topic|File|
|---|---|
|Architecture and package boundaries|[architecture.md](architecture.md)|
|Planning corpus and execution plans|[plans.md](plans.md)|
|Quality score and risk register|[quality.md](quality.md)|
|Reliability, local validation, and CI|[reliability.md](reliability.md)|
|Security expectations|[security.md](security.md)|
|Fork hygiene and markers|[fork-hygiene.md](fork-hygiene.md)|
|Coding standards and taste rules|[standards.md](standards.md)|
|Technical debt and cleanup loop|[technical-debt.md](technical-debt.md)|

## Operating Principles

- Repository knowledge is the source of truth. If a rule matters, capture it in docs or tooling.
- Prefer short entrypoints plus linked detail over long instruction blobs.
- New constraints should become checks with clear remediation text.
- Roll out new standards in warn mode, then enforce once the baseline is clean.
- Record plans and decisions where agents can discover them later.

## Current Alignment Slice

The first Harness alignment slice establishes agent legibility:

- `AGENTS.md` is a map, not a manual.
- Existing `.planning/` artifacts stay in place and are indexed from [plans.md](plans.md).
- `bun run standards:check` reports drift without blocking CI.
- `bun run standards:enforce` is available for checks that are ready to block.
