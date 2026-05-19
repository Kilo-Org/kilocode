# Upstream Conflict Audit v1.15.5

## Target

- Base branch: `main` at `54d98857`
- Current recorded upstream: `v1.14.33`
- Target upstream: `v1.15.5` at `d7a6e1da`
- Analysis command: `bun run script/upstream/analyze.ts --version v1.15.5 --output /var/folders/dz/q66gh6gs1jbc15k738ynwvf00000gn/T/kilo/upstream-conflicts-before-v1.15.5.md`
- Merge command: `bun run script/upstream/merge.ts --version v1.15.5 --no-push`

## Before

- Upstream changed files: 1907
- Initial merge conflicts before post-processing: 164
- Rerere auto-resolved conflicts: 136
- Keep-ours auto-resolved conflicts: 10
- Mergiraf fully resolved conflicts: 26
- Mergiraf partially resolved files: 99
- Remaining manual conflicts after automation: 124

## Low-Risk Improvements Applied

- Marked the recurring Kilo-owned workflow conflicts as `keepOurs` in `script/upstream/utils/config.ts`.
- Marked `.opencode/opencode.jsonc` as `keepOurs`; it points at the Kilo schema and includes Kilo provider defaults.
- Auto-resolved `.opencode-version` by accepting the transformed upstream branch version, which is written by the merge script immediately before merging.
- Made `merge.ts` pull the explicit base branch from origin when it exists, while allowing local-only audit branches to be used as merge bases.

## Expected Effect

- The exact v1.15.5 retry should remove these manual conflicts from the final list: `.github/workflows/beta.yml`, `.github/workflows/close-issues.yml`, `.github/workflows/containers.yml`, `.github/workflows/disabled/daily-issues-recap.yml.disabled`, `.github/workflows/disabled/daily-pr-recap.yml.disabled`, `.github/workflows/duplicate-issues.yml`, `.github/workflows/generate.yml`, `.github/workflows/nix-hashes.yml`, `.github/workflows/test.yml`, `.github/workflows/triage.yml`, `.github/workflows/typecheck.yml`, `.opencode/opencode.jsonc`, and `.opencode-version`.
- Expected manual conflict reduction: 124 to 111 if no additional rerere or mergiraf behavior changes.

## Deferred Suggestions

- Keep `bunfig.toml` manual for now because Kilo and upstream changed different dependency-age and exclusion policies that need semantic review.
- Keep `.gitignore`, `flake.nix`, `packages/core/**`, `packages/opencode/src/**`, and tests manual because those are shared-code or behavior-bearing conflicts.
- Consider a future workflow policy that treats all existing Kilo workflow files as keep-ours while continuing to skip upstream-only workflows through `skipFiles` and `script/check-workflows.ts`.
- Consider moving Kilo-specific test expectations from shared upstream tests into `packages/opencode/test/kilocode/**` where the behavior is purely Kilo-owned.

## Retry Result

- Pending.
