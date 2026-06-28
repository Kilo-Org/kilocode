# INFRASTRUCTURE_CHANGE.md — PR #10790 (OpenCode v1.14.42 upstream merge)

## Methodology

Reviewed the diff of infrastructure files between `origin/main` and the PR branch
(`review/pr-10790-reviews`) via `git diff origin/main...HEAD`, focusing on CI
(`.github/workflows/test.yml`), root `package.json`, `.gitignore`, the new
`.gitleaksignore`, and the two newly-vendored upstream packages
(`packages/http-recorder`, `packages/llm`). Each new package manifest was read in
full, root scripts were compared against `git show origin/main:package.json`, and
workspace/CI references were cross-checked (`test:ci`, `test:httpapi`, package-name
collisions, gitleaks usage).

## Findings

### 1. Root `test:ci` script removed from `package.json` — LOW

The root script `"test:ci": "bun turbo test:ci"` was replaced by
`"upgrade-opentui": "bun run script/upgrade-opentui.ts"`. This is an upstream change.
It does **not** break CI: `test.yml` invokes `bun turbo test:ci --filter='!@kilocode/kilo-jetbrains'`
directly (not the root npm alias), and turbo resolves the per-package `test:ci` scripts.
Impact is limited to losing the local `bun run test:ci` convenience shortcut. No action
required, but worth noting in case any local docs/tooling referenced it.

### 2. New CI gate `test:httpapi` added to `test.yml` — LOW

A new step runs `bun run test:httpapi` in `packages/opencode` on Linux only. The script
exists (`packages/opencode/package.json`) and runs the HttpApi exerciser in coverage/auth/effect
modes with `--fail-on-missing --fail-on-skip`. This is a new **blocking** gate that will fail
CI if HttpApi endpoints are added without exerciser coverage. No conflict with Kilo CI, but
contributors touching the server layer must now satisfy this gate.

### 3. Kilo CI customization preserved — LOW (verification, no issue)

The Kilo-specific `--filter='!@kilocode/kilo-jetbrains'` on the turbo `test:ci` invocation
survived the merge intact. The added httpapi step was inserted cleanly after the existing
unit-test step without disturbing the Kilo filter. Confirmed no regression.

## Non-findings (checked, look OK)

- **Kilo-specific root scripts intact**: `postinstall` still runs
  `fix-node-pty && bun run script/setup-git.ts`; `extension`, `dev-setup`, `random`, `hello`,
  and the root `test` guard (`'do not run tests from root' && exit 1`) are all preserved.
- **Kilo deps/config intact**: `@kilocode/plugin`, `@kilocode/sdk`, `@opencode-ai/script`,
  morphllm/aws-sdk deps, patched/trusted-dependency lists, and Effect/opentui catalog overrides
  are unchanged aside from the expected `@opentui` `0.2.2 → 0.2.6` bump plus the new
  `@opentui/keymap` catalog entry.
- **`.gitignore`**: only adds `.env.local` — appropriate and harmless.
- **`.gitleaksignore`**: only whitelists four fingerprints scoped to specific lines of
  `packages/http-recorder/test/record-replay.test.ts` (fake API-key strings used by redaction
  tests). It does not broadly suppress secret scanning and targets test fixtures only.
  Additionally, no gitleaks workflow exists in `.github/`, so the file is currently inert in
  Kilo CI — it does not weaken any active secret scan we run.
- **New packages, no name collision**: `@opencode-ai/http-recorder` and `@opencode-ai/llm`
  use the upstream `@opencode-ai/*` scope; no duplicate package `name` across `packages/*`.
  They live under `packages/*` so the existing workspace glob picks them up automatically
  with no root-manifest edits needed.
- **New package manifests**: both are `private: true`, use catalog refs for shared deps
  (`effect`, `@effect/platform-node`, `@tsconfig/bun`, `@types/bun`), and declare standard
  `test`/`typecheck` scripts. `@opencode-ai/llm` depends on `@opencode-ai/http-recorder`
  via `workspace:*`, which is internally consistent.
