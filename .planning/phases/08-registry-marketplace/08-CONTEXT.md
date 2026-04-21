# Phase 8 Context — Team Registry & Marketplace

## Phase Goal
Remote team-template sharing via file-based MVP protocol. Publishers create signed manifests wrapping `TeamExportEnvelope`. Users install teams from URLs or files after verifying signatures against explicitly trusted publisher keys.

## Architecture Decision
**Clean** architecture selected (2026-04-21):
- New `team/registry/` submodule with clear separation
- Manifest wraps AROUND TeamExportEnvelope (no envelope churn)
- Ed25519 signing via Node.js built-in crypto (no external deps)
- Trust store with explicit key pinning (no TOFU)
- Browser-safe pure modules for Phase 9 webview

## Requirements Coverage

| Requirement | Plan | Task |
|---|---|---|
| Registry protocol (manifest schema) | 08-01 | Task 1 |
| `/team publish <path>` | 08-02 | Task 2, 3 |
| `/team install <url>` | 08-02 | Task 2, 3 |
| Signed manifest verification | 08-01, 08-02 | Task 2, Task 1 |
| Registry index format | 08-01 | Task 1 |
| Security review | 08-03 | Task 1 |

## Prior Phase Outputs

### Phase 6 (Export/Import)
- `team/export-envelope.ts` — `TeamExportEnvelope` Zod schema (wrapped by manifest)
- `team/checksum.ts` — `stableStringify`, `computeTeamChecksum`, `verifyTeamChecksum`
- `team/versioning.ts` — `TeamConfigVersion`, `CURRENT_TEAM_CONFIG_VERSION = "1.1.0"`
- `team/errors.ts` — Error class pattern (TeamImportError hierarchy)
- `team/io.ts` — `exportTeamToFile`, `importTeamFromFile`
- `workflow-tui/commands/team-io.ts` — Command handler pattern with DI

### Phase 7 (DAG)
- Version bumped to 1.1.0
- DAG validation integrated

## Key Decisions

| Decision | Rationale |
|---|---|
| Manifest wraps envelope | Preserves Phase 6 envelope schema unchanged |
| Ed25519 via Node crypto | Built-in, no external deps, proven support |
| Explicit key pinning | Security: no trust-on-first-use vulnerability |
| Trust store JSON file | Follows existing config file precedent |
| Browser-safe separation | Pure modules importable by Phase 9 webview |
| No HTTP upload in Phase 8 | File-based MVP; HTTP PUT deferred to Phase 9 |

## Spec Reference
`.planning/specs/08-registry-marketplace-spec.md`

## Plan Structure

| Plan | Wave | Deps | Primary Agents |
|---|---|---|---|
| 08-01 Registry Module Foundation | 1 | Phase 7 | Backend Architect, Senior Developer |
| 08-02 I/O Orchestration + Commands | 2 | 08-01 | Senior Developer, Frontend Developer |
| 08-03 Security Review + Docs | 3 | 08-02 | Security Engineer, Technical Writer |

## File Touch Summary

### NEW Files (team/registry/)
- `manifest.ts` — TeamRegistryManifest, TeamManifestMetadata, RegistryIndex schemas
- `errors.ts` — TeamSignatureError, TeamPublisherNotTrusted, TeamManifestFetchFailed, TeamManifestInvalid
- `signing.ts` — generateKeyPair, signManifest, verifyManifestSignature
- `http-client.ts` — fetchManifest with timeout
- `trust-store.ts` — load/save/add/remove trusted publishers
- `io.ts` — publishManifest, installManifest orchestration
- `index.ts` — barrel exports

### NEW Files (commands)
- `workflow-tui/commands/team-registry.ts` — publish/install/trust/untrust handlers

### EDIT Files
- `workflow-tui/command-input.tsx` — add team publish/install/trust branches
- `workflow-tui/index.tsx` — register registry commands
- `team/index.ts` — add registry re-exports

### NEW Docs
- `packages/devil-docs/pages/collaborate/teams/team-registry.md`

## Estimated LOC
- Source: ~800
- Tests: ~600
- Docs: ~180
- **Total: ~1,580**

---
*Generated: 2026-04-21*
