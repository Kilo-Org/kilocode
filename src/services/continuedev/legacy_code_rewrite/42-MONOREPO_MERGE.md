# Monorepo Merge Summary — Final Phase 8

## Overview

The repository is now a truly flat monorepo with a single package manifest at the root. All runtime and dev dependencies are consolidated in [package.json](package.json). Child package.json and package-lock.json files were removed. All code locations are unchanged; only package structure and configuration were simplified.

## Phase History

- Phase 1: Baseline (commit 7fcb7f48) — Established baseline with all tests passing.
- Phase 2: Configuration Alignment (commit d660df92) — Shared ESLint config, upgraded TypeScript tooling versions.
- Phase 3: Tree-sitter Consolidation (commit cfa5686c) — Moved tag queries to [tree-sitter/tag-queries](tree-sitter/tag-queries).
- Phase 4: Dependency Consolidation (commit e81f8320) — Hoisted shared devDependencies to root.
- Phase 5: Script Consolidation (commit 1d335e91) — Unified npm scripts at root.
- Phase 6: TypeScript Project References (commit da7c26e8) — Enabled project references and incremental builds.
- Phase 7: Single package.json (commit <finalize-packages>) — Merged all package manifests into root [package.json](package.json); removed package.json files from core and harness.
- Phase 8: Final tsconfig consolidation (this commit) — Minimal tsconfig set retained; documentation finalized.

## Final tsconfig structure

The repository now uses a single root tsconfig for development and tests:

- Root: [tsconfig.json](tsconfig.json) — single configuration for all code
    - Global types: ["vitest/globals", "node"]; VS Code types are imported explicitly in harness files
    - noEmit: true; composite/incremental disabled
    - baseUrl/paths: maps "core" and "core/\*" to allow harness imports
- Removed:
    - [core/tsconfig.json](core/tsconfig.json)
    - [core/vscode-test-harness/tsconfig.json](core/vscode-test-harness/tsconfig.json)

## Rationale

- Production build configuration remains intentionally removed to enable a ground-up redesign of the build/publish process.
- Project references were removed to reduce configuration complexity; incremental builds are traded off for simplicity.
- VS Code types are brought in via explicit imports (for example, `import * as vscode from "vscode"`) within the harness, avoiding global type pollution.

## Developer workflow (root)

- Install: npm install
- Typecheck: npm run typecheck
- Test (all): npm test
- Note: Project references removed; incremental build graphs (`tsc --build`) are not used.
- Lint: npm run lint
- Format: npm run format

## File layout (key items)

- [package.json](package.json) — single manifest with all dependencies and scripts
- [tsconfig.json](tsconfig.json) — single TypeScript configuration
- [core/](core)
    - [vscode-test-harness/](core/vscode-test-harness)
- [tree-sitter/tag-queries/](tree-sitter/tag-queries) — consolidated tag queries

## Verification

The flat structure is validated end-to-end:

- TypeScript compilation: `npm run typecheck` succeeds.
- Tests: `npm test` — 707 tests passing (621 core + 86 harness).
- Editor support: single-project configuration with explicit VS Code imports in the harness.

## Notes

- Only configuration changed; source code and directory locations are unchanged.
- Autocomplete and NextEdit functionality fully preserved.
- Tree-sitter configuration working under [tree-sitter/](tree-sitter).
- The repository now has a single [package.json](package.json) and a single lockfile at the root.

## Change log (Phase 8)

- Removed [core/tsconfig.json](core/tsconfig.json) and [core/vscode-test-harness/tsconfig.json](core/vscode-test-harness/tsconfig.json).
- Replaced the project-reference graph with a single root [tsconfig.json](tsconfig.json) that uses baseUrl/paths for harness imports and relies on explicit `vscode` imports.
- Updated documentation to reflect the unified, development-only TypeScript setup.
