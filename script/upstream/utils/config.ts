#!/usr/bin/env bun
/**
 * Configuration for upstream merge automation
 */

export interface PackageMapping {
  from: string
  to: string
}

export interface MergeConfig {
  /** Package name mappings from opencode to kilo */
  packageMappings: PackageMapping[]

  /** Files to always keep Kilo's version (never take upstream changes) */
  keepOurs: string[]

  /** Files to skip entirely (don't add from upstream, remove if added) */
  skipFiles: string[]

  /** Files that should take upstream version and apply Kilo branding transforms */
  takeTheirsAndTransform: string[]

  /** Script files with GitHub API references */
  scriptFiles: string[]

  /** Extension files (Zed, etc.) */
  extensionFiles: string[]

  /** Web/docs files */
  webFiles: string[]

  /** Lock files to accept ours and regenerate after merge */
  lockFiles: string[]

  /** Directories that are Kilo-specific and should be preserved */
  kiloDirectories: string[]

  /** File patterns to exclude from codemods */
  excludePatterns: string[]

  /** Default branch to merge into */
  baseBranch: string

  /** Branch prefix for merge branches */
  branchPrefix: string

  /** Remote name for upstream */
  upstreamRemote: string

  /** Remote name for origin */
  originRemote: string

  /** i18n file patterns that need string transformation */
  i18nPatterns: string[]
}

export const defaultConfig: MergeConfig = {
  packageMappings: [
    { from: "opencode-ai", to: "@kilocode/cli" },
    { from: "@opencode-ai/cli", to: "@kilocode/cli" },
    { from: "@opencode-ai/sdk", to: "@kilocode/sdk" },
    { from: "@opencode-ai/plugin", to: "@kilocode/plugin" },
  ],

  keepOurs: [
    "README.md",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "PRIVACY.md",
    "SECURITY.md",
    "AGENTS.md",
    // GitHub workflows - MANUAL REVIEW (can break CI/CD)
    ".github/workflows/publish.yml",
    ".github/workflows/close-stale-prs.yml",
    ".github/pull_request_template.md",
    // Kilo-specific command files
    ".opencode/command/commit.md",
    // Kilo-specific publish scripts
    "packages/opencode/script/publish-registries.ts",
    // Generated OpenAPI spec - kept ours and regenerated post-merge via script/generate.ts
    "packages/sdk/openapi.json",
    // GitHub Action - Kilo version is fully ported and complete
    "github/action.yml",
    "github/README.md",
    "github/script/release",
    "github/script/publish",
  ],

  // Files that only exist in upstream and should NOT be added to Kilo
  // These are removed during merge if they appear
  skipFiles: [
    // Translated README files (Kilo doesn't have these)
    "README.ar.md",
    "README.bn.md",
    "README.br.md",
    "README.bs.md",
    "README.da.md",
    "README.de.md",
    "README.es.md",
    "README.fr.md",
    "README.gr.md",
    "README.it.md",
    "README.ja.md",
    "README.ko.md",
    "README.no.md",
    "README.pl.md",
    "README.ru.md",
    "README.th.md",
    "README.tr.md",
    "README.uk.md",
    "README.vi.md",
    "README.zh.md",
    "README.zht.md",
    // Stats file
    "STATS.md",
    // Team members file (Kilo doesn't maintain this upstream list)
    ".github/TEAM_MEMBERS",
    // Workflows that don't exist in Kilo
    ".github/workflows/update-nix-hashes.yml",
    ".github/workflows/deploy.yml",
    ".github/workflows/docs-update.yml",
    ".github/workflows/docs-locale-sync.yml",
    // Workflows deleted in Kilo (replaced or no longer needed)
    ".github/workflows/opencode.yml",
    ".github/workflows/publish-vscode.yml",
    // VS Code example configs (Kilo ships real .vscode/* files)
    ".vscode/launch.example.json",
    ".vscode/settings.example.json",
    // Nix files for packages Kilo has removed / replaced with nix/kilo.nix
    "nix/desktop.nix",
    "nix/opencode.nix",
    // opencode CLI bin (Kilo uses its own build output)
    "packages/opencode/bin/opencode",
    // Removed prompt file
    "packages/opencode/src/session/prompt/build-switch.txt",
    // Vouch files (Kilo doesn't use Vouch).
    // Upstream currently ships VOUCHED.td (typo extension). The glob covers both
    // the current .td file and any future .md rename without another merge breaking.
    ".github/VOUCHED.*",
    ".github/workflows/vouch-check-issue.yml",
    ".github/workflows/vouch-check-pr.yml",
    ".github/workflows/vouch-manage-by-issue.yml",
    // SST infrastructure files (Kilo is CLI-only, no hosted platform)
    "sst.config.ts",
    "sst-env.d.ts",
    // Hosted platform packages (not needed for CLI)
    "infra/**",
    "packages/console/**",
    "packages/enterprise/**",
    "packages/web/**",
    "packages/slack/**",
    "packages/function/**",
    "packages/docs/**",
    "packages/identity/**",
    "packages/app/**",
    "packages/desktop/**",
    "packages/desktop-electron/**",
    // GitHub Action - Kilo version is fully ported and complete
    "github/index.ts",
    "github/package.json",
    "github/tsconfig.json",
    "github/bun.lock",
    "github/sst-env.d.ts",
    "github/.gitignore",
  ],

  // Files that should take upstream version and apply Kilo branding transforms
  // These are files with only branding differences, no logic changes
  takeTheirsAndTransform: [
    // UI components
    "packages/ui/src/components/**/*.tsx",
    "packages/ui/src/context/**/*.tsx",
  ],

  // Script files with GitHub API references
  scriptFiles: ["script/*.ts", "packages/opencode/script/*.ts"],

  // Extension files
  extensionFiles: ["packages/extensions/**/*"],

  // Web/docs files
  webFiles: [],

  // Lock files and generated files to accept ours and regenerate after merge
  // Note: nix/hashes.json is regenerated by CI (update-nix-hashes.yml), not locally
  lockFiles: [
    "bun.lock",
    "**/bun.lock",
    "package-lock.json",
    "**/package-lock.json",
    "yarn.lock",
    "**/yarn.lock",
    "pnpm-lock.yaml",
    "**/pnpm-lock.yaml",
    "Cargo.lock",
    "**/Cargo.lock",
    "nix/hashes.json",
  ],

  kiloDirectories: [
    "packages/opencode/src/kilocode",
    "packages/opencode/test/kilocode",
    "packages/kilo-gateway",
    "packages/kilo-telemetry",
    "packages/kilo-vscode",
    "packages/kilo-ui",
    "packages/kilo-docs",
    "packages/kilo-i18n",
    "script/upstream",
  ],

  excludePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.git/**",
    "**/bun.lock",
    "**/package-lock.json",
    "**/yarn.lock",
  ],

  baseBranch: "main",
  branchPrefix: "upstream-merge",
  upstreamRemote: "upstream",
  originRemote: "origin",

  // i18n translation files that need Kilo branding transforms
  i18nPatterns: ["packages/*/src/i18n/*.ts"],
}

export function loadConfig(overrides?: Partial<MergeConfig>): MergeConfig {
  return { ...defaultConfig, ...overrides }
}
