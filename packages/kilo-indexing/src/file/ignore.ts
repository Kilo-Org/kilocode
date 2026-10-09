import { minimatch } from "minimatch"

export namespace FileIgnore {
  const folders = new Set([
    "node_modules",
    "bower_components",
    ".pnpm-store",
    "vendor",
    ".npm",
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    ".git",
    ".svn",
    ".hg",
    ".vscode",
    ".idea",
    ".turbo",
    ".output",
    "desktop",
    ".sst",
    ".cache",
    ".webkit-cache",
    "__pycache__",
    ".pytest_cache",
    "mypy_cache",
    ".history",
    ".gradle",
  ])

  const files = [
    "**/*.swp",
    "**/*.swo",
    "**/*.pyc",
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",
    "**/coverage/**",
    "**/.nyc_output/**",
    "**/.kilo/worktrees/**",
    "**/.kilocode/worktrees/**",
  ]

  export const PATTERNS = [...files, ...folders]

  // Bare folder names are not valid globs for nested matches. Expand them to
  // `**/name/**` so glob prunes the directory instead of walking its contents.
  export function globs() {
    return PATTERNS.map((pattern) => (pattern.includes("/") ? pattern : `**/${pattern}/**`))
  }

  export function match(
    filePath: string,
    opts?: {
      extra?: string[]
      whitelist?: string[]
    },
  ) {
    const normalized = filePath.replaceAll("\\", "/")

    for (const pattern of opts?.whitelist || []) {
      if (minimatch(normalized, pattern, { dot: true })) return false
    }

    const parts = normalized.split("/")
    for (const part of parts) {
      if (folders.has(part)) return true
    }

    const extra = opts?.extra || []
    for (const pattern of [...files, ...extra]) {
      if (minimatch(normalized, pattern, { dot: true })) return true
    }

    return false
  }
}
