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

  const MAGIC = /[*!?[\]{}()]/

  /**
   * Expands the ignore list into glob patterns that prune whole directories.
   *
   * RATIONALE: Bare directory names like `node_modules` only match a path that
   * is exactly that string. Glob and watcher engines never descend into a nested
   * `packages/a/node_modules` unless the pattern is anchored to match at any
   * depth and to match the directory contents. Passing the raw list therefore
   * silently walks every ignored directory; the anchored variants let those
   * engines skip the walk entirely.
   */
  export function globs(): string[] {
    const result = new Set<string>()
    for (const pattern of PATTERNS) {
      result.add(pattern)
      if (pattern.includes("/") || MAGIC.test(pattern)) {
        continue
      }
      result.add(`${pattern}/**`)
      result.add(`**/${pattern}`)
      result.add(`**/${pattern}/**`)
    }
    return [...result]
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
