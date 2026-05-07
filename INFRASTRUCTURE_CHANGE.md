# Review: Infrastructure changes in PR #9978

> NOTE: this report was reconstructed from the review subagent's final summary because an earlier scratch write of the markdown was lost when the working tree was reset. The findings below match what the agent reported. A human should re-run the spot-checks for any line items they care about.

## Methodology

1. Listed all files changed by PR #9978 vs Kilo `main` (`c1ea8100e`).
2. Filtered to infrastructure-flavoured paths:
   - `.github/`, `.devcontainer/`, root `script/`, `nix/`
   - `flake.nix`, `flake.lock`, any `*.nix`
   - `Dockerfile*`, `docker-compose*`, `packages/containers/**`
   - `turbo.json`, `bunfig.toml`, `pnpm-workspace.yaml`, `vercel.json`, `netlify.toml`
   - `.changeset/config.json`
   - Workspace-level `package.json` files (root + per-package)
   - Root `tsconfig*.json`, per-package `tsconfig*.json`
   - `release-please*` configs, semantic-release configs
3. Inspected each file's diff via `git diff c1ea8100e..pr-9978 -- <file>`.

## Infra-relevant files in the diff

| File | Verdict |
|---|---|
| `.github/**` | No changes. |
| `script/` (root) | No changes. |
| `flake*`, `nix/` | No changes. |
| `packages/containers/**` (Dockerfiles) | No changes. |
| `turbo.json`, `bunfig.toml`, `.changeset/config.json`, `.devcontainer/` | No changes. |
| Root `package.json` | **Needs human review** — see Findings #1, #2, #3, #4. |
| `packages/opencode/script/build.ts` | **Needs human review** — see Findings #5. |
| `packages/opencode/package.json` | Mostly upstream version bump + dependency drift — no Kilo-specific infra concern. |

## Findings

1. **`postinstall` regression (real).** Root `package.json` drops `&& bun run script/setup-git.ts` from `postinstall`. The script still exists in-repo, and per `AGENTS.md` it's what wires up `merge.conflictStyle=zdiff3` for every contributor — i.e. the very thing that makes upstream merges like this PR tractable. **Should be restored before merging.**

2. **Dead `dev:desktop` / `dev:web` / `dev:console` scripts** added to root `package.json`. They target `packages/desktop-electron`, `packages/app`, `packages/console`, none of which exist in Kilo. Cosmetic upstream noise; safe to keep removed if a follow-up cleanup pass is convenient.

3. **`dev-setup` root script removed.** The underlying CLI still works via `./bin/kilodev dev-setup`, but the `bun run dev-setup` shorthand documented in older onboarding material is gone. Low severity — flag for docs/onboarding update only.

4. **`@sentry/solid` + `@sentry/vite-plugin`** added to the root catalog with zero consumers in Kilo's source. They're upstream's desktop integration. Safe but adds install weight; consider trimming.

5. **Dead `sourcemapsFlag` constant** in `packages/opencode/script/build.ts` (`const sourcemapsFlag = process.argv.includes("--sourcemaps")`). Kilo enforces its own sourcemap policy via a `kilocode_change`, so this flag is read but never consumed. Low severity.

## Conclusion

The PR cleanly preserves Kilo's infrastructure perimeter. There are zero changes to `.github/`, root `script/`, `flake*`, `nix/`, `packages/containers/**`, `turbo.json`, `bunfig.toml`, `.changeset/config.json`, or `.devcontainer/`. The merge resolution kept Kilo's side for all of those.

The only real regression is **Finding #1** (the lost `setup-git.ts` step). The other findings are upstream cosmetic noise.
