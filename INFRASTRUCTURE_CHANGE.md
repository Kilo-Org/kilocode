# Infrastructure Change Review

## Scope
- PR: https://github.com/Kilo-Org/kilocode/pull/10387
- Base compared: main

## Findings
- `.github/workflows/disabled/daily-issues-recap.yml.disabled`, `.github/workflows/disabled/daily-pr-recap.yml.disabled`: Deleted two disabled scheduled/manual GitHub Actions workflows that generated daily issue and PR recaps and posted them to Discord. This is infrastructure because it changes GitHub Actions/repo automation, even though the workflows were under `disabled/`. Manual check: confirm Kilo intentionally wants these disabled workflow definitions removed rather than preserving its own recap automation for future use.
- `.github/ISSUE_TEMPLATE/bug-report.yml`, `.github/ISSUE_TEMPLATE/feature-request.yml`, `.github/ISSUE_TEMPLATE/question.yml`: Removed default `labels` assignments from issue templates. This is infrastructure because issue templates drive GitHub issue triage automation and repository workflow behavior. Manual check: confirm Kilo wants new bug, feature, and question issues to stop receiving automatic labels.
- `.opencode/agent/triage.md`, `.opencode/tool/github-triage.ts`: Reworked the triage agent from label-plus-assignee routing to team-based assignee-only routing, changed the model, changed owners/teams, and changed the GitHub API behavior to stop adding labels. This is infrastructure/repo automation because these files define automated GitHub issue triage behavior. Manual check: verify the new team mapping, assignee pool, `anomalyco/opencode` target repository, and no-label behavior are appropriate for Kilo.
- `.opencode/command/changelog.md`, `script/raw-changelog.ts`: Changed changelog generation rules and release-note grouping, including Bugfixes/Improvements subsections and filtering/grouping behavior. This is infrastructure because it affects release automation and generated release notes. Manual check: confirm Kilo's release-note format and attribution rules should follow this upstream behavior.
- `package.json`, `bun.lock`, package manifests under `packages/*/package.json`: Changed workspace/package-manager metadata, including the root `effect` catalog version, root `trustedDependencies`, package `peerDependencies` placeholders, added `effect` to `@kilocode/kilo-indexing`, added JetBrains package metadata, and updated lockfile entries. This is infrastructure because it changes dependency resolution, Bun install behavior, workspace package metadata, and package manager trust policy. Manual check: verify Kilo wants these dependency and trust-policy changes and that lockfile changes are not accidental upstream infra drift.
- `.opencode-version`: Updated the tracked upstream OpenCode version from `v1.14.33` to `v1.14.34`. This is infrastructure because it records the upstream merge baseline/version. Manual check: confirm this PR is intended to advance the upstream baseline to `v1.14.34`.
- `packages/opencode/script/build.ts`: Changed CLI build infrastructure by adding a Kilo-specific commented reference for the removed upstream embedded web UI bundle. This is infrastructure because it affects the binary build script and preserves merge/build decisions around bundled web UI assets. Manual check: confirm Kilo still intentionally omits upstream `packages/app` web UI embedding and that this build-script divergence should be retained.
- `packages/opencode/script/httpapi-exercise.ts`: Added a large HTTP API exerciser script for route coverage/parity testing. This is infrastructure because it is a test/developer automation script for validating server API behavior. Manual check: confirm Kilo wants to keep this automation and that its cleanup behavior, temp paths, fake LLM setup, and global flag changes are acceptable.
- `packages/sdk/js/script/build.ts`: Changed SDK generation to use the Effect HttpApi OpenAPI contract by default and require `--hono` for the legacy Hono spec. This is infrastructure because it changes SDK build/codegen behavior and the generated API source of truth. Manual check: confirm Kilo wants generated SDKs to default to the Effect HttpApi spec.
- `script/upstream/package.json`, `script/upstream/transforms/transform-package-json.ts`, `script/upstream/transforms/transform-package-json.test.ts`: Changed upstream-merge automation package metadata and formatting around package-json reconciliation helpers. This is infrastructure because these scripts automate future upstream merges and preservation/removal of Kilo-specific package metadata. Manual check: verify the transform still preserves all Kilo-specific scripts/dependencies and does not normalize upstream package JSON in a way Kilo does not want.
- `packages/extensions/zed/extension.toml`: Changed Zed extension version and release artifact URLs from Kilo `v7.2.52` to upstream-style `v1.14.34` assets. This is release/distribution infrastructure because it controls extension package metadata and platform binary download URLs. Manual check: confirm this is not accidental upstream version drift and that Kilo release URLs should point at `v1.14.34`.
- `packages/opencode/package.json`: Added an `#httpapi-server` import mapping to the CLI package. This is build/runtime package infrastructure because package import maps control module resolution across Bun/Node/default conditions. Manual check: confirm the new import condition targets are correct for Kilo's CLI runtime and packaging.

## Files Checked
- `.github/ISSUE_TEMPLATE/bug-report.yml`: Checked; issue-template automation changed by removing the default bug label.
- `.github/ISSUE_TEMPLATE/feature-request.yml`: Checked; issue-template automation changed by removing the default discussion label.
- `.github/ISSUE_TEMPLATE/question.yml`: Checked; issue-template automation changed by removing the default question label.
- `.github/workflows/disabled/daily-issues-recap.yml.disabled`: Checked; disabled GitHub Actions workflow was deleted.
- `.github/workflows/disabled/daily-pr-recap.yml.disabled`: Checked; disabled GitHub Actions workflow was deleted.
- `.opencode-version`: Checked; upstream baseline version changed.
- `.opencode/agent/triage.md`: Checked; GitHub triage agent routing instructions changed.
- `.opencode/command/changelog.md`: Checked; changelog command/release-note automation changed.
- `.opencode/tool/github-triage.ts`: Checked; GitHub triage tool behavior changed.
- `package.json`: Checked; root workspace/package-manager metadata changed.
- `bun.lock`: Checked; lockfile changed as a result of manifest/dependency changes.
- `packages/kilo-docs/package.json`: Checked; package metadata changed by adding empty `peerDependencies`.
- `packages/kilo-i18n/package.json`: Checked; package metadata changed by adding empty `dependencies` and `peerDependencies`.
- `packages/kilo-indexing/package.json`: Checked; package dependency metadata changed by adding `effect` and empty `peerDependencies`.
- `packages/kilo-jetbrains/package.json`: Checked; package metadata changed by adding version and empty dependency blocks.
- `packages/kilo-telemetry/package.json`: Checked; package metadata changed by adding empty `peerDependencies`.
- `packages/kilo-vscode/package.json`: Checked; package metadata changed by adding empty `peerDependencies`.
- `packages/opencode/package.json`: Checked; package import map changed.
- `packages/extensions/zed/extension.toml`: Checked; extension release metadata and artifact URLs changed.
- `packages/opencode/script/build.ts`: Checked; CLI build script changed.
- `packages/opencode/script/httpapi-exercise.ts`: Checked; new API exercise automation script added.
- `packages/sdk/js/script/build.ts`: Checked; SDK build/codegen source changed.
- `script/raw-changelog.ts`: Checked; release changelog automation changed.
- `script/upstream/package.json`: Checked; upstream-merge automation package metadata changed.
- `script/upstream/transforms/transform-package-json.ts`: Checked; upstream-merge package-json transform implementation changed.
- `script/upstream/transforms/transform-package-json.test.ts`: Checked; upstream-merge transform test expectations changed.
- `packages/opencode/migration/20260427172553_slow_nightmare/migration.sql`, `packages/opencode/migration/20260427172553_slow_nightmare/snapshot.json`, `packages/opencode/migration/20260428004200_add_session_path/snapshot.json`, `packages/opencode/migration/20260501142318_next_venus/migration.sql`, `packages/opencode/migration/20260501142318_next_venus/snapshot.json`: Not treated as repo/CI/release/package infrastructure findings, but noted as database schema/storage migration changes. Human reviewers may want to check them separately if application data infrastructure is in scope.
