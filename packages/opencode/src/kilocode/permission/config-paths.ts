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

  /**
   * Whether the extra config-edit restrictions are active for one config source.
   * Default-on: only an explicit `false` disables it.
   */
  export function enabled(config?: { require_approval_for_config_edits?: boolean }): boolean {
    return config?.require_approval_for_config_edits !== false
  }

  /** Where a config request's protected targets live relative to the project boundary. */
  export type Scope = { inside: boolean; outside: boolean }

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
      const parts: string[] = []
      let current = path.resolve(filepath)
      while (!existsSync(current)) {
        const parent = path.dirname(current)
        if (parent === current) return
        parts.unshift(path.basename(current))
        current = parent
      }
      return path.join(realpathSync.native(current), ...parts)
    } catch {
      return
    }
  }

  /**
   * Whether a missing component of `filepath` is a symlink whose target does not exist yet.
   * `physical()` cannot resolve such a link, but a write follows it and creates the target, so the
   * real location is unknown. Uncertain lookups count as dangling so callers stay conservative.
   */
  function dangling(filepath: string): boolean {
    let current = path.resolve(filepath)
    while (!existsSync(current)) {
      try {
        if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) return true
      } catch {
        return true // e.g. EACCES or ENOTDIR: the location cannot be proven
      }
      const parent = path.dirname(current)
      if (parent === current) return false
      current = parent
    }
    return false
  }

  function skillRoot(pattern: string): string | undefined {
    const dir = pattern.replace(/[\\/]\*$/, "")
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
      keys(parent).some((parent) => child === parent || child.startsWith(parent + sep)),
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

  /** Return the only persistent rule allowed for one exact global skill subtree. */
  export function globalSkillPattern(request: { permission: string; patterns: readonly string[] }): string | undefined {
    if (request.permission !== "external_directory" || request.patterns.length === 0) return

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
    return path.isAbsolute(p) ? isAbsolute(p) : isRelative(p)
  }

  /**
   * Determine if a permission request targets config files.
   * Gates `edit` permissions and bash-originated `external_directory` requests.
   * File-tool reads are not restricted.
   */
  export function isRequest(request: Target): boolean {
    if (request.permission === "external_directory") return external(request)
    if (request.permission !== "edit") return false
    return edits(request).some(protected_)
  }

  /**
   * Classify a config request's protected targets against the project boundary (the git worktree,
   * or the instance directory for non-git projects). Global config dirs and targets that resolve
   * outside the boundary are `outside`; the rest are `inside`. Returns undefined when the request
   * does not target protected config.
   */
  export function scope(request: Target, ctx: { directory: string; worktree: string }): Scope | undefined {
    if (request.permission === "external_directory")
      return external(request) ? { inside: false, outside: true } : undefined
    if (request.permission !== "edit") return

    const targets = edits(request).filter(protected_)
    if (targets.length === 0) return
    const root = physical(ctx.worktree && ctx.worktree !== "/" ? ctx.worktree : ctx.directory)
    const places = targets.map((target) => {
      // A protected absolute target is always inside a global config dir.
      if (path.isAbsolute(target)) return "outside"
      // Tools report relative targets against the worktree. Resolve symlinks so an alias that
      // escapes the project follows the global policy.
      const full = path.resolve(ctx.worktree, target)
      if (isAbsolute(full) || dangling(full)) return "outside"
      const real = physical(full)
      return real && root && within(real, root) ? "inside" : "outside"
    })
    return { inside: places.includes("inside"), outside: places.includes("outside") }
  }

  export type Target = { permission: string; patterns: readonly string[]; metadata?: Record<string, any> }

  /** Bash-originated `external_directory` requests that reach a global config dir. */
  function external(request: Target): boolean {
    // File tools include metadata.filepath. They may read global config
    // without prompting, but edits are still protected separately via `edit`.
    if (request.metadata?.filepath) return false
    // Bash read-only file commands may read global config when explicitly allowed.
    if (request.metadata?.access === "read") return false
    return request.patterns.some((pattern) => {
      const dir = pattern.replace(/[\\/]\*$/, "")
      const target = physical(dir)
      return isAbsolute(dir) || (target !== undefined && isAbsolute(target))
    })
  }

  /** Every path an `edit` request may write: patterns, metadata.filepath, and apply_patch files. */
  function edits(request: Target): string[] {
    const out = [...request.patterns]
    // metadata.filepath is absolute for edit/write and comma-joined relative for apply_patch.
    const fp = request.metadata?.filepath
    if (typeof fp === "string") out.push(...(fp.includes(", ") ? fp.split(", ") : [fp]))
    // metadata.files[] carries apply_patch file objects with absolute filePath/movePath.
    const files = request.metadata?.files
    if (Array.isArray(files)) {
      for (const file of files) {
        for (const key of ["filePath", "movePath"] as const) {
          const val = file?.[key]
          if (typeof val === "string") out.push(val)
        }
      }
    }
    return out
  }
}
