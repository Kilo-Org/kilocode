# UNNECESSARY_MARKERS.md — PR #10790 (OpenCode v1.14.42 upstream merge)

Last merged upstream: **v1.14.42** (`23c6b69a`)

## Methodology

The repo ships a purpose-built detector for stale markers, so the review was driven by it and then spot-verified manually.

Commands run:

- `bun run script/upstream/find-reset-candidates.ts --dry-run` — classifies every shared file's drift from the last merged upstream commit (`23c6b69a`). It compares each working-tree file against the **transformed** upstream (upstream bytes run through the merge codemods in `script/upstream/transforms/*`: package-name remaps, `\bOpenCode\b → Kilo`, `anomalyco/opencode → Kilo-Org/kilocode`, etc.). The relevant bucket is `markers-only`: the file equals transformed upstream once `kilocode_change` marker comments are stripped, i.e. the marker no longer wraps any real divergence.
- `grep -rl "kilocode_change" packages/opencode/src/ --include="*.ts" --include="*.tsx"` → 229 marker-bearing files; `packages/core/src/` → 6 files.
- Manual confirmation of the flagged files via `git diff 23c6b69a -- <file>` and a small script that ran the real `translate()` pipeline (`script/upstream/utils/upstream.ts`) over the upstream blobs and compared the marker-cleaned result (`clean()`/`join()` from `script/upstream/utils/markers.ts`) against the local files.

Classifier summary (dry-run): markers-only **2**, cosmetic-only 1, small-diff 159, large-diff 276, identical 128, upstream-missing 137, the rest skipped (assets / config-protected).

## Findings — markers that can be removed (stale)

Both files below classify as `markers-only`: stripping the marker comments yields content byte-identical to transformed upstream. The manual edit they annotate is now produced automatically by the merge branding codemods (`\bOpenCode\b → Kilo` and the `anomalyco/opencode → Kilo-Org/kilocode` URL rewrite), so the `// kilocode_change` markers no longer represent a Kilo-specific divergence and are unnecessary.

1. **`packages/opencode/src/cli/cmd/run/permission.shared.ts`** (2 markers)
   ```
   return [`This will allow ${request.permission} until Kilo is restarted.`] // kilocode_change
   "This will allow the following patterns until Kilo is restarted.", // kilocode_change
   ```
   "OpenCode is restarted" → "Kilo is restarted" is exactly what the `\bOpenCode\b → Kilo` branding transform emits. Verified: `clean(local) === clean(translate(upstream))`. The markers are redundant.

2. **`packages/opencode/src/cli/cmd/tui/component/error-component.tsx`** (1 marker)
   ```
   const issueURL = new URL("https://github.com/Kilo-Org/kilocode/issues/new?template=bug-report.yml") // kilocode_change
   ```
   The `github.com/anomalyco/opencode → github.com/Kilo-Org/kilocode` rewrite is applied automatically by the merge transforms. Verified: `clean(local) === clean(translate(upstream))`. The marker is redundant.

Recommended action: drop the three `// kilocode_change` markers above. The branded output is reproduced deterministically by the upstream-merge transforms, so the markers add merge noise without protecting any real change. (Removing the markers also lets `find-reset-candidates.ts` treat these files as fully `identical`.)

## Non-findings — markers that still look valid

- The classifier found **only** the 2 files above as `markers-only`. Every other marker-bearing file retains real non-marker divergence from transformed upstream, so those `kilocode_change` markers still annotate genuine Kilo-specific behavior. No action needed.
- **`packages/opencode/src/session/prompt/anthropic.txt`** appears in the `cosmetic-only` bucket but contains **no `kilocode_change` markers** at all (it's a plain branded prompt). It is therefore out of scope for this marker report — there is no marker to remove.

No markers were found that point at a now-deleted or relocated code region, and no zero-diff/empty marker blocks were detected outside the two findings above.
