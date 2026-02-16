# PR #321 Split Proposal

**Original PR:** #321 — "refactor(kilo-vscode) Massive changes, refactor everything" by bernaferrari
**Files changed:** ~95 | **Base:** dev ← **Head:** all-new

This document proposes splitting PR #321 into 11 smaller PRs that can each be reviewed and merged independently. PRs are ordered by dependency — earlier PRs must merge first.

---

## PR 1: Utility foundations & type declarations

**Description:** Introduce the low-level utility modules that other PRs depend on. These are pure functions with no side effects and no dependence on VS Code extension APIs beyond `OutputChannel`.

**Size:** S (164 additions)

**Files:**
| File | +/- |
| --- | --- |
| `src/utils/logger.ts` | +54 |
| `src/utils/open-external.ts` | +23 |
| `src/utils/path-security.ts` | +31 |
| `src/utils/telemetry.ts` | +32 |
| `src/utils/webview-csp.ts` | +15 |
| `src/types/tar-fs.d.ts` | +9 |

**Dependencies:** None — this is the first PR to merge.

**Review notes:** All utilities reviewed as clean with no security concerns. `path-security.ts` and `open-external.ts` are textbook implementations. `telemetry.ts` is currently a no-op stub. `webview-csp.ts` has a `connect-src` difference from the existing CSP that needs verification at call sites (handled in PR 5).

---

## PR 2: CLI backend infrastructure

**Description:** Auth helper, connection service refactor (DI seams, reconnecting state), server manager username support, SSE client exponential backoff, HTTP client timeouts + new endpoints, and expanded backend types.

**Size:** L (754 additions, 192 deletions)

**Files:**
| File | +/- |
| --- | --- |
| `src/services/cli-backend/auth.ts` | +5 |
| `src/services/cli-backend/connection-service.ts` | +40/−12 |
| `src/services/cli-backend/http-client.ts` | +420/−116 |
| `src/services/cli-backend/index.ts` | +4 |
| `src/services/cli-backend/server-manager.ts` | +26/−20 |
| `src/services/cli-backend/sse-client.ts` | +155/−35 |
| `src/services/cli-backend/types.ts` | +104/−9 |
| `tests/integration/connection-service.integration.test.ts` | +188 |

**Dependencies:** PR 1 (uses `logger.ts`).

**Review notes:** Breaking change — `ServerConfig.username` is now required. HTTP client adds `AbortController` timeouts (10s connect, 60s request). SSE adds exponential backoff. Test coverage gaps: no error/reconnection tests. `auth.ts` may need formatting fixes for lint compliance.

---

## PR 3: New standalone services (auto-purge, code actions, contributions, MDM, prompt enhancement, workspace search)

**Description:** Six new service modules that are self-contained and don't heavily couple to `KiloProvider`. Each addresses a distinct feature area.

**Size:** M (947 additions)

**Files:**
| File | +/- |
| --- | --- |
| `src/services/auto-purge/auto-purge-service.ts` | +196 |
| `src/services/auto-purge/index.ts` | +2 |
| `src/services/code-actions/KiloCodeActionProvider.ts` | +66 |
| `src/services/contributions/contribution-tracker.ts` | +216 |
| `src/services/mdm/mdm-policy.ts` | +107 |
| `src/services/prompt-enhancement/handleEnhancePromptRequest.ts` | +100 |
| `src/services/search/workspace-search.ts` | +362 |
| `tests/unit/contribution-tracker.test.ts` | +118 |

**Dependencies:** PR 1 (uses `logger.ts`, `path-security.ts`), PR 2 (uses HTTP client for prompt enhancement).

**Review notes:** `auto-purge-service.ts` needs path-boundary validation on `tempAttachmentsDir`. `contribution-tracker.ts` needs a size guard on diffLines input. `workspace-search.ts` magic scoring numbers should be named constants. Code actions and MDM policy are clean.

---

## PR 4: Settings infrastructure (validation, provider config normalization, rules/workflows, settings sync)

**Description:** Settings validation schemas (Zod), provider config normalization for legacy→native field mapping, rules/workflows file management with path-traversal protection, and VS Code settings sync key registration.

**Size:** M (753 additions)

**Files:**
| File | +/- |
| --- | --- |
| `src/services/settings/validation.ts` | +297 |
| `src/services/settings/provider-config-normalization.ts` | +115 |
| `src/services/settings/rules-workflows.ts` | +226 |
| `src/services/settings-sync/index.ts` | +115 |

**Dependencies:** PR 1 (uses `path-security.ts` for rules-workflows path validation).

**Review notes:** All pure data transformation or filesystem-scoped operations. `rules-workflows.ts` has proper `ensurePathInsideScope()` validation and filename sanitization. Validation uses `.strict()` Zod schemas where appropriate.

---

## PR 5: KiloProvider expansion

**Description:** The massive `KiloProvider.ts` expansion — new message handlers, cached message pattern, attachment handling with path restrictions, CSP migration to `buildWebviewCsp()`, workspace directory fallback change.

**Size:** XL (3,168 additions, 450 deletions)

**Files:**
| File | +/- |
| --- | --- |
| `src/KiloProvider.ts` | +3168/−450 |

**Dependencies:** PR 1 (uses `webview-csp.ts`, `open-external.ts`, `path-security.ts`, `logger.ts`), PR 2 (uses HTTP client, connection service, types), PR 3 (uses auto-purge, contributions, prompt enhancement, search), PR 4 (uses settings validation, provider config normalization, rules-workflows, settings sync).

**Review notes:** This is the largest single file change and the hardest to review. Key concerns:
- Unbounded URL fetching (SSRF) in attachment downloading — needs `AbortController` timeout + size cap
- Unbounded `data:` URL decoding — needs payload size limit
- `connect-src` CSP change from localhost wildcards to `${cspSource}` — verify CLI backend connectivity still works
- `getWorkspaceDirectory()` falls back to `os.homedir()` instead of `process.cwd()`
- Positive: adds workspace-scoped path restrictions for file attachments

**Splitting further:** This file _could_ be split by extracting message handler groups into separate modules first (e.g. attachment handlers, settings handlers, session handlers), but that would be a refactor on top of the refactor. Pragmatically, reviewing this as one PR with the understanding of its dependencies is the best approach.

---

## PR 6: Marketplace service

**Description:** Complete marketplace feature — catalog fetching, skill installation (tarball download + extraction), MCP server installation, schema validation, types.

**Size:** L (893 additions)

**Files:**
| File | +/- |
| --- | --- |
| `src/services/marketplace/marketplace-service.ts` | +727 |
| `src/services/marketplace/schema.ts` | +90 |
| `src/services/marketplace/types.ts` | +73 |
| `src/services/marketplace/index.ts` | +3 |

**Dependencies:** PR 1 (uses `logger.ts`), PR 2 (may interact with HTTP client for backend calls).

**Review notes:** **Highest security risk in the PR.** Three issues must be fixed before merge:
1. 🔴 Tar extraction path traversal — `installSkill()` uses `tar-fs` with `strip: 1` but no path-traversal protection. Add a `map` callback to reject `..` segments and absolute paths.
2. 🔴 MCP config injection — `installMcp()` writes `command` fields from catalog API. Add validation/sanitization + user confirmation.
3. 🟡 Regex injection — `new RegExp(param.key)` without escaping. Use `String.prototype.replaceAll()` instead.

---

## PR 7: extension.ts command registration

**Description:** The expanded `extension.ts` that registers all new commands (URL ingestion, workspace search/indexing, GitHub integration, commit message generation, code review, slash/workflow helpers) and wires up new services.

**Size:** L (1,410 additions, 6 deletions)

**Files:**
| File | +/- |
| --- | --- |
| `src/extension.ts` | +1410/−6 |

**Dependencies:** PR 2 (connection service constructor changes), PR 3 (services registered here), PR 4 (settings services), PR 5 (KiloProvider constructor signature change), PR 6 (marketplace service registration).

**Review notes:** URL ingestion uses `fetch()` on arbitrary user URLs with no timeout/size cap/IP blocklist — needs SSRF mitigations. Commit message generation collects diffs that may include secrets — needs stronger default excludes. Constructor signature changes for `KiloProvider` and `AgentManagerProvider` are wired here.

---

## PR 8: AgentManagerProvider worktree management

**Description:** Major expansion of `AgentManagerProvider` with parallel worktree creation, multi-session orchestration, setup scripts, share URLs, and metadata management.

**Size:** XL (5,293 additions, 48 deletions)

**Files:**
| File | +/- |
| --- | --- |
| `src/AgentManagerProvider.ts` | +5293/−48 |

**Dependencies:** PR 2 (depends on `KiloConnectionService`), PR 7 (constructor wired in extension.ts).

**Review notes:** **Contains the highest-severity security issue in the entire PR:**
- 🔴 `removeWorktree()` falls back to `fs.rm(worktreePath, { recursive: true, force: true })` — must hard-validate path is inside `${workspaceDir}/.kilocode/worktrees/`
- Setup script written with chmod 755 — ensure never auto-executed
- Share URLs hardcoded to `https://app.kilo.ai/share/<id>` — privacy/compliance consideration

---

## PR 9: Autocomplete changes

**Description:** `FileIgnoreController` rewrite from stub to real `.gitignore`/`.kilocodeignore` support, plus minor constructor changes and eslint-disable cleanup in continuedev vendored code.

**Size:** S (92 additions, 21 deletions)

**Files:**
| File | +/- |
| --- | --- |
| `src/services/autocomplete/shims/FileIgnoreController.ts` | +83/−13 |
| `src/services/autocomplete/chat-autocomplete/handleChatCompletionRequest.ts` | +1/−1 |
| `src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.ts` | +1/−1 |
| `src/services/autocomplete/continuedev/core/autocomplete/generation/GeneratorReuseManager.test.ts` | −1 |
| `src/services/autocomplete/continuedev/core/llm/index.ts` | −2 |
| `src/services/autocomplete/continuedev/core/llm/llamaTokenizer.js` | +7/−3 |

**Dependencies:** None — fully self-contained within the autocomplete module.

**Review notes:** Clean bundle. `FileIgnoreController` uses the well-established `ignore` package, preserves sensitive-file checks, constrains paths to workspace. Continuedev changes are trivial lint/style cleanup.

---

## PR 10: Gateway API & kilo-ui CSS bridge

**Description:** New gateway endpoints (extension settings, remote sessions) and kilo-ui VS Code theme bridge typography variables.

**Size:** M (304 additions, 3 deletions)

**Files:**
| File | +/- |
| --- | --- |
| `packages/kilo-gateway/src/api/profile.ts` | +30 |
| `packages/kilo-gateway/src/api/remote-sessions.ts` | +91 |
| `packages/kilo-gateway/src/server/routes.ts` | +153/−3 |
| `packages/kilo-ui/src/styles/vscode-bridge.css` | +30 |

**Dependencies:** None within kilo-vscode. Gateway changes are consumed by PR 2's HTTP client and PR 5's KiloProvider.

**Review notes:** All 3 new gateway endpoints are properly auth-gated with Zod input validation. `remote-sessions.ts` blob URL fetch lacks origin validation (low risk). Verify `wellknown` auth type is pre-existing. CSS changes are pure variable bridging — no security concerns.

---

## PR 11: Docs, CI, scripts, config & package.json

**Description:** Documentation updates (migration plan status, feature docs), CI workflow, build scripts, VS Code workspace config, package.json expansion, lockfile, LICENSE, README.

**Size:** L (~1,500 additions across many files)

**Files:**
| File | +/- |
| --- | --- |
| `packages/kilo-vscode/package.json` | +286/−20 |
| `packages/kilo-vscode/LICENSE` | +22 |
| `packages/kilo-vscode/README.md` | +39/−53 |
| `packages/kilo-vscode/AGENTS.md` | +1/−1 |
| `packages/kilo-vscode/.vscode/launch.json` | +1/−3 |
| `packages/kilo-vscode/.vscode/settings.json` | +2 |
| `packages/kilo-vscode/.vscode/tasks.json` | +25/−11 |
| `packages/kilo-vscode/.vscodeignore` | +8/−1 |
| `packages/kilo-vscode/scripts/bundle-size-audit.mjs` | +90 |
| `packages/kilo-vscode/scripts/verify-migration-plan-complete.mjs` | +28 |
| `.github/workflows/vscode-extension-smoke.yml` | +72 |
| `bun.lock` | +638/−8 |
| `packages/kilo-vscode/docs/opencode-migration-plan.md` | +67/−72 |
| `packages/kilo-vscode/docs/chat-ui-features/*.md` | ~16 files, minor updates |
| `packages/kilo-vscode/docs/non-agent-features/*.md` | ~18 files, minor updates |
| `packages/kilo-vscode/docs/infrastructure/*.md` | 4 files, minor updates |
| `packages/kilo-vscode/docs/unknowns/*.md` | 2 files, minor updates |

**Dependencies:** Should merge last (or at least after PRs 1–8), since `package.json` adds commands/settings/dependencies consumed by all other PRs, and docs claim features are "✅ Done".

**Review notes:**
- `tasks.json` and CI use `bun run` instead of `pnpm` — contradicts AGENTS.md
- `package.json` changes `engines.vscode` from `^1.109.0` to `^1.107.0`, changes view IDs (breaking for persisted state)
- Migration plan claims nearly everything is "✅ Done" — validate against actual implementation
- Scripts are clean (no network calls, no `eval()`)
- `mermaid` is a large new dependency — verify it's needed in kilo-vscode

---

## Dependency Graph

```
PR 1: Utilities & types          ←── no deps (merge first)
  ├── PR 2: CLI backend          ←── depends on PR 1
  │     ├── PR 3: New services   ←── depends on PR 1, PR 2
  │     ├── PR 6: Marketplace    ←── depends on PR 1, PR 2
  │     └── PR 10: Gateway/CSS   ←── independent (but consumed by PR 2, PR 5)
  ├── PR 4: Settings infra       ←── depends on PR 1
  └── PR 9: Autocomplete         ←── independent
        
PR 5: KiloProvider               ←── depends on PR 1, 2, 3, 4
PR 7: extension.ts               ←── depends on PR 2, 3, 4, 5, 6
PR 8: AgentManagerProvider        ←── depends on PR 2, 7

PR 11: Docs/CI/config/package    ←── merge last
```

## Suggested Merge Order

| Order | PR | Size | Risk |
| --- | --- | --- | --- |
| 1 | PR 9: Autocomplete changes | S | Low |
| 2 | PR 1: Utility foundations | S | Low |
| 3 | PR 10: Gateway API & kilo-ui CSS | M | Low |
| 4 | PR 2: CLI backend infrastructure | L | Medium |
| 5 | PR 4: Settings infrastructure | M | Low |
| 6 | PR 3: New standalone services | M | Low–Medium |
| 7 | PR 6: Marketplace service | L | **High** |
| 8 | PR 5: KiloProvider expansion | XL | **High** |
| 9 | PR 7: extension.ts commands | L | Medium |
| 10 | PR 8: AgentManagerProvider | XL | **High** |
| 11 | PR 11: Docs/CI/config/package | L | Low |

## Security blockers to resolve before any merge

These issues from the review must be addressed regardless of split strategy:

1. 🔴 **PR 8** — `removeWorktree()` `fs.rm` fallback needs path validation inside `.kilocode/worktrees/`
2. 🔴 **PR 6** — Tar extraction needs path-traversal protection (`map` callback)
3. 🔴 **PR 6** — MCP `installMcp()` needs config validation + user confirmation for `command` fields
4. 🟡 **PR 5/7** — URL fetching needs `AbortController` timeout + size cap
5. 🟡 **PR 6** — Regex injection in parameter templates needs escaping or `replaceAll()`
