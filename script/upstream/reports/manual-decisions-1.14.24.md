# Upstream Manual Merge Decisions

Generated: 2026-04-29T19:02:33.558Z
Updated: 2026-04-29T19:10:16.682Z

## Summary

- Version: 1.14.24
- Upstream Commit: `da6683fedcbb`
- Base Branch: main
- Merge Branch: markijbema/kilo-opencode-v1.14.24
- Automation Report: `upstream-merge-report-1.14.24.md`
- Manual Files: 6
- Complete Decisions: 6/6
- High Risk Decisions: 2

## Decisions By Type

- hybrid: 6
- take-ours: 0
- take-theirs: 0
- regenerated: 0
- removed: 0
- renamed: 0
- other: 0

## File Decisions

### packages/opencode/script/publish.ts

- Conflict: UU (content)
- Recommendation: manual - Script file has kilocode_change markers — auto-transform skipped, needs manual review
- Base Hash: `ac43c5e38eb3`
- Ours Hash: `283c6b916b3f`
- Theirs Hash: `68ec3c741823`
- Decision: hybrid
- Risk: medium
- Summary: Kept Kilo release publishing targets while accepting upstream 1.14.24 release script structure.
- Rationale: The resolved script preserves Kilo npm/package names, Docker image, archive filenames, AUR/Homebrew formula, and repository/tap destinations while dropping only upstream OpenCode branding variants that would publish the wrong artifacts.
- Alternatives: Take upstream verbatim, which would publish OpenCode-branded Docker/Homebrew/AUR artifacts instead of Kilo artifacts.
- Verification: git diff --check; bun script/upstream/decisions.ts check --version 1.14.24; bun run script/check-opencode-annotations.ts; bun run typecheck
- Resolution Hash: `283c6b916b3f`

### packages/opencode/src/cli/cmd/tui/config/tui.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `0bbbdc5888f2`
- Ours Hash: `11211b30cf84`
- Theirs Hash: `bcb4b17f9afd`
- Decision: hybrid
- Risk: medium
- Summary: Preserved Kilo TUI config discovery for .kilo/.kilocode and KILO_CONFIG_DIR.
- Rationale: Kilo intentionally loads tui.json from Kilo config locations in addition to upstream .opencode locations, so the resolution keeps that broader directory filter and the KILO_CONFIG_DIR rename while retaining upstream dependency/config loading flow.
- Alternatives: Take upstream directory filtering, which would skip .kilo/.kilocode TUI config files and regress Kilo configuration behavior.
- Verification: git diff --check; bun script/upstream/decisions.ts check --version 1.14.24; bun run script/check-opencode-annotations.ts; bun run typecheck
- Resolution Hash: `11211b30cf84`

### packages/opencode/src/config/config.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `976ae32a4d53`
- Ours Hash: `5af23b4b2848`
- Theirs Hash: `742596c7a467`
- Decision: hybrid
- Risk: high
- Summary: Preserved Kilo config schema/loading behavior while integrating upstream config loader changes.
- Rationale: The merge keeps Kilo warning accumulation, kilo.json discovery, Kilo config directory aliases, KILO_CONFIG/KILO_CONFIG_CONTENT env names, default plugins, indexing, and managed config behavior while retaining the upstream Effect-based config loading structure.
- Alternatives: Take upstream config loading, which would remove Kilo-specific config locations and env variables; take ours wholesale, which would risk missing upstream 1.14.24 schema/runtime updates.
- Verification: git diff --check; bun script/upstream/decisions.ts check --version 1.14.24; bun run script/check-opencode-annotations.ts; bun run typecheck
- Resolution Hash: `5af23b4b2848`

### packages/opencode/src/flag/flag.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `c57d94cd1424`
- Ours Hash: `a9540c5d8642`
- Theirs Hash: `70151b1f18e3`
- Decision: hybrid
- Risk: low
- Summary: Kept Kilo environment flag names for upstream filewatcher flags.
- Rationale: Upstream introduced/ordered the filewatcher flags under OpenCode names; Kilo must expose the same behavior through KILO_EXPERIMENTAL_DISABLE_FILEWATCHER and KILO_EXPERIMENTAL_FILEWATCHER to match the fork's env naming contract.
- Alternatives: Take upstream OPENCODE_* flags, which would silently ignore Kilo users' existing KILO_* env vars.
- Verification: git diff --check; bun script/upstream/decisions.ts check --version 1.14.24; bun run script/check-opencode-annotations.ts; bun run typecheck
- Resolution Hash: `fdf4c5800a3d`

### packages/opencode/src/provider/transform.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `8a49dea1ae9c`
- Ours Hash: `e5f8eac948be`
- Theirs Hash: `24dc523f8f1b`
- Decision: hybrid
- Risk: medium
- Summary: Accepted upstream DeepSeek reasoning handling and kept Kilo OpenRouter interleaved exclusion.
- Rationale: The DeepSeek transform is now upstream, so the cherry-pick marker was removed; Kilo's additional OpenRouter guard remains necessary because OpenRouter rejects the openaiCompatible interleaved provider option.
- Alternatives: Take upstream interleaved handling verbatim, which would reintroduce invalid OpenRouter provider options for Kilo-supported routing.
- Verification: git diff --check; bun script/upstream/decisions.ts check --version 1.14.24; bun run script/check-opencode-annotations.ts; bun run typecheck
- Resolution Hash: `1af399028502`

### packages/opencode/src/session/session.ts

- Conflict: UU (content)
- Recommendation: manual - Code files need manual review for kilocode_change markers
- Base Hash: `34d9179bda72`
- Ours Hash: `25a5436fb374`
- Theirs Hash: `e0608b16b0e5`
- Decision: hybrid
- Risk: high
- Summary: Preserved Kilo session filtering/listing behavior while accepting upstream session updates.
- Rationale: Kilo delegates directory/worktree-family filtering to KiloSession.filters and listGlobal; reapplying upstream's direct directory condition would duplicate or narrow filtering and break Agent Manager/global session behavior.
- Alternatives: Take upstream KILO_EXPERIMENTAL_WORKSPACES directory condition, which would conflict with KiloSession.filters and risk hiding valid sessions across worktree directories.
- Verification: git diff --check; bun script/upstream/decisions.ts check --version 1.14.24; bun run script/check-opencode-annotations.ts; bun run typecheck
- Resolution Hash: `25a5436fb374`
