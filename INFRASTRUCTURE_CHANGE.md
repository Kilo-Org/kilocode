# Infrastructure Review — PR #9911 (upstream opencode v1.14.30 → Kilo `main`)

## Summary

- **Total files changed in PR:** 165
- **Infrastructure / build / release / CI files changed:** 3
- **Flagged for manual review:** 2
- **OK (informational):** 1
- `.github/` workflows, `.changeset/`, root-level configs (`turbo.json`, `package.json`, `bun.lock`, `.prettier*`, `.gitignore`, `tsconfig*.json`, `knip.json`, `cliff.toml`, `.nvmrc`, Dockerfile, Husky, `.vscode/`, `.idea/`, `.devcontainer/`), Kilo-owned `script/*`, `packages/kilo-vscode/scripts/*`, `packages/sdk/js/*` build tooling, and the `apps/desktop`, `apps/web`, `packages/function` upstream scaffolding — **zero delta**. No upstream infra leaked in at those layers.

## Changed infra files

### CI / workflows

| File | Verdict | Reason |
|---|---|---|
| _(none changed)_ | OK | `.github/workflows/**` has **zero delta** vs `origin/main` (verified via `git diff origin/main...HEAD --stat -- .github/`). All 29 active Kilo workflows and 8 `disabled/*.yml.disabled` upstream-only workflows untouched. |

### Root configs

| File | Verdict | Reason |
|---|---|---|
| _(none changed)_ | OK | `turbo.json`, root `package.json`, `bun.lock`, `.prettierrc*`, `.prettierignore`, `.gitignore`, `.editorconfig`, `tsconfig*.json`, `knip.json`, `cliff.toml`, `renovate.json`, `.nvmrc`, `.tool-versions` — none changed. |

### package.json

| File | Verdict | Reason |
|---|---|---|
| `packages/core/package.json` | **FLAG** | Kilo `version` and pre-existing `rotating-file-stream` dep correctly preserved, but merge added a stray empty `"peerDependencies": {}` — a no-op leaked from conflict resolution. See detail below. |

No other `packages/*/package.json` changed — confirmed via `git diff --name-only -- 'packages/*/package.json' 'packages/*/*/package.json'`.

### Build scripts

| File | Verdict | Reason |
|---|---|---|
| `packages/opencode/scripts/diff-sdk-types.sh` | OK | New upstream-added local dev helper for diffing Hono vs HttpApi generated SDK types. Not referenced by any CI workflow; purely a developer convenience. Lives in shared opencode package but has no runtime/build side effects. |

### Release / changeset

| File | Verdict | Reason |
|---|---|---|
| `packages/extensions/zed/extension.toml` | **FLAG** | Kilo's `v7.2.40` version and download URLs were rewritten back to upstream's `v1.14.30`. See detail below. |

`.changeset/config.json` and `.changeset/**` unchanged. `cliff.toml` unchanged. No version bump scripts touched.

### Other infra

_None._ No Docker/devcontainer/Husky/`.vscode/`/`.idea/` changes. No top-level `README.md`/`CONTRIBUTING.md` changes. No changes to `apps/desktop`, `apps/web`, or `packages/function`.

---

## Detailed flag notes

### FLAG 1 — `packages/core/package.json`

**What changed (rendered multi-line for readability; file on disk is minified single-line JSON):**

- Kilo-only `"rotating-file-stream": "3.2.9"` dependency: **correctly preserved** (appears once in post-merge file; the raw `git diff` output renders it as `+`/`-` due to the re-ordering caused by minified JSON diffing — verified via `JSON.parse` that it's present exactly once).
- Kilo `"version": "7.2.40"`: **correctly preserved** (upstream wanted `1.14.30`).
- **New empty top-level `"peerDependencies": {}`**: added by the merge resolution. Neither Kilo pre-merge nor upstream (`eb4219304`) had this field.

**Suspicion:** Looks like an artefact of hand-resolving a conflict in a minified one-line JSON. It's functionally a no-op (empty object), but it's unexpected churn and a sign that the resolution wasn't round-tripped through a JSON formatter.

**What the human needs to verify:**
- `packages/core/package.json` — confirm the empty `"peerDependencies": {}` is intentional or drop it. If you regenerate via a formatter (e.g. sort-package-json / prettier on a multi-line copy), you should get a clean output.
- Confirm no lockfile update is needed (no lockfile changes were part of this PR; since `rotating-file-stream@3.2.9` was already in `origin/main`, this is fine).

### FLAG 2 — `packages/extensions/zed/extension.toml`

**What changed:**

| Field | Pre-merge (Kilo `origin/main`) | Post-merge (HEAD) | Upstream (`eb4219304`) |
|---|---|---|---|
| `version` (line 4) | `7.2.40` | `1.14.30` | `1.14.30` |
| `darwin-aarch64 archive` (line 14) | `…/v7.2.40/…` on `Kilo-Org/kilocode` | `…/v1.14.30/…` on `Kilo-Org/kilocode` | `…/v1.14.30/…` on `anomalyco/opencode` |
| `darwin-x86_64 archive` (line 20) | `v7.2.40` | `v1.14.30` | upstream URL |
| `linux-aarch64 archive` (line 26) | `v7.2.40` | `v1.14.30` | upstream URL |
| `linux-x86_64 archive` (line 32) | `v7.2.40` | `v1.14.30` | upstream URL |
| `windows-x86_64 archive` (line 38) | `v7.2.40` | `v1.14.30` | upstream URL |
| `id`, `name`, `repository`, `agent_servers.opencode.name` | Kilo values | Kilo values (preserved) | upstream values |

**Suspicion / context:** Kilo's publish infrastructure produces release tags like `v7.2.40`, not `v1.14.30`. At `HEAD`, the Zed extension points at `https://github.com/Kilo-Org/kilocode/releases/download/v1.14.30/...`, which will 404 unless Kilo publishes a `v1.14.30` tag.

Looking at `git log -- packages/extensions/zed/extension.toml`, this is a **known pattern**: prior "kilo compat for v1.14.x" commits (e.g. `08c72de63`) also left the file pointing at the upstream version tag, and a subsequent `release: v7.2.XX` commit (e.g. `18c722666`) bumped both the version and the URLs to Kilo's scheme. So this is an intermediate state that Kilo's own release step is expected to rewrite.

**What the human needs to verify:**
- Confirm Kilo's release pipeline (`.github/workflows/publish.yml` + release scripts) rewrites `packages/extensions/zed/extension.toml:4` and the five `archive = ...` URLs on lines `14`, `20`, `26`, `32`, `38` from `v1.14.30` → the next Kilo tag (e.g. `v7.2.41`) before the Zed extension is published. If that auto-rewrite does not exist, the Zed extension will ship with dead download URLs.
- As a safety net, consider rewriting the file inside this PR to Kilo's incoming `v7.2.x` version instead of leaving `v1.14.30` in tree.

---

## Explicit `.github/workflows/*` enumeration (zero-delta confirmation)

Confirmed via `git diff origin/main...HEAD --stat -- .github/` that **none** of the following changed:

Active workflows:
`auto-docs.yml`, `beta.yml`, `check-md-table-padding.yml`, `check-opencode-annotations.yml`, `check-org-member.yml`, `close-issues.yml`, `close-stale-prs.yml`, `compliance-close.yml`, `containers.yml`, `daily-issues-recap.yml`, `daily-pr-recap.yml`, `docs-build.yml`, `docs-check-links.yml`, `duplicate-issues.yml`, `generate.yml`, `nix-eval.yml`, `nix-hashes.yml`, `pr-management.yml`, `pr-standards.yml`, `publish.yml`, `smoke-test.yml`, `source-check-links.yml`, `storybook.yml`, `test-vscode.yml`, `test.yml`, `triage.yml`, `typecheck.yml`, `visual-regression.yml`, `watch-opencode-releases.yml`.

Disabled upstream-only workflows (kept disabled):
`disabled/kilo.yml.disabled`, `disabled/nix-desktop.yml.disabled`, `disabled/notify-discord.yml.disabled`, `disabled/publish-github-action.yml.disabled`, `disabled/release-github-action.yml.disabled`, `disabled/review.yml.disabled`, `disabled/stats.yml.disabled`, `disabled/sync-zed-extension.yml.disabled`.

Also unchanged: `.github/CODEOWNERS`, `.github/ISSUE_TEMPLATE/*`, `.github/actions/*`, `.github/publish-python-sdk.yml`, `.github/pull_request_template.md`.

**No upstream CI/release machinery leaked into Kilo `main`.**
