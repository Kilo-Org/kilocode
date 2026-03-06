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
    return generatedFolder(filepath) !== undefined
  }

  /**
   * Return the generated folder prefix for a path, or undefined if not generated.
   * For "packages/app/node_modules/react/index.js" returns "packages/app/node_modules".
   */
  export function generatedFolder(filepath: string): string | undefined {
    const parts = filepath.split(/[/\\]/)
    for (let i = 0; i < parts.length; i++) {
      if (GENERATED_FOLDERS.has(parts[i]!)) return parts.slice(0, i + 1).join("/")
    }
    for (const pattern of FILES) {
      if (Glob.match(pattern, filepath)) {
        // File-level match — group by parent directory
        const slash = filepath.lastIndexOf("/")
        return slash >= 0 ? filepath.slice(0, slash) : filepath
      }
    }
    return undefined
  }

  /**
   * Parse .gitattributes content and return a matcher that checks for
   * linguist-generated=true. Returns a function that tests file paths.
   */
  export function parseGitattributes(content: string): (filepath: string) => boolean {
    // Collect rules in order — later rules override earlier ones (git semantics).
    // positive = true means linguist-generated, false means opt-out.
    const rules: Array<{ pattern: string; positive: boolean }> = []
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      if (!trimmed.includes("linguist-generated")) continue
      const parts = trimmed.split(/\s+/)
      const pattern = parts[0]
      if (!pattern) continue
      const negative = parts.some((p) => p === "-linguist-generated" || p === "linguist-generated=false")
      const positive = parts.some((p) => p === "linguist-generated" || p === "linguist-generated=true")
      if (negative) rules.push({ pattern, positive: false })
      else if (positive) rules.push({ pattern, positive: true })
    }
    if (rules.length === 0) return () => false
    return (filepath: string) => {
      const basename = filepath.split(/[/\\]/).pop() ?? filepath
      // Last matching rule wins (git attribute semantics)
      let result = false
      for (const rule of rules) {
        const matches = rule.pattern.includes("/")
          ? Glob.match(rule.pattern, filepath)
          : Glob.match(rule.pattern, basename)
        if (matches) result = rule.positive
      }
      return result
    }
  }
  // kilocode_change end
}
