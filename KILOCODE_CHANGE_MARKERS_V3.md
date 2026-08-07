# kilocode_change Marker Review V3 — upstream v1.18.13 merge (round 3)

**Reviewed HEAD:** b6505b164b · **Round-2 HEAD:** 37a5cbf5db · **New PR base (merge-base with origin/main):** 6fce4e2564 · **Upstream tag:** v1.18.13 (a105350812)

## Scope & Methodology

Round 3 covers (a) re-verification of every open round-2 finding at the new head, (b) marker hygiene of the delta `git diff 37a5cbf5db..b6505b164b` (433 files — the branch merged latest origin/main plus the v1.18.0 lineage), (c) a fresh full-PR sweep at the new base `git diff 6fce4e2564...b6505b164b` (419 files), and (d) transform-coverage verification by actually executing the merge transforms against upstream blobs.

Approach:

1. **Round-2 re-verification** — per-file greps and `git diff a105350812..HEAD` for each open round-2 finding, plus the round-1 finding-4 residual (en/da/br Kilo-only keys).
2. **Delta count sweep** — markers at 37a5cbf5db vs head for all 433 delta files (tab-strict parsing, sanity-anchored against hand-verified counts). Result: **40 files with count changes: 36 gains, 4 drops**. Every drop diff-inspected and adjudicated; gains spot-checked for well-formedness. Block balance (`start` vs `end`) re-checked for every delta file at head: **all balanced**. Count-stable marker files re-checked by sorted marker-text comparison: exactly 1 text change (`transform-i18n.ts`), adjudicated below.
3. **Full-PR count sweep at new base** — 6fce4e2564 vs head across all 419 changed files. 134 marker-bearing files; **23 count-drop entries, all matching round-1/2 adjudications** (i18n consolidation, processor.ts 98→97, marked.tsx 33→31, models-dev.ts 10→7, markdown-worker/oauth-browser/account-service upstream-identity); **50 gains**.
4. **Zero-marker divergence sweep at new base** — 262 changed files with 0 markers outside kilo-owned paths; **58 diverge from upstream a105350812**; each classified by content (transform-reproducible / generated / infra / finding).
5. **Transform execution checks** — ran `applyBrandingTransforms` and `transformI18nContent` (markers mode) from `script/upstream/transforms/` against upstream blobs and compared byte-for-byte with head content.
6. **Forbidden-path check** — no `kilocode_change` markers in `packages/kilo-vscode/` or `packages/kilo-ui/` sources.

The 9 review-report `.md` files on this branch (rounds 1–3, incl. this one) contain the literal string `kilocode_change`; they are review artifacts, excluded from all conclusions.

## Round-2 finding verification status

### R2-N1 (9 of 28 "Kilo Go" locales unmarked) — FIXED

All 9 locale files now carry the inline `// kilocode_change` on the `dialog.usageExceeded.freeTier.description` branding line: `packages/ui/src/i18n/{az,fi,hi,id,pa,sv,uk,ur,vi}.ts` (e.g. `az.ts:72`, `uk.ts:80`). Fixed in delta commits `3003a302bc` / `d99467fa02`.

Stronger than a hand-fix: **the current `transform-i18n.ts` (markers mode) reproduces 8 of the 9 files byte-identically from upstream's blob** (az, fi, hi, id, pa, sv, ur, vi — 1 replacement each, marker appended). uk.ts equals transform output **plus** its pre-existing, separately marked trailing preservation block (`uk.ts:229+`, `// kilocode_change start - Kilo UI compatibility`). The locale set is now fully transform-consistent: a future dictionary refresh re-takes these files losslessly. All 28 locale files carry ≥1 marker.

### R2-N2 (import.test.ts unmarked Kilo test replacements) — STILL OPEN

`packages/opencode/test/cli/import.test.ts`: 0 markers at base, round-2 head, and new head; still diverges from upstream by 51+/8− (Kilo `app.kilo.ai/s/...` share-URL tests + Kilo-only `bootstrapImportedSessionIngest` / `ingestBootstrapWarning` tests replacing upstream's). Unchanged by the delta.

### R2-N3 (protocol/pty.ts unmarked Kilo functional addition) — STILL OPEN

`packages/protocol/src/groups/pty.ts`: 0 markers; `PTY_REPLAY_EXITED_QUERY = "replayExited"` (line 12) and its allowlist entry (line 139) remain an unmarked Kilo-only functional addition (absent at a105350812). Unchanged by the delta.

### R2-N4 (observation cluster) — STILL OPEN, unchanged

- `packages/core/test/tool-read.test.ts` — 0 markers; Kilo's `inspect` mock shape (`{ path, type, dev: 0, ino: 0 }` vs upstream `resolvedType`) still diverges, 6+/3−.
- `packages/storybook/.storybook/main.ts` — 0 markers; Kilo's removal of the `{ find: "@", replacement: app }` alias still diverges (0+/1−).
- `packages/ui/src/components/tabs.css` — 0 markers; `gap: 2px` vs upstream `gap: 0` (line 577).

### R1-F4 residual (en/da/br unmarked Kilo-only keys) — STILL OPEN

The four Kilo-only keys (`ui.sessionTurn.status.delegatingWaitingPermission/Question`, `ui.messagePart.mcp.input/output`) remain unmarked in `en.ts:86-87,101-102`, `da.ts:81-82,104-105`, `br.ts:83-84,109-110` (still absent from upstream's dictionary). The delta did not touch en/da/br. With the 9-locale fix landed, these three files are now the only locales with unmarked Kilo content.

## Delta hygiene (37a5cbf5db..b6505b164b)

**Verdict: clean.** Every Kilo-specific addition to a shared upstream file in the delta carries a well-formed marker; all blocks balanced. The 4 count drops adjudicated:

- **`packages/opencode/src/tool/task.ts` (54 → 53) — LEGIT (moved to kilocode path).** The dropped pair wrapped `resumeHint` (`// kilocode_change start - tell the parent agent how to resume a stopped/failed subagent (#11620)`); the function moved verbatim into new `packages/opencode/src/kilocode/task-resume.ts` (marker-exempt kilocode path), and the new import line in task.ts is itself marked (`import { resumeHint } from "../kilocode/task-resume" // kilocode_change`).
- **`packages/opencode/test/provider/transform.test.ts` (26 → 24) — LEGIT (upstream-native duplicate removed).** The removed marked block was Kilo's copy of `test("grok-4.5 uses standard reasoning efforts")`. Upstream v1.18.13 now ships the identical test (`a105350812:4432`, `describe("@ai-sdk/xai")`), which survives unmarked at head (line 4860); Kilo's redundant duplicate was deleted with its markers. Correct retirement.
- **`packages/opencode/src/cli/cmd/web.ts` (deleted, 5 → 0) — LEGIT (intentional removal, transform-managed).** Upstream still ships web.ts; Kilo now deletes it (`0f6a5607cd` remove-web-command, `7f1b402587` preserve). The deletion is wired into merge tooling: `skipFiles` entry with rationale comment (`script/upstream/utils/config.ts:139`) and new `script/upstream/transforms/remove-kilo-web.ts`, which rewrites `src/index.ts` to marked omission comments — present at head (`index.ts:25` and `:109`, matching the transform's `OMIT_IMPORT`/`OMIT_REGISTER` strings verbatim). No dangling unmarked `WebCommand` / `cli/cmd/web` references anywhere in src or test.
- **`.kilo/plans/agent-manager-multi-project-shipping-gaps.md` (deleted, 1 → 0)** — kilo-path plan doc; the "marker" was prose mentioning the convention. Non-issue.

Gain highlights (all spot-checked, well-formed, genuinely Kilo): `session/session.ts` +2 (fork child-remap block), `session/summary.ts` +6 and `snapshot/index.ts` +6 and `schema/src/file-diff.ts` +2 (full-content diff detail for editor diff tabs), server `groups/session.ts` +2 / `handlers/session.ts` +2 (full-detail query plumbing), `tool/grep.ts` +14 + `core/src/ripgrep.ts` +18 + `core/src/cross-spawn-spawner.ts` +9 (grep signal-controls / spawn-exit work, delegating to new kilocode-path modules), `cli/cmd/run/runtime.ts` +9 (run-terminal + variant preservation), `tui` spinner/runtime pinning +6 across 4 files, the 9 i18n branding markers, and the new `remove-kilo-web.ts` + test. The single count-stable marker-text change is `transform-i18n.ts` itself (the marker-append literal gained a `markers &&` guard) — tooling string, not a file annotation.

## New findings

### 1. SUSPICIOUS (hygiene) — `packages/ui/src/context/marked-code-span.ts` + `marked-code-span.test.ts`: Kilo-new files in a shared path without the `// kilocode_change - new file` header

Both files are absent from upstream (verified `a105350812` lacks them), entered through the merge lineage (`76783409bf` v1.18.0 compat / `0fff61fa62` v1.18.13 compat), are in the PR diff at the new base, and carry **0 markers**. `marked-code-span.ts` holds a Kilo workaround tokenizer for markedjs/marked#4011; its sibling `marked.tsx` in the same directory carries 31 markers and imports it (`marked.tsx:12`). The convention is applied to comparable files in this very PR (`packages/tui/src/routes/session/terminal.tsx:1` has the header; `script/check-test-ci.ts`, `script/check-model-tool-network.ts`, `packages/opencode/src/provider/models.ts` all carry it), so the omission looks accidental rather than conventional. Discoverability is partially provided by the marked.tsx import, but a future upstream-side refresh of `packages/ui/src/context/` would not know these two files are Kilo-owned. Recommend adding the one-line header to both.

### 2. NEEDS HUMAN VERIFICATION — `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`: two upstream assertions deleted, unmarked, delta-introduced

Branch commit `cb44dd327c` ("fix(tui): stabilize highlighted file-tree test", **not on origin/main**, authored 2026-08-07 on the v1.18.0 lineage) deleted:

```ts
-    expect(focused.some((line) => line.includes("*"))).toBe(false)
-    expect(unfocused.some((line) => line.includes("*"))).toBe(false)
```

File has 0 markers before and after; this is now the file's only divergence from upstream (0+/2−). Suspicious because the justification is not visible in the tree: the component under test (`packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx`) is **byte-identical to upstream** and nothing in it or its utils renders `*`. Whatever made these assertions fail on the branch (theme, fixture, or environment difference) is undocumented — a future upstream refresh of this test file silently reintroduces the assertions, and the silent weakening may be masking a real Kilo regression in the diff viewer. A human should confirm the failure cause and either mark the change (`// kilocode_change start/end` with the reason) or fix the underlying difference and restore the assertions.

### 3. OBSERVATION (round-2 miss, pre-existing at round-2 head) — `packages/core/test/reference.test.ts`: unmarked 1-line deletion

Kilo's copy drops upstream's `import { LayerNode } from "@opencode-ai/core/effect/layer-node"` (upstream's only `LayerNode` reference in that file is the import itself — a dead-import cleanup). 0 markers; identical blob already present at 37a5cbf5db, so round 2's zero-marker sweep missed it. Trivial stakes, same class as R2-N4; flagged for completeness.

## Transform coverage verification (task 4)

| Transform | Coverage verdict |
|---|---|
| transform-i18n | Byte-reproduces 8 of 9 previously-unmarked locales from upstream blobs (markers mode); uk.ts = transform output + separately marked preservation block. All 28 locales marked. Full coverage. |
| transform-take-theirs (branding) | `applyBrandingTransforms(a105350812 meta.txt)` reproduces head `packages/opencode/src/session/prompt/meta.txt` **byte-identically** (5 replacements) at the new head. No marker owed. |
| transform-package-json | All 13 diverging package.json files in the sweep (root, core, opencode, plugin, client, codemode, httpapi-codegen, sdk-next, session-ui, storybook, tui, ui, artifacts/glm52-rise-video) match its rules: name renames, version preservation (incl. the artifacts `"version": "7.4.20"` injection), PRESERVE_SCRIPTS / DELETE_UPSTREAM_SCRIPTS / DELETE_UPSTREAM_CATALOG / KILO_BIN / KILO_DEPENDENCIES. JSON holds no comments — no markers owed. Full coverage. |
| remove-kilo-web + skip-files | web.ts deletion listed in `skipFiles` (config.ts:139); index.ts import/registration replaced by marked omission comments (index.ts:25,109), matching transform output strings. Full coverage; no residue. |

## Notable non-findings

- **`packages/opencode/src/cli/cmd/run/footer.ts` variant-reset deletion — out of PR scope (already on main).** The delta removed upstream's 4-line variant-reset block in `handleModelSelect` (blame: `1e17055519 fix(vscode): preserve model variants on switch`, already merged to origin/main; base 6fce4e2564 already contains the removal, so the file is **not** in the 419-file PR diff). The deletion is the footer-side half of Kilo's variant preservation, whose runtime.ts half **is** marked (via kilocode-path `resolvePreservedVariant`). Worth a backlog note (an omission comment à la index.ts would document it), but it is main-lineage state, not merge-introduced.
- **`packages/plugin/src/tui.ts` — out of PR scope (already on main).** The unmarked `globalConfig` / `processes` / `BackgroundProcessInfo` divergences exist identically at base 6fce4e2564 (main already carries them); the file is not in the PR diff. The delta's +1 (`globalConfig`) is the main merge converging the branch to main's state. Same backlog class as R2-N3.
- **Zero-marker mechanical divergences (46 files):** 13 package.json (transform-covered above); `bun.lock`, `sdk/js/src/v2/gen/sdk.gen.ts` + `types.gen.ts`, `sdk/openapi.json` (lockfile/generated; openapi.json is keepOurs + regenerated by `script/generate.ts`); 13 session-ui/ui files with pure `@opencode-ai/* → @kilocode/*` import renames or `"OpenCode" → "Kilo"` branding strings (package-names / take-theirs convention; every one diff-verified); 5 core files with `OPENCODE_* → KILO_*` env/flag renames (watcher.ts, instruction-context.ts, repository.ts, github-copilot.ts, customize-opencode.md); `meta.txt` (verified above); 5 `script/upstream/*` files without headers — consistent, because the tooling's own config declares `script/upstream` a Kilo-owned directory (`config.ts` kiloDirectories, line 225), so no `new file` headers are owed there.
- **`artifacts/glm52-rise-video/*.mp4` (5 binaries):** Kilo stores them as git-LFS pointers (`*.mp4 filter=lfs` in .gitattributes); upstream stores raw bytes. Worktree content is byte-identical to upstream (shasum match). Repo-storage mechanics, not a code divergence.
- **`patches/solid-js@1.9.12.patch` (and 5 other Kilo-only patches):** no markers, matching every patch file including upstream's own — the patch format carries no durable marker convention. Established, consistent.
- **`.opencode-version`:** Kilo-new 1-line pin file (`v1.18.13`) consumed by the merge tooling; no marker convention for data files. Noted for completeness.
- **`packages/ui/src/components/provider-icons/sprite.svg` (+860 lines):** Kilo brand icons added to an upstream-shared SVG asset with no markers; pre-existing (present at round-2 head), and XML comment markers are possible but nowhere used for assets in this repo. Observation only.
- **Help snapshot (`test/cli/help/__snapshots__/help-snapshots.test.ts.snap`, 0 markers, 349-line divergence):** generated test output; the generating test file carries 12 markers describing Kilo's branded help (incl. excluding the removed web command). Snapshots regenerate from marked code.
- **All round-1/2 adjudications re-verified at new head:** the 23 full-PR count drops are exactly the previously adjudicated set (i18n consolidation counts unchanged: 17 locales at 6/8/5→3, uk 28→3 incl. the new branding marker; processor 98→97; marked.tsx 33→31; models-dev 10→7; the 3 upstream-identity files).

## Limitations

- Count/text comparison cannot detect a marker moved far from its code when count and text are unchanged (inherited from rounds 1–2).
- The zero-marker sweep covers only files this PR touches; main-lineage unmarked divergences outside the 419 (e.g. footer.ts, plugin/src/tui.ts, and likely others) are out of scope by construction — two surfaced here only because the delta carried them through.
- The transform byte-reproducibility checks ran the transform functions directly on upstream blobs; they prove the *current* transforms regenerate head state, not that the merges were actually performed that way.
- Finding 2's root cause (why the `*` assertions fail on the branch) was not fully traced; the component is upstream-identical, so the cause lies in theme/fixture/environment and needs the test author's confirmation.
- "Intentional" judgments for delta commits are inferred from code shape, commit messages, and tooling wiring, not from the committer's intent.
