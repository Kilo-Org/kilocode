# Infrastructure Change Review

## Scope And Methodology

Reviewed the requested merge range `origin/main...HEAD` at reviewed head `51d8031c9997bd5478bcde715562169f732d04d4` (merge base `3572898618a5a3082ae5d476e62d1e091e79be62`). The local upstream reference `v1.17.9` resolves to `5c23e88419c4743b9be42cea132f2fb1e6cb63ff`.

The review classified only infrastructure-related changes: CI/workflows, package-manager and workspace metadata, lockfile and patched dependencies, generated SDK/build artifacts, changesets, and upstream-merge automation. Relevant files were diffed against `origin/main`, and dependency patches, SST declaration file sets, and selected package/build inputs were compared with `v1.17.9`. This is a read-only review; no reviewed source or configuration file was modified.

## Findings

1. **Severity: Medium | Confidence: High**. The published `@opencode-ai/http-recorder` package now points users to OpenCode instead of Kilo for its homepage and issue tracker.

   - `packages/http-recorder/package.json:13` changes `homepage` from the Kilo repository to `https://github.com/anomalyco/opencode/tree/dev/packages/http-recorder`.
   - `packages/http-recorder/package.json:14` changes `bugs` from Kilo Issues to `https://github.com/anomalyco/opencode/issues`.
   - This is an accidental upstream adoption: the same file retains the Kilo `repository.url` at `packages/http-recorder/package.json:8-12`, producing internally inconsistent npm metadata. `origin/main` had Kilo URLs for all three fields; `v1.17.9` has the adopted OpenCode `homepage` and `bugs` values.
   - The merge transform documents preservation of Kilo repository metadata in `script/upstream/transforms/transform-package-json.ts:552-559`, but preserves only `repository`, not the related `homepage` and `bugs` fields. Update the package metadata and extend the transform's Kilo-provenance preservation to cover these fields, so subsequent upstream integrations do not reintroduce the issue.

## Expected Or Generated Infrastructure Changes

- `.opencode-version` advances from `v1.17.5` to `v1.17.9`, and `.changeset/opencode-v1-17-5-to-v1-17-9.md` provides the expected Kilo release-note automation for the integrated upstream range.
- Workspace dependency inputs in `package.json`, `packages/ui/package.json`, and `bun.lock` adopt the v1.17.9 UI stack: `@pierre/diffs` 1.2.10, Shiki 4.2.0, `@shikijs/stream`, and TanStack Solid Virtual. The lockfile changes are consistent with these declarations.
- `bunfig.toml:3-5` retains Kilo's stricter 410520-second supply-chain quarantine rather than adopting upstream's 259200-second policy. Its only range change adds the required `@pierre` package exclusions.
- The updated MCP patch and four added patches in `patches/` are all byte-identical to their v1.17.9 counterparts. They are expected dependency inputs for the upstream UI and provider changes, not Kilo-specific substitutions.
- `packages/sdk/openapi.json` and the v2 TypeScript SDK outputs are generated API artifacts that incorporate the integrated PTY and capability endpoints. The eleven added package-level `sst-env.d.ts` declarations match the upstream v1.17.9 file set. `packages/kilo-docs/source-links.md` is the corresponding source-link generated artifact.
- `script/upstream/merge.ts` and `script/upstream/utils/git.ts` add a compatibility-tree overlay: unchanged upstream paths retain their prior Kilo content while changed upstream paths are overlaid from the transformed tree. `script/upstream/utils/git.test.ts` covers Kilo-only files, unchanged Kilo content, additions, removals, and `.opencode-version`. This is Kilo-specific merge infrastructure, not upstream workflow adoption.

## Notable Non-Findings

- **No GitHub Actions workflows were added, removed, renamed, or changed in `origin/main...HEAD`.** `git diff --name-status origin/main...HEAD -- .github/workflows` produced no output.
- The workflow allowlist remains intact. `bun run script/check-workflows.ts` reported `check-workflows: ok (27 workflows).` The allowlist guard was not changed by this range.
- No changes were made to GitHub Actions composite actions, issue templates, Dependabot configuration, Docker/build-container files, Nix inputs, SST configuration, Turborepo configuration, or release/deploy workflow definitions.
- The package metadata changes in the remaining workspace packages only reorder existing CI/test scripts or add the upstream-required UI dependency; no package-manager version, workspace membership, root build script behavior, or lockfile integrity policy was unintentionally replaced.
- `git diff --check` reports the embedded unified-diff syntax in the newly added `patches/@pierre%2Ftrees@1.0.0-beta.4.patch` as space-before-tab and blank-line whitespace. The patch is byte-identical to v1.17.9; these diagnostics are expected when Git checks the outer addition of a patch file containing tab-indented inner context, not an independent patch-format defect.

## Command Outputs

| Command | Relevant output |
|---|---|
| `git diff --name-status origin/main...HEAD -- .github/workflows` | No output, therefore no workflow file changes. |
| `bun run script/check-workflows.ts` | `check-workflows: ok (27 workflows).` |
| `git diff --check origin/main...HEAD` | Exit code 2. Reports nested unified-diff context in `patches/@pierre%2Ftrees@1.0.0-beta.4.patch`; see the corresponding notable non-finding. |
| `git diff --check origin/main...HEAD -- ':!patches/@pierre%2Ftrees@1.0.0-beta.4.patch'` | Exit code 0. |
| Infrastructure-scoped diff stat | 34 relevant files changed, 4,058 insertions and 2,716 deletions, dominated by regenerated OpenAPI/SDK artifacts. |
| Patch comparison with `v1.17.9` | The updated MCP patch plus the four new dependency patches have identical SHA-256 values at `HEAD` and `v1.17.9`. |

## Limitations

- No `bun install`, build, release/deploy command, or SDK regeneration was run because this was a read-only infrastructure review. A clean frozen-lockfile install should verify that the new `@pierre/trees` patch applies to its installed distribution files.
- The locally available `v1.17.9` tag was used for upstream comparison; no remote fetch was performed.
- Generated OpenAPI/SDK content was reviewed as an artifact diff and correlated with the integrated server API changes, but was not independently regenerated in this review.
