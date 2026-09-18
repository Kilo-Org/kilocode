import path from "path"
import { existsSync, realpathSync } from "fs"
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

  /** The `require_approval_for_config_edits` value from one config source. */
  type Config = { require_approval_for_config_edits?: boolean }

  /**
   * Whether the extra config-edit restrictions are active for one config source.
   * Default-on: only an explicit `false` disables it. Callers pass the global config for
   * global/out-of-project targets and the effective project config for in-boundary targets.
   */
  export function enabled(config?: Config): boolean {
    return config?.require_approval_for_config_edits !== false
  }

  /**
   * Scope of one protected config target relative to the active project.
   * - `global`: inside a Kilo global config directory (a global config dir inside the
   *   project still counts as global).
   * - `inside`: a protected config path proven to be inside the project boundary.
   * - `outside`: a protected config path outside the boundary, or one that could not be
   *   proven inside (symlink escape, failed resolution). Falls back to the global policy.
   * - `none`: not a protected config path.
   */
  type Scope = "global" | "inside" | "outside" | "none"

  /** Per-request outcome of applying the global and project protection policies. */
  export type Verdict = {
    /** The request targets at least one protected config path, ignoring policy. */
    candidate: boolean
    /** Protection applies to this request under the current policies. */
    protect: boolean
    /** Some protected target is global or outside the project boundary. */
    external: boolean
    /** Exact global skill subtree resolved for this request, when it is one skill. */
    skill?: string
  }

  /**
   * The canonical global skill subtree that may narrow this request, or undefined when the request
   * keeps its requested patterns. Protection applies it while config protection is active; a
   * file-tool read is never config-gated but still resolves the same canonical skill, so an "Allow
   * always" reply cannot persist an alias that a later retarget points outside the skill. A config
   * edit with protection disabled keeps its requested rule instead.
   */
  export function skillScope(verdict: Verdict): string | undefined {
    return verdict.protect || !verdict.candidate ? verdict.skill : undefined
  }

  /**
   * The real project boundary: the git worktree root, or the instance directory for non-git
   * projects. Never `/` for non-git projects.
   */
  export function boundary(ctx: { directory: string; worktree?: string }): string {
    return ctx.worktree && ctx.worktree !== "/" ? ctx.worktree : ctx.directory
  }

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

  /** Structural shape shared by config-gated permission requests. */
  export type Target = { permission: string; patterns: readonly string[]; metadata?: Record<string, any> }

  /** Collect every path string a permission request may write to. */
  function targets(request: Target): string[] {
    if (request.permission === "external_directory") {
      // File tools include metadata.filepath. They may read global config
      // without prompting, but edits are still protected separately via `edit`.
      if (request.metadata?.filepath) return []
      // Bash read-only file commands may read global config when explicitly allowed.
      if (request.metadata?.access === "read") return []
      return request.patterns.map((pattern) => pattern.replace(/[\\/]\*$/, ""))
    }

    if (request.permission !== "edit") return []

    const out: string[] = [...request.patterns]
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

  /** Absolute path contains a `.kilo`/`.kilocode` config directory segment. */
  function configPath(abs: string): boolean {
    const parts = normalize(abs).split("/")
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] !== ".kilo" && parts[i] !== ".kilocode") continue
      if (isRelative(parts.slice(i).join("/"))) return true
    }
    return false
  }

  /**
   * Classify one target path against the project boundary.
   *
   * A target is protected when EITHER the requested (lexical) path or the canonical
   * (symlink-resolved) path is config-shaped: root config filenames relative to the matching root,
   * or `.kilo`/`.kilocode` directory segments. The scope follows physical containment, so an alias
   * into the project uses the project policy, an alias out of it uses the global policy, and global
   * config dirs win at either location. Root config filenames are recognized only relative to a
   * known root, so an arbitrary outside filename is never newly protected.
   */
  function level(target: string, root: string): Scope {
    const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(root, target)
    // Global config dirs stay global even when physically inside the project boundary.
    if (isAbsolute(abs)) return "global"

    const canonRoot = physical(root)
    const canon = physical(abs)
    if (!protectedTarget(target, abs, root, canon, canonRoot)) return "none"
    return canon && canonRoot && within(canon, canonRoot) ? "inside" : "outside"
  }

  /** Whether the requested (lexical) or canonical path is a protected config shape. */
  function protectedTarget(
    target: string,
    abs: string,
    root: string,
    canon: string | undefined,
    canonRoot: string | undefined,
  ): boolean {
    // Requested path. Root-relative names count only inside the requested root; outside it only
    // config dir segments count, so the protected filename set does not grow.
    if (within(abs, root)) {
      if (isRelative(normalize(path.relative(root, abs))) || configPath(abs)) return true
    } else if (path.isAbsolute(target) ? configPath(abs) : isRelative(target) || configPath(abs)) {
      return true
    }

    if (!canon) return false
    // Canonical path. Root-relative names count only inside the canonical root.
    if (canonRoot && within(canon, canonRoot)) {
      return isRelative(normalize(path.relative(canonRoot, canon))) || configPath(canon)
    }
    return configPath(canon)
  }

  /** Whether one target looks like a protected config path, ignoring policy and containment. */
  function configLike(target: string): boolean {
    return path.isAbsolute(target) ? isAbsolute(target) || configPath(target) : isRelative(target)
  }

  /**
   * Immutable per-request target classification, computed once and reused for both the config-load
   * gate and the policy verdict within one permission operation. `skill` is resolved lazily and
   * memoized so a request only walks the global skill roots when the gate or an external verdict
   * actually reads it. The result must not outlive the operation: files and symlinks can change
   * between ask and reply, so each later operation classifies again.
   */
  export type Classification = {
    /** The request targets at least one config-shaped path, ignoring policy. */
    readonly candidate: boolean
    /** Some protected target is global or outside the project boundary. */
    readonly external: boolean
    /** Some protected target is proven inside the project boundary. */
    readonly inside: boolean
    /** Exact global skill subtree that may bypass protection, resolved on first read. */
    readonly skill?: string
  }

  /**
   * Classify every target path of one request against the project boundary. This is the single
   * filesystem-resolution pass: the returned scopes drive `candidate`, `external`, and `inside`,
   * and the lazy skill probe is memoized. Prefer this plus `verdict` over `evaluate` when the same
   * request is both gated (does policy loading apply?) and evaluated.
   */
  export function classify(request: Target, root: string): Classification {
    const scopes = targets(request).map((target) => level(target, root))
    const candidate = scopes.some((scope) => scope !== "none")
    const external = scopes.some((scope) => scope === "global" || scope === "outside")
    const inside = scopes.some((scope) => scope === "inside")
    let skill: string | undefined
    let resolved = false
    return {
      candidate,
      external,
      inside,
      get skill() {
        if (!resolved) {
          skill = globalSkillPattern(request)
          resolved = true
        }
        return skill
      },
    }
  }

  /** Apply the global and project protection policies to one already-classified request. */
  export function verdict(classification: Classification, input: { global?: Config; project?: Config } = {}): Verdict {
    if (!classification.candidate)
      return { candidate: false, protect: false, external: false, skill: classification.skill }
    const protect =
      (classification.external && enabled(input.global)) || (classification.inside && enabled(input.project))
    return {
      candidate: true,
      protect,
      external: classification.external,
      skill: classification.external ? classification.skill : undefined,
    }
  }

  /**
   * Determine if a permission request targets config files at all, ignoring policy.
   * Gates `edit` permissions and bash-originated `external_directory` requests.
   * File-tool reads are not restricted. When `root` is provided, relative targets are resolved
   * against the project boundary so paths into global config dirs are still detected.
   */
  export function isRequest(request: Target, root?: string): boolean {
    if (root) return classify(request, root).candidate
    return targets(request).some(configLike)
  }

  /**
   * Apply the global and project protection policies to one permission request.
   *
   * Targets proven inside the project boundary use the effective project policy; global config
   * dirs, out-of-boundary targets, and targets that cannot be proven inside use the global
   * policy. A request is protected when any of its targets is protected under its own policy,
   * so a project opt-out can never bypass protection for an out-of-project target.
   */
  export function evaluate(request: Target, input: { root: string; global?: Config; project?: Config }): Verdict {
    return verdict(classify(request, input.root), input)
  }
}
