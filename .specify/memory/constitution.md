<!--
Sync Impact Report
Version Change: 1.0.1 → 1.0.2 (Patch version bump for date update)
Modified Principles: None (date update only)
Added Sections: None
Removed Sections: None
Templates Requiring Updates: ✅ None (constitution is foundational)
Follow-up TODOs: None
-->

# Kilo Code Constitution

## Core Principles

### I. Monorepo Architecture with pnpm & Turbo

Every package must be independently buildable, testable, and publishable. The pnpm workspace structure with Turbo orchestration is non-negotiable. Packages must declare explicit dependencies via `workspace:^` protocol. Turbo task pipelines must be defined for lint, test, build, and bundle operations across all packages and apps.

**Rationale**: This ensures consistent builds, enables parallel development, and maintains clear boundaries between the extension core, webview UI, CLI, and shared packages.

### II. VSCode Extension as Primary Deliverable

The VSCode extension in `src/` is the primary product. All features must integrate seamlessly with VSCode's extension API, webview capabilities, and command palette. The webview UI must use React with TypeScript, follow VSCode's theme system, and respect workspace boundaries.

**Rationale**: Kilo Code is a VSCode extension first and foremost. Other platforms (CLI, JetBrains) are secondary and must not compromise the core VSCode experience.

### III. Test Coverage Before Implementation (NON-NEGOTIABLE)

All new features require tests written first using vitest. Tests must be placed alongside source files with `.test.ts` or `.spec.ts` naming. Integration tests must verify tool behaviors (read-file, apply-diff, execute-command). The `cd src && pnpm test` command must pass before any implementation is considered complete.

**Rationale**: The AGENTS.md explicitly states "Before attempting completion, always make sure that any code changes have test coverage." This is a critical quality gate.

### IV. Fork Compatibility with kilocode_change Markers

All modifications to core extension code (files existing in upstream Roo Code) must be marked with `kilocode_change` comments. New files in Kilo-specific directories (`cli/`, `jetbrains/`, paths containing `kilocode`) do not require markers. Changes must minimize merge conflicts during upstream syncs.

**Rationale**: Kilo Code is a fork of Roo Code. Without these markers, upstream merges become impossible to manage.

### V. AI Provider Abstraction & Multi-Model Support

The system must support 50+ AI providers through a unified interface in `src/api/providers/`. Each provider implements a common contract for authentication, request/response handling, and error management. Provider implementations must be isolated and independently testable.

**Rationale**: Multi-model support is a core value proposition. The architecture must accommodate new providers without refactoring existing code.

## Development Standards

### Technology Stack Requirements

- **Runtime**: Node.js 20.19.2 (enforced via package.json engines)
- **Package Manager**: pnpm 10.8.1 with workspace protocol
- **Language**: TypeScript 5.4.5 with strict mode enabled
- **Build**: esbuild for bundling, Turbo for orchestration
- **Testing**: vitest with workspace-specific test commands
- **Linting**: ESLint with project-specific configs, Prettier for formatting

### Code Organization

- `src/` - VSCode extension core (upstream-compatible)
- `webview-ui/` - React frontend for chat interface
- `cli/` - Standalone CLI package (Kilo-specific)
- `packages/` - Shared libraries (types, ipc, telemetry, cloud)
- `apps/` - Applications (E2E tests, Storybook, docs)
- `jetbrains/` - JetBrains plugin (Kilo-specific)

## Governance

### Amendment Procedure

1. Propose changes via pull request with clear rationale
2. Update constitution version according to semantic versioning:
    - MAJOR: Breaking changes to principles or architecture
    - MINOR: New principles or substantial guidance additions
    - PATCH: Clarifications, wording improvements, typo fixes
3. All PRs must verify compliance with existing principles
4. Changes require approval from project maintainers

### Compliance Verification

- All PRs must pass `pnpm lint`, `pnpm check-types`, and `pnpm test`
- Constitution compliance must be verified in PR descriptions
- Complexity must be justified with reference to specific principles
- Use `.kilocode/rules/` for runtime development guidance

**Version**: 1.0.2 | **Ratified**: 2026-01-10 | **Last Amended**: 2026-01-13
