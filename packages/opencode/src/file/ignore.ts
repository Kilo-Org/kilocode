import { sep } from "node:path"
import { Glob } from "../util/glob"
import { GENERATED_FOLDERS } from "../kilocode/generated-folders" // kilocode_change

export namespace FileIgnore {
  const FOLDERS = new Set([
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

  const FILES = [
    "**/*.swp",
    "**/*.swo",

    "**/*.pyc",

    // OS
    "**/.DS_Store",
    "**/Thumbs.db",

    // Logs & temp
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // Coverage/test outputs
    "**/coverage/**",
    "**/.nyc_output/**",
  ]

  export const PATTERNS = [...FILES, ...FOLDERS]

  export function match(
    filepath: string,
    opts?: {
      extra?: string[]
      whitelist?: string[]
    },
  ) {
    for (const pattern of opts?.whitelist || []) {
      if (Glob.match(pattern, filepath)) return false
    }

    const parts = filepath.split(/[/\\]/)
    for (let i = 0; i < parts.length; i++) {
      if (FOLDERS.has(parts[i])) return true
    }

    const extra = opts?.extra || []
    for (const pattern of [...FILES, ...extra]) {
      if (Glob.match(pattern, filepath)) return true
    }

    return false
  }

  // kilocode_change start - diff-specific generated file detection

  /** Test whether a file path is a generated/vendor file for diff filtering purposes. */
  export function generated(filepath: string): boolean {
    const parts = filepath.split(/[/\\]/)
    for (const part of parts) {
      if (GENERATED_FOLDERS.has(part)) return true
    }
    for (const pattern of FILES) {
      if (Glob.match(pattern, filepath)) return true
    }
    return false
  }

  /**
   * Parse .gitattributes content and return a matcher that checks for
   * linguist-generated=true. Returns a function that tests file paths.
   */
  export function parseGitattributes(content: string): (filepath: string) => boolean {
    const patterns: string[] = []
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      if (!trimmed.includes("linguist-generated")) continue
      // format: <pattern> <attr1> <attr2> ...
      // linguist-generated=true or linguist-generated
      const parts = trimmed.split(/\s+/)
      const pattern = parts[0]
      if (!pattern) continue
      const has = parts.some((p) => p === "linguist-generated" || p === "linguist-generated=true")
      if (has) patterns.push(pattern)
    }
    if (patterns.length === 0) return () => false
    return (filepath: string) => {
      const basename = filepath.split(/[/\\]/).pop() ?? filepath
      return patterns.some((p) => {
        // Git attributes: slashless patterns match any basename in the tree
        if (!p.includes("/")) return Glob.match(p, basename)
        return Glob.match(p, filepath)
      })
    }
  }
  // kilocode_change end
}
