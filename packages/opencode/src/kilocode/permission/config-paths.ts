import path from "path"
import { existsSync, lstatSync, realpathSync } from "fs"
import { Global } from "@opencode-ai/core/global"
import { KilocodePaths } from "@/kilocode/paths"

export namespace ConfigProtection {
  /**
   * Config directory prefixes (relative paths, forward-slash normalized).
   * Matches .kilo/ and legacy .kilocode/ at any depth within the project.
   */
  const CONFIG_DIRS = [".kilo/", ".kilocode/"]

  /**
   * Subdirectories under CONFIG_DIRS that are NOT config files (e.g. plan files).
   * Paths under these subdirs are exempt from config protection.
   */
  const EXCLUDED_SUBDIRS = ["plans/"]

  /**
   * Root-level config files that must be protected.
   * Matched only when the relative path has no directory component.
   */
  const CONFIG_ROOT_FILES = new Set(["kilo.json", "kilo.jsonc", "opencode.json", "opencode.jsonc", "AGENTS.md"])

  /** Metadata key used to signal the UI to hide the "Allow always" option. */
  export const DISABLE_ALWAYS_KEY = "disableAlways" as const

  /** Metadata key used to signal the UI this is a config-file-edit request, so the
   * "Config file edits always require approval" explanation copy applies. */
  export const CONFIG_PROTECTED_KEY = "configProtected" as const

  function normalize(p: string): string {
    return path.posix.normalize(p.replaceAll("\\", "/"))
  }

  /** Return the remainder after the config dir prefix, or undefined if excluded. */
  function excluded(remainder: string): boolean {
    return EXCLUDED_SUBDIRS.some((sub) => remainder.startsWith(sub))
  }

  /** Check if a project-relative path points to a config file or directory. */
  export function isRelative(pattern: string): boolean {
    const normalized = normalize(pattern)
    for (const dir of CONFIG_DIRS) {
      const bare = dir.slice(0, -1) // e.g. ".kilo"
      // Match at root (e.g. ".kilo/foo") or nested (e.g. "packages/sub/.kilo/foo")
      if (normalized === bare || normalized.endsWith("/" + bare)) return true
      if (normalized.startsWith(dir)) {
        if (excluded(normalized.slice(dir.length))) continue
        return true
      }
      const nested = normalized.indexOf("/" + dir)
      if (nested !== -1) {
        if (excluded(normalized.slice(nested + 1 + dir.length))) continue
        return true
      }
    }
    return CONFIG_ROOT_FILES.has(normalized)
  }

  function keys(p: string): string[] {
    if (process.platform !== "win32") return [path.resolve(p)]

    const expand = (value: string) => {
      const full = path.posix.normalize(value.replaceAll("\\", "/")).toLowerCase()
      const msys = full.replace(/^\/([a-z])(?=\/)/, "$1:")
      return [full, full.replace(/^[a-z]:/, ""), msys, msys.replace(/^[a-z]:/, "")]
    }

    return Array.from(new Set([...expand(p), ...expand(path.resolve(p))]))
  }

  function configs(): string[] {
    return Array.from(
      new Set([Global.Path.config, process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "kilo") : ""]),
    ).filter(Boolean)
  }

  function physical(filepath: string): string | undefined {
    try {
      const absolute = path.isAbsolute(filepath) ? filepath : path.resolve(filepath)
      let current = path.parse(absolute).root
      const parts = absolute.slice(current.length).split(process.platform === "win32" ? /[\\/]/ : /\//)
      if (!parts.includes("..") && existsSync(absolute)) return realpathSync.native(absolute)
      // Resolve links before following '..', including paths to files not yet created.
      for (const part of parts) {
        if (!part || part === ".") continue
        current = path.join(current, part)
        if (existsSync(current)) {
          current = realpathSync.native(current)
          continue
        }
        // A dangling link is not a new file: its eventual write target is unknown.
        if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) return undefined
      }
      return current
    } catch {
      return undefined
    }
  }

  function skillRoot(pattern: string): string | undefined {
    const dir = pattern.replace(/([\\/])\*$/, "$1")
    if (!path.isAbsolute(dir)) return
    const target = physical(dir)
    if (!target) return

    const roots = [...configs(), ...KilocodePaths.globalDirs()]
    for (const root of roots) {
      for (const name of ["skill", "skills"]) {
        const skills = physical(path.join(root, name))
        if (!skills || !within(target, skills) || within(skills, target)) continue
        const skill = path.relative(skills, target).split(path.sep)[0]
        if (!skill || /[*?\[\]{}]/.test(skill)) continue
        const candidate = normalize(path.join(skills, skill))
        if (/[*?\[\]{}]/.test(candidate)) continue
        return candidate
      }
    }
  }

  function fallback(p: string): boolean {
    if (process.platform !== "win32") return false
    return keys(p).some(
      (key) =>
        key.endsWith("/config/kilo") ||
        key.includes("/config/kilo/") ||
        key.endsWith("/.config/kilo") ||
        key.includes("/.config/kilo/"),
    )
  }

  /** Check if `child` is equal to or nested inside `parent`. */
  function within(child: string, parent: string): boolean {
    const sep = process.platform === "win32" ? "/" : path.sep
    return keys(child).some((child) =>
      keys(parent).some((parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)),
    )
  }

  /** Check if an absolute path is inside a known CLI config directory. */
  export function isAbsolute(filepath: string): boolean {
    if (fallback(filepath)) return true
    const target = physical(filepath)

    // ~/.config/kilo/ (XDG config)
    for (const dir of configs()) {
      const root = physical(dir)
      if (within(filepath, dir) || (target && root && within(target, root))) return true
    }

    // ~/.kilo/ and ~/.kilocode/ (legacy global dirs)
    for (const dir of KilocodePaths.globalDirs()) {
      const root = physical(dir)
      if (within(filepath, dir) || (target && root && within(target, root))) return true
    }

    return false
  }

  // Data protection is separate from config classification, which also grants trust
  // when parsing global commands and agents. Only file edits get data exceptions.
  function data(filepath: string, edit = false): boolean {
    if (!path.isAbsolute(filepath)) return false
    const root = path.resolve(Global.Path.data)
    const target = path.resolve(filepath)
    const canonical = physical(root)
    const resolved = physical(filepath)
    if (!resolved) return true
    const lexical = within(target, root)
    const inside = canonical && within(resolved, canonical)
    if (!edit && (within(root, target) || (canonical && within(canonical, resolved)))) return true
    if (!lexical && !inside) return false
    if (!edit || !canonical || !inside) return true

    const exempt = (file: string, base: string) => {
      const relative = normalize(path.relative(base, file))
      if (/^plans\/[^/]+\.md$/.test(relative)) return true
      const parts = relative.split("/")
      if (parts.at(0) !== "worktree" || parts.length < 4) return false
      // The worktree containers and each checkout's own config remain protected.
      return !isRelative(parts.slice(3).join("/"))
    }
    return !exempt(resolved, canonical) || (lexical && !exempt(target, root))
  }

  /** Return the only persistent rule allowed for one exact global skill subtree. */
  export function globalSkillPattern(request: { permission: string; patterns: readonly string[] }): string | undefined {
    if (request.permission !== "external_directory" || request.patterns.length === 0) return
    if (request.patterns.some((pattern) => data(pattern.replace(/([\\/])\*$/, "$1")))) return

    const roots = request.patterns.map(skillRoot)
    const first = roots[0]
    if (!first || roots.some((root) => !root || !within(root, first) || !within(first, root))) return
    return normalize(path.join(first, "*"))
  }

  export function isGlobalSkillRequest(request: { permission: string; patterns: readonly string[] }): boolean {
    return globalSkillPattern(request) !== undefined
  }

  /** Check a single path (absolute or relative) against config protection. */
  function protected_(p: string): boolean {
    return path.isAbsolute(p) ? isAbsolute(p) || data(p, true) : isRelative(p)
  }

  /**
   * Determine if a permission request targets config files or internal data.
   * Gates `edit` permissions and bash-originated `external_directory` requests.
   * File-tool reads are not restricted.
   */
  export function isRequest(request: {
    permission: string
    patterns: readonly string[]
    metadata?: Record<string, any>
  }): boolean {
    if (request.permission === "external_directory") {
      // File tools include metadata.filepath. They may read global config
      // without prompting, but edits are still protected separately via `edit`.
      if (request.metadata?.filepath) return false
      // Bash read-only file commands may read global config when explicitly allowed.
      if (request.metadata?.access === "read") return false
      for (const pattern of request.patterns) {
        const dir = pattern.replace(/([\\/])\*$/, "$1")
        const target = physical(dir)
        if (data(dir) || isAbsolute(dir) || (target && isAbsolute(target))) return true
      }
      return false
    }

    if (request.permission !== "edit") return false

    // Check patterns — handle both relative and absolute
    for (const pattern of request.patterns) {
      if (protected_(pattern)) return true
    }

    // Check metadata.filepath (absolute for edit, comma-joined relative for apply_patch)
    const fp = request.metadata?.filepath
    if (typeof fp === "string") {
      // apply_patch joins relative paths with ", "
      const parts = fp.includes(", ") ? fp.split(", ") : [fp]
      for (const part of parts) {
        if (protected_(part)) return true
      }
    }

    // Check metadata.files[] (apply_patch file objects with absolute filePath/movePath)
    const files = request.metadata?.files
    if (Array.isArray(files)) {
      for (const file of files) {
        for (const key of ["filePath", "movePath"] as const) {
          const val = file?.[key]
          if (typeof val === "string" && protected_(val)) return true
        }
      }
    }

    return false
  }
}
