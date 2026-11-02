import path from "node:path"
import fs from "node:fs"
import ignore, { type Ignore } from "ignore"

const KILOCODEIGNORE = ".kilocodeignore"
const GITIGNORE = ".gitignore"

/**
 * Patterns for sensitive environment files, applied only when no .kilocodeignore exists.
 */
const SENSITIVE_PATTERNS = [".env", ".env.*"]

// Matches Windows drive-letter absolute paths (e.g. "C:/" or "c:\").
// path.isAbsolute() on POSIX does not recognise these, so we check explicitly
// to avoid passing them to the `ignore` package which throws a RangeError.
const WINDOWS_DRIVE = /^[a-zA-Z]:[/\\]/
const REALPATH_CACHE_MAX = 1_000

function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/")
}

export class FileIgnoreController {
  private workspacePath: string
  /** The workspace path with symlinks resolved, for example /private/var on macOS for /var. */
  private realWorkspacePath = ""
  private ignoreInstance: Ignore = ignore()
  private readonly realpathCache = new Map<string, string>()

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath ? path.resolve(workspacePath) : ""
  }

  async initialize(): Promise<void> {
    this.ignoreInstance = ignore()
    this.realpathCache.clear()

    if (!this.workspacePath) {
      return
    }
    this.realWorkspacePath = fs.existsSync(this.workspacePath) ? fs.realpathSync.native(this.workspacePath) : this.workspacePath

    // Try .kilocodeignore first — if it exists, use only that.
    // Use existsSync to distinguish "missing" from "unreadable" — permission
    // errors on readFileSync will propagate instead of being silently swallowed.
    const kilocodeignorePath = path.join(this.workspacePath, KILOCODEIGNORE)
    if (fs.existsSync(kilocodeignorePath)) {
      const kilocodeignoreContent = fs.readFileSync(kilocodeignorePath, "utf-8")
      if (kilocodeignoreContent.trim()) {
        this.ignoreInstance.add(kilocodeignoreContent)
        this.ignoreInstance.add(KILOCODEIGNORE)
        return
      }
    }

    // Fallback: use .gitignore + hardcoded sensitive patterns.
    const gitignorePath = path.join(this.workspacePath, GITIGNORE)
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8")
      if (gitignoreContent.trim()) {
        this.ignoreInstance.add(gitignoreContent)
      }
    }

    // Always add sensitive patterns in the fallback path.
    this.ignoreInstance.add(SENSITIVE_PATTERNS)
  }

  private cacheRealpath(input: string, resolved: string): void {
    if (this.realpathCache.size >= REALPATH_CACHE_MAX) {
      const key = this.realpathCache.keys().next().value
      if (key !== undefined) this.realpathCache.delete(key)
    }
    this.realpathCache.set(input, resolved)
  }

  private toRelativePath(filePath: string): string | null {
    if (!filePath) {
      return null
    }

    let withoutUri = filePath
    if (filePath.startsWith("file:///")) {
      withoutUri = filePath.slice("file:///".length)
    } else if (filePath.startsWith("file://")) {
      withoutUri = filePath.slice("file://".length)
    }
    const absoluteInput = path.isAbsolute(withoutUri) ? withoutUri : path.resolve(this.workspacePath, withoutUri)

    const cached = this.realpathCache.get(absoluteInput)
    let resolved: string | undefined = cached
    if (!resolved) {
      try {
        resolved = fs.realpathSync(absoluteInput)
        this.cacheRealpath(absoluteInput, resolved)
      } catch {
        // The file does not exist yet, so it is compared as given below.
      }
    }

    // A resolved file is compared with the resolved workspace, so a workspace that is itself a symlink works and a
    // symlink that points outside it is denied. An unresolved path (a file that does not exist yet) is only ever
    // compared with the workspace path as given.
    const relative = resolved
      ? path.relative(this.realWorkspacePath || this.workspacePath, resolved)
      : path.relative(this.workspacePath, absoluteInput)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || WINDOWS_DRIVE.test(relative)) {
      return null
    }

    return toPosix(relative)
  }

  /**
   * Returns true if the file can be read/used as autocomplete context.
   * When no workspace path was provided, denies all access.
   */
  validateAccess(filePath: string): boolean {
    if (!this.workspacePath) {
      return false
    }

    const relative = this.toRelativePath(filePath)
    if (!relative) {
      // Outside workspace or unresolvable path: deny by default for security.
      return false
    }

    return !this.ignoreInstance.ignores(relative)
  }

  dispose(): void {
    this.realpathCache.clear()
    this.ignoreInstance = ignore()
  }
}
