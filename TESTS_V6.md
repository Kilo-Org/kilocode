# TESTS_V6.md — Kilo-specific test removal review, round 6 (LIGHT)

**Scope:** Round-6 light review of the upstream-merge PR merging opencode v1.18.13 (`a105350812`) into Kilo. Reviewed HEAD `77246a52cb` (= worktree HEAD~5; the top 5 commits are report-only). Previous reviewed head `4bb1c2a45b` (round 5). The delta under review is the single fix commit `77246a52cb fix(core): address round 5 review findings` (6 files, +29/−12; `git diff 4bb1c2a45b..77246a52cb` confirms nothing else). One of the six files is a test: `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` (−2 lines). PR base `4f59fcb666` unchanged. Question, unchanged: did this delta remove or weaken any Kilo-specific tests, and do the tests still assert shipped behavior?

**Methodology (light):** (1) Read the delta commit in full. (2) Verified the test-file hunk against the round-5 report and upstream tag. (3) Ran the single touched test suite (sub-second). (4) Statically re-verified each carried flag at the new head with targeted greps. (5) Checked the delta for test deletions. No fresh sweeps, no broad test runs — per the LIGHT brief.

**Bottom line:** The delta removes only the two `kilocode_change` marker comment lines from `diff-viewer-file-tree.test.tsx`; the restored asterisk-absence assertions remain and pass (3 pass, 1 skip, 0 fail, 11 expects). The file is now **byte-identical to upstream tag `a105350812`** — the markers were incorrect on upstream-verbatim assertions, so their removal is right. Zero test deletions in the delta. All seven carried flags are unchanged. Two new low findings: the delta's `kilo-commands.tsx` privacy-mode behavior change and the `repository-cache.ts` file-remote canonicalization branch both land without test coverage.

## Verification results

### 1. `diff-viewer-file-tree.test.tsx` change — VERIFIED CORRECT

- The delta removes exactly two lines: `// kilocode_change start - restore upstream absence assertions` and `// kilocode_change end` (the round-5 marker block).
- Both assertions restored in round 5 are still present at head: `expect(focused.some((line) => line.includes("*"))).toBe(false)` and the `unfocused` twin (lines 112–113 at head).
- `git diff a105350812 77246a52cb -- <file>` is **empty**: the file now matches upstream exactly. Round 5 noted the assertions are upstream's own restored content; marking them as a Kilo divergence was wrong, so removing the markers is the correct follow-through (markers belong on Kilo-specific divergences only).
- Suite executed at `77246a52cb` (`bun test test/cli/tui/diff-viewer-file-tree.test.tsx`, packages/tui; the package script is `bun test --timeout 30000 --only-failures`): **3 pass, 1 skip, 0 fail, 11 expects (887ms)** — identical shape to round 5. The skip is the pre-existing `test.skip` on "renders sorted hierarchical file rows". A benign `ENOENT` log from `util/flock.ts` (theme lookup in this sandbox) appears in output, as in round 5.

### 2. Zero test deletions in the delta — CONFIRMED

`git diff 4bb1c2a45b..77246a52cb --diff-filter=D -- '*test*' '*spec*'` is empty. The full-PR deletion set at `4f59fcb666...77246a52cb` is unchanged from rounds 1–5: only `packages/session-ui/src/components/markdown-preload.test.ts` (upstream deletion, no Kilo content) plus three superseded dependency patch files.

### 3. Carried flags — status check (one line each)

1. **oauth-browser CI-stability watch** — STILL OPEN, unchanged: marker count still 0 at `77246a52cb`; delta does not touch the file; answerable only by post-merge CI observation.
2. **issue-8656-stall timeout relaxation** — STILL OPEN, unchanged: `win32 ? 90_000 : 60_000` poll budget at line 126 and both `180_000` case timeouts at lines 162/192 verified at head; delta does not touch the file.
3. **instance-vcs-watcher flake** — STILL OPEN, carried: three reproductions across rounds 3–5 stand; file untouched by the delta; NOT rerun this round per the LIGHT brief.
4. **httpapi-pty e2e spawn-dimension coverage loss** — STILL OPEN, unchanged: no `stty` reference at head; the marked block (lines 84–95) POSTs `size: { cols: 50, rows: 20 }` / `{ cols: 80, rows: 24 }` but asserts only status 200 and `toMatchObject({ title, command, status })` — schema acceptance, not application; `pty.ts:223-224,297` application path remains intact.
5. **auto-approval-visibility untested** — STILL OPEN, unchanged: zero `visible` references in `packages/kilo-ui/src/components/tool-approval.test.ts`; no kilo-vscode test references `autoApprovalReason`/`auto-approval-reason`; chain remains unpinned.
6. **generate.ts cache fault-tolerance untested** — STILL OPEN, unchanged: delta does not touch `generate.ts`; no harness exists.
7. **httpapi-pty 5s ad-hoc timeout sensitivity (V5 new finding)** — STILL OPEN, carried: environment-boundary slowness under bun's default 5 s timeout (passes at 20 s; CI runner default is 60 s); delta touches nothing in the PTY path; not rerun this round; flagged for post-merge CI observation.

## New findings

### 1. `kilo-commands.tsx` privacy-mode toggle change has no test coverage (low — flag: human verification)

- **What:** The delta rewrites the `/privacy` command handler in `packages/opencode/src/kilocode/kilo-commands.tsx` to issue the global `overlayUpdate` set plus, when disabling and a project-level `privacy_mode === true` exists, a second project-scope `overlayUpdate` with `unset: ["privacy_mode"]` (Promise.all over both).
- **Coverage:** No test under `packages/opencode/test/` references `privacy` at all (only hit is an unrelated `models-api.json` fixture). The dual-overlay behavior — including the error path that now surfaces the first failed response — is unpinned.
- **Mitigation:** The file is kilocode-owned TUI command registration; the change is a round-5 review fix restoring intended Kilo behavior, and the overlay endpoints themselves are covered elsewhere (`config-overlay.test.ts`). Flagged per convention for a human to decide whether a command-level test is warranted. No code change recommended.

### 2. `repository-cache.ts` file-remote canonicalization branch is not directly tested (low — flag: human verification)

- **What:** The delta adds a `kilocode_change` block computing `match` via `fs.resolve` on both paths when `originReference` and `cloneTarget` are file remotes (canonicalizing Git-on-Windows rewrites), falling back to `Repository.same` otherwise; `reuse` now ANDs `match`.
- **Coverage:** `packages/opencode/test/kilocode/tool/repo_clone.test.ts` (25 tests) exercises the cache-reuse logic but contains zero references to `isFile`/`resolve`/file-remote canonicalization, so the new branch's equivalence/disequivalence behavior is not directly pinned.
- **Mitigation:** This restores pre-merge Kilo behavior flagged in round-5 review comments; the surrounding reuse logic is covered. Flagged for human verification that existing clone tests exercise a file-remote path at all. No code change recommended.

## Limitations

- **LIGHT round by design:** no fresh full-PR sweeps (marker counts, removed declarations, removed literals, `.skip`/`.only` scans) were re-run; rounds 1–5 sweep results are carried and attributed, and the delta touches nothing that would alter them except the one verified test file.
- **Minimal test execution:** only the single touched suite was run (887ms). The carried flags were verified statically; `instance-vcs-watcher` and `httpapi-pty` were deliberately not rerun (flake reproduction count and environment-bound timeout stand as previously recorded).
- **Sandboxed local execution, not CI:** the standing caveat from rounds 1–5 applies — this session's sandbox blocks outbound network and slows process/PTY teardown; both open environment-bound flags remain flagged for post-merge CI observation rather than asserted as regressions.
- **No A/B run at `4bb1c2a45b`:** the read-only brief forbids checking out the old head; the only behavioral test-file change is comment removal, so no behavioral A/B was needed.
