# Infrastructure Re-review: PR #12088

## Second-pass verdict

**Reviewed head:** `b42f911f7680559b536850aab414258d0eb59a88`

**Current `origin/main`:** `6639022345dd0966b6e028f2c7e533ab91e97166`

**Merge base:** `be15cf4b556bea96aaef6de1b3c405b86c0d1a6c`

**Verdict: request changes for inactive dependency patches.** The original broken release path is fixed, required PR checks are green, and the main build/migration/SDK routes are structurally coherent. Three root patch declarations no longer match the locked package versions and therefore do not take effect.

## Finding

### High: Pacote, xAI, and gcp-metadata patches are declared but not applied

`package.json:162-164` declares patches for:

- `@ai-sdk/xai@3.0.82`
- `gcp-metadata@8.1.2`
- `pacote@21.5.0`

The lockfile resolves xAI `3.0.92`, gcp-metadata `8.1.3`, and Pacote `21.5.1`. None appears in the effective `patchedDependencies` map at `bun.lock:811-817`. Google `3.0.73` and Virtua `0.49.1` do match and are active.

The Pacote patch is intended to preserve private-git installation fallback when a hosted tarball is invalid or returns an HTTP error. At the reviewed head that behavior is absent. Port the patch to `21.5.1` if still required, or remove it after verifying upstream contains the fix. Remove or update the two older stale declarations. Add a guard that every root patch declaration appears in Bun's effective lockfile patch map.

## Resolved or cleared first-pass findings

- **Publish path:** `script/publish.ts` no longer invokes nonexistent `packages/cli/script/publish.ts`.
- **Zed icon:** `packages/extensions/zed/icons/opencode.svg` is restored and satisfies `extension.toml`. Long-term Zed ownership remains a follow-up because sync/license automation is still inconsistent.
- **Nix retry:** each attempt truncates the same log, recomputes the hash, and persistent failure still fails. No stale-hash defect was found.
- **Migration check:** `packages/core/test/database-migration.test.ts` runs `migration.ts --check`, and required Linux core CI executes it. Existing hand-adapted wrappers are not proven generated from SQL, but this is an ownership/documentation follow-up, not a newly demonstrated migration failure.
- **Build and SDK validation:** the reviewed PR's generated-artifact, typecheck, HttpApi exerciser, and Linux/macOS/Windows unit checks pass. Runtime migrations are statically imported into build output.
- **Repository guards/test profiles:** no defect remains in the reviewed changes.

## Follow-ups

- Decide whether Kilo owns Zed packaging, then restore the full path or remove remaining release/version references.
- Review quarantine exclusions and dependency-patch provenance with dependency/security owners.
- Add generated-theme drift enforcement if the OC2 override is intended to remain generated.
- Linux sandbox network sidecars are omitted by shell installer, AUR, Homebrew, and Docker repackaging, and legacy SDK `Config.sandbox` omits `allowed_hosts`. Ref comparison showed these defects predate the PR merge base, so they should be fixed separately rather than blocking this upstream merge.

## Validation and limitations

`gh pr checks 12088` showed green generated-artifact, typecheck, HttpApi exerciser, docs, JetBrains, and all Linux/macOS/Windows unit jobs; the external Kilo Code Review was still pending. Static review used exact Git refs and inspected workflows, package manifests, lockfile patch maps, build/publish scripts, generated artifacts, and migration wiring. No publish, Nix build, SDK generation, or release packaging was rerun locally.
