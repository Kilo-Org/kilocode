#!/usr/bin/env bun
/**
 * Configuration for upstream merge automation on the Kilo v2 line.
 *
 * The v2 line merges upstream OpenCode `dev` release by release. Each sync merges the release
 * commit of a `v2.x.y` tag (the parent of the tag: the tag itself is a version-bump commit next
 * to the branch).
 */

import { owned, ownedDirectories } from "./owned"

export interface PackageMapping {
  from: string
  to: string
}

export interface TransformSwitches {
  /** Rename upstream package names to Kilo names. Off until decision D-1. */
  packageNames: boolean
  /** Brand text transforms and codemods (i18n, take-theirs, scripts, extensions, web) and the brand-text rules of the string codemod. Off until rebranding (A11). */
  branding: boolean
  /** Keep Kilo package versions instead of upstream's. Off: v2 follows upstream version numbers. */
  versions: boolean
}

export interface MergeConfig {
  /** Package name mappings, used only when `transforms.packageNames` is on */
  packageMappings: PackageMapping[]

  /** Shared files where Kilo always keeps its version (never take upstream changes) */
  keepOurs: string[]

  /** Upstream files that Kilo does not ship (removed when a merge adds them) */
  skipFiles: string[]

  /** Files that take the upstream version plus Kilo branding transforms */
  takeTheirsAndTransform: string[]

  /** Script files with GitHub API references */
  scriptFiles: string[]

  /** Editor extension files */
  extensionFiles: string[]

  /** Web/docs files */
  webFiles: string[]

  /** Lock files to accept ours and regenerate after merge */
  lockFiles: string[]

  /** Kilo-owned directories (see utils/owned.ts) */
  kiloDirectories: string[]

  /** Kilo-owned path patterns (see utils/owned.ts) */
  kiloOwned: string[]

  /** File patterns to exclude from codemods */
  excludePatterns: string[]

  /** Kilo branch to merge into */
  baseBranch: string

  /** Upstream branch that carries the release commits */
  upstreamBranch: string

  /** Upstream branches that must never be merged */
  frozenBranches: string[]

  /** Tags that mark upstream releases for this line */
  tagPattern: RegExp

  /** Upstream release commit that the Kilo base branch was created from (before the first sync) */
  initialBase: string

  /** Prefix for sync branches, for example `sync-v2-0-27` */
  branchPrefix: string

  /** Remote name for upstream */
  upstreamRemote: string

  /** Upstream repository URL, used when the remote is missing */
  upstreamUrl: string

  /** Remote name for origin */
  originRemote: string

  /** i18n file patterns that need string transformation */
  i18nPatterns: string[]

  /** Harness packages, for the change size in sync reports */
  harness: string[]

  /** Transform switches */
  transforms: TransformSwitches
}

export const defaultConfig: MergeConfig = {
  // Only used when `transforms.packageNames` is on (decision D-1). Upstream uses `@opencode/*`
  // on the v2 line. The proposal for D-1 keeps these names and renames only published packages.
  packageMappings: [
    { from: "@opencode/cli", to: "@kilocode/cli" },
    { from: "@opencode/sdk", to: "@kilocode/sdk" },
    { from: "@opencode/plugin", to: "@kilocode/plugin" },
  ],

  // Kilo does not replace a shared upstream file as a whole on v2 yet. Kilo-owned paths are kept by
  // `kiloOwned`. Add a file here only when Kilo owns its full content and the reason is in the PR.
  keepOurs: [],

  // Upstream product areas that Kilo does not ship. The sync removes upstream changes and additions under
  // these paths (modify/delete conflicts included), and the shared-patch counter does not count them.
  // Workflows are handled by `script/check-workflows.ts --fix` (its `removed` list), not by this list.
  skipFiles: [
    // Desktop and web app, and the GUI packages only they use
    "packages/desktop/**",
    "packages/app/**",
    "packages/gui-extensions/**",
    "packages/session-ui/**",
    "packages/storybook/**",
    "script/sdk-docs.ts",
    "script/ast-grep/gui-extensions/**",
    // Hosted opencode.ai platform
    "packages/console/**",
    "packages/enterprise/**",
    "packages/web/**",
    "packages/posts/**",
    "packages/function/**",
    "packages/stats/**",
    "infra/**",
    "sst.config.ts",
    "salesforce/**",
    // Upstream VS Code extension (Kilo ships its own)
    "sdks/vscode/**",
    // Upstream's own project config for developing OpenCode: contributor agents, commands, skills, glossaries,
    // triage tools and sample themes. Kilo keeps its own contributor config in `.kilo` (runtime config names:
    // migration-tracking/principles.md, section 4).
    ".opencode/**",
  ],

  // Branding only (`transforms.branding`).
  takeTheirsAndTransform: ["packages/ui/src/components/**/*.tsx", "packages/ui/src/context/**/*.tsx"],

  // Branding only (`transforms.branding`).
  scriptFiles: ["script/*.ts", "packages/cli/script/*.ts"],

  // Branding only. `packages/extensions` does not exist on the v2 line.
  extensionFiles: [],

  // Branding only. `packages/web` is upstream's docs site on v2.
  webFiles: ["packages/web/src/content/docs/**/*.mdx"],

  // Lock files and generated files to accept ours and regenerate after merge
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
  ],

  kiloDirectories: ownedDirectories(),
  kiloOwned: owned,

  excludePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.git/**",
    "**/bun.lock",
    "**/package-lock.json",
    "**/yarn.lock",
  ],

  baseBranch: "v2",
  upstreamBranch: "dev",
  // Upstream promoted v2 to `dev` on 2026-10-10. `upstream/v2` is frozen at 4617210822b.
  frozenBranches: ["v2"],
  tagPattern: /^v2\.\d+\.\d+$/,
  // Release commit of upstream v2.0.26 (parent of the tag). `origin/v2` starts here.
  initialBase: "5e73d5cb1f788637b1b3d5cf1298ea694cbad0c5",
  branchPrefix: "sync",
  upstreamRemote: "upstream",
  upstreamUrl: "https://github.com/anomalyco/opencode.git",
  originRemote: "origin",

  // Branding only. On v2 this pattern matches upstream's `packages/ui` and `packages/web` locales.
  i18nPatterns: ["packages/*/src/i18n/*.ts"],

  harness: [
    "packages/core",
    "packages/cli",
    "packages/server",
    "packages/tui",
    "packages/plugin",
    "packages/protocol",
    "packages/schema",
    "packages/client",
    "packages/sdk",
    "packages/util",
    "packages/ai",
  ],

  transforms: {
    packageNames: false,
    branding: false,
    versions: false,
  },
}

export function loadConfig(overrides?: Partial<MergeConfig>): MergeConfig {
  return { ...defaultConfig, ...overrides }
}

export function resolveBaseBranch(base: string | undefined, current: string): string | undefined {
  if (base !== "HEAD") return base
  if (current === "HEAD") throw new Error("--base-branch HEAD requires a named branch, but git is in detached HEAD")
  return current
}
