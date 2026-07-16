# Infrastructure Review: PR #12204, Fourth Pass

Reviewed exact PR HEAD `627be20ed6ceb589316df9b54a2ae398146fd684` against actual merge base `e084ab7492eb6f330768157663b29c347dc0fa18`.

## Findings

### Low: unused supply-chain quarantine exceptions remain

`bunfig.toml` adds release-age bypasses including `@ff-labs/fff-node`, `app-builder-lib`, `dmg-builder`, `electron-builder`, and `electron-publish`, but none appears in a workspace manifest or lockfile at this head. Remove unused exceptions and document why active native-binary exceptions bypass Kilo's quarantine.

### Low: CODEOWNERS rules cannot enforce approval

`.github/CODEOWNERS` assigns absent `packages/app/` and `packages/desktop/` paths to users with read-only repository permission. This is not a shipped-path regression, but the rules cannot satisfy code-owner approval and should be removed or assigned to active Kilo maintainers.

## Revalidation

- Package CI continues to execute real `test:ci` tasks and publish all platform artifacts.
- No workflow was added or removed; the allowlist passes and action permissions remain scoped.
- TUI workspace, Turbo graph, lockfile, CLI build, native FFF patching, private HTTP recorder packaging, SDK generation, and Kilo release assets remain coherent.
- No Docker, Nix, deployment, dependency-bot, template, or changeset change appears in the reviewed range.
- `git diff --check` passes.

All exact-head checks pass, including the full unit matrix, HttpApi, JetBrains, typechecks, docs, visual regression, source links, policy checks, and underlying CodeQL analyses. This was a read-only audit; no release build or publication dry run was performed.
