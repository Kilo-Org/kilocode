# kilocode_change Marker Review — upstream v1.18.13 merge

**Reviewed HEAD:** cce22e608f · **Pre-merge Kilo base:** b135b4e10a · **Upstream tag:** v1.18.13 (a105350812)

## Scope & Methodology

Checked all **390 files** changed by the merge (`git diff --name-only b135b4e10a..HEAD`, plus `--diff-filter=D` for deletions and `-R` for renames: 3 deleted files, 1 rename).

Approach:

1. **Scripted count comparison** — for every changed file: `git show b135b4e10a:<path> | grep -c kilocode_change` vs `grep -c kilocode_change <path>`. 107 files carried markers before and/or after. Result: **24 files lost markers, 16 gained markers, 3 deleted (0 markers each), 64 unchanged counts**.
2. **Diff inspection of every drop** — for each of the 24 losing files, read `git diff b135b4e10a..HEAD -- <path>` and judged legitimacy, including an upstream-identity check (`git diff a105350812..HEAD -- <path>` empty ⇒ file is now upstream-native).
3. **Same-count verification** — for the 64 count-stable files, compared the sorted set of marker line texts old vs new. 3 files had changed marker texts; each was inspected.
4. **Key-level audit of the i18n consolidation** — extracted every previously-marked key from all 20 changed locale files and verified each is either now present upstream or still inside a marked block.
5. **Block balance check** — `kilocode_change start` vs `end` counts per changed file.
6. **Forbidden-path check** — no `kilocode_change` markers may exist in `packages/kilo-vscode/` or `packages/kilo-ui/`.

## Findings

### 1. SUSPICIOUS — `packages/opencode/src/provider/transform.ts`: Kilo modification in `anthropicAdaptiveEfforts` lost its markers (60 → 54 markers)

The merge removed this marked block:

```ts
-  // kilocode_change start - include Claude 5+ models
-  if (anthropicOpus47OrLater(apiId) || anthropicClaude5(apiId)) {
-    return ["low", "medium", "high", "xhigh", "max"]
-  }
-  // kilocode_change end
```

and replaced it with:

```ts
  if (anthropicUsesModernAdaptiveThinking(apiId) || anthropicClaude5(apiId)) {
    return ["low", "medium", "high", "xhigh", "max"]
  }
```

**Evidence:** upstream v1.18.13 has `if (anthropicUsesModernAdaptiveThinking(apiId)) {` — the `|| anthropicClaude5(apiId)` disjunct is still a Kilo-specific modification (Kilo's Claude-5/fable aliases), but it is now **completely unmarked**. The identical modification one function below, `anthropicOmitsThinking`, kept its marker (`// kilocode_change - include Kilo aliases`), and the `anthropicClaude5` helper itself retains its own start/end block — so this looks like an accidental drop during the compat refactor (`0fff61fa62`), not a deliberate unmarking. Behavior is intact; the loss is merge-discoverability for the next upstream sync.

### 2. NEEDS HUMAN VERIFICATION — `packages/opencode/src/provider/transform.ts`: grok variant suppression deleted with its markers

The merge removed, in `variants()`:

```ts
-  // kilocode_change start
-  if (id.includes("grok") && !id.includes("grok-4.5")) {
-    return {}
-  }
-  // kilocode_change end
```

**Evidence:** this guard was purely Kilo's (upstream has no equivalent; `git log` ties it to Kilo PR #12086 "fix/grok-4.5-reasoning-variants"). It ran before the npm switch, so *any* grok model except grok-4.5/grok-3-mini got **no** reasoning variants on **all** providers. After the merge, no replacement exists (`grep grok` now only finds the grok-3-mini case). Consequences differ by provider: via `@kilocode/kilo-gateway` grok still gets `{}` through the gpt/gemini-3/claude/mercury allowlist, but via `@openrouter/ai-sdk-provider` a non-4.5 grok now receives `WIDELY_SUPPORTED_EFFORTS` variants where it previously got none. This may be an intentional product decision taken during conflict resolution (`88083fb5c5` / `0fff61fa62`), but there is no comment or marker trail explaining it — a human should confirm the behavior change was intended.

### 3. NEEDS HUMAN VERIFICATION (pre-existing, not merge-introduced) — `packages/opencode/src/provider/provider.ts`: unbalanced marker block

13 `kilocode_change start` vs 12 `kilocode_change end` — the `// kilocode_change start - load auths before env so OAuth plugins can override inherited credentials` at line 1571 has no matching `end`. The identical 13/12 imbalance exists in b135b4e10a, so this merge did **not** cause it, but the unterminated block makes the marked region's extent ambiguous for future merges. Worth fixing independently.

### 4. OBSERVATION (pre-existing hygiene, flagged for completeness) — i18n locales `en`, `da`, `br` retain unmarked Kilo-specific lines

17 locales (ar, bs, de, es, fr, it, ja, ko, nl, no, pl, ru, th, tr, uk, zh, zht) consolidated all Kilo-only keys into a single trailing `kilocode_change start/end` block — several previously *unmarked* Kilo keys (`ui.sessionTurn.status.delegatingWaitingPermission/Question`, `ui.messagePart.mcp.input/output`) are now properly marked there. `en.ts`, `da.ts`, `br.ts` kept the old layout (mermaid block + 4 single-line markers) and still carry those same Kilo-only keys **plus** the `OpenCode Go → Kilo Go` branding lines with no marker — exactly as before the merge. No marker was *removed* here (pre-merge state was equally unmarked), so this is not a regression, but the locale files are now inconsistently marked and a future upstream dictionary refresh could silently overwrite the unmarked Kilo lines in en/da/br.

### 5. MINOR — `packages/opencode/src/provider/transform.ts`: kilo-gateway condition line lost its inline marker

```ts
-    model.api.npm === "@kilocode/kilo-gateway" // kilocode_change
```

was restructured by upstream into a standalone Kilo-only block:

```ts
  if (model.api.npm === "@kilocode/kilo-gateway") {
    if (!model.capabilities.reasoning) return {} // kilocode_change - omit unsupported reasoning options
    return { reasoning: { enabled: true } } // kilocode_change - use the model's supported default effort
  }
```

The `if` line itself is now unmarked; the body lines remain marked, so the block is still identifiable. Legitimate refactor with slightly weakened marking.

## Notable non-findings (large legitimate drops)

- **18 i18n locale files (−88 markers total, e.g. uk.ts 28 → 2):** intentional consolidation into a single `kilocode_change start/end` "preserve Kilo UI translations across the upstream dictionary refresh" block. Key-level audit: every previously-marked key in every locale is either now present in upstream's dictionary (verified for all 15 uk.ts keys that left the marked set) or inside the new preserved block. No Kilo translation lost its marker without cause.
- **`packages/core/src/models-dev.ts` (10 → 7):** removed markers guarded the `reasoning_options` schema, a Kilo backport explicitly noted as "snatched from upstream". Upstream v1.18.13 now has it natively (line 76) — markers correctly retired. Same story for the `reasoningVariants` block markers in `transform.ts` ("snatched from upstream v1.18.11, #36624"; now upstream-native at upstream line 1648).
- **`packages/opencode/src/session/processor.ts` (98 → 97):** the marked line `metadata: match.part.state.metadata, // kilocode_change` was adopted by upstream verbatim (including its comment) — file region is now upstream-native.
- **Now byte-identical to upstream (diff vs a105350812 is empty):** `packages/opencode/test/account/service.test.ts` (−1), `packages/opencode/test/mcp/oauth-browser.test.ts` (−2, upstream rewrote the browser-open mock, making Kilo's listener-buffering workaround obsolete), `packages/session-ui/src/components/markdown-worker.ts` (−2, upstream restructured the worker; Kilo's `KiloTheme` survives fully marked in `packages/ui/src/components/markdown-worker.ts` and `packages/ui/src/context/marked.tsx`), `packages/session-ui/src/components/markdown.worker.ts` (renamed from markdown-shiki.worker.ts, 0 markers before/after).
- **`packages/ui/src/context/marked.tsx` (33 → 31):** one marked type-import block was merged into the line-1 import statement; the file retains 31 markers around all Kilo behavior. The other delta is a reworded marker comment.
- **Same-count text changes, all legitimate:** `packages/core/src/fs-util.ts` (marker followed the `ensureDirectory` call after upstream wrapped it in an EEXIST catch), `packages/opencode/src/mcp/index.ts` (block re-marked with updated description after upstream refactored tool creation; Kilo's `SandboxNetwork.remote` wrapping intact), `packages/opencode/src/tool/task.ts` (`canTask` rewritten from `KiloTask.nestedTask()` to `depth + 1 < (cfg.subagent_depth ?? 1)` — intentional adoption of upstream's new opt-in `subagent_depth` config, which exists in `packages/core/src/v1/config/config.ts`; `canTask` itself is Kilo-only and stays marked).
- **16 files gained markers** (e.g. `tool/registry.ts` 54 → 59, `session/tools.ts` 25 → 26, new `tool/code-mode.ts` +6, new `test/tool/code-mode*.test.ts` +18/+19): new marking for the code-mode / network-restriction work; all inspected additions are well-formed and described.
- **`packages/kilo-vscode/` / `packages/kilo-ui/`:** clean — the only `kilocode_change` strings are backtick-quoted references in a test comment and AGENTS.md, and the `check-kilocode-change` script in package.json itself (all excluded by that script's own filters).
- **Deleted files** (`packages/session-ui/.../markdown-preload.test.ts`, two `patches/*.patch`): carried 0 markers.

## Limitations

- Count comparison is line-based; a marker moved far from its code within the same file would not be flagged if the count and marker texts are unchanged. The sorted marker-text check mitigates this for the 64 count-stable files (only 3 text changes, all inspected), but does not verify *proximity* of marker to code.
- Judgments of "intentional" removal are inferred from code shape and upstream identity, not from the merger's intent; findings 2 and 3 especially warrant confirmation by whoever ran the conflict resolution.
- New upstream files that Kilo marked during this merge were spot-checked, not exhaustively diffed line-by-line.
- The repo's own guard (`script/check-opencode-annotations.ts --worktree`) reports "nothing to check" on a clean worktree and was not applicable to a committed merge diff; this review's scripted comparison supersedes it.
