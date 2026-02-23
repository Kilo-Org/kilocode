import { realpathSync } from "fs"
import path, { dirname, join, relative } from "path"

export namespace Filesystem {
  function normalizeComparablePath(input: string, platform = process.platform): string {
    const value = input.trim()
    if (!value) return value

    if (platform === "win32") {
      if (/^\/[a-z](?:\/|$)/i.test(value)) {
        const drive = value[1]!.toUpperCase()
        const rest = value.slice(2).replace(/\//g, "\\")
        return `${drive}:${rest}`
      }
      return value.replace(/\//g, "\\")
    }

    return value
  }

  function isInside(parent: string, child: string, platform = process.platform): boolean {
    if (platform === "win32") {
      const parentResolved = path.win32.resolve(normalizeComparablePath(parent, "win32"))
      const childResolved = path.win32.resolve(normalizeComparablePath(child, "win32"))
      const parentRoot = path.win32.parse(parentResolved).root.toLowerCase()
      const childRoot = path.win32.parse(childResolved).root.toLowerCase()
      if (parentRoot !== childRoot) return false
      const rel = path.win32.relative(parentResolved, childResolved)
      return rel === "" || (!rel.startsWith("..") && !path.win32.isAbsolute(rel))
    }

    const parentResolved = path.resolve(normalizeComparablePath(parent, platform))
    const childResolved = path.resolve(normalizeComparablePath(child, platform))
    const rel = relative(parentResolved, childResolved)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  }

  export const exists = (p: string) =>
    Bun.file(p)
      .stat()
      .then(() => true)
      .catch(() => false)

  export const isDir = (p: string) =>
    Bun.file(p)
      .stat()
      .then((s) => s.isDirectory())
      .catch(() => false)
  /**
   * On Windows, normalize a path to its canonical casing using the filesystem.
   * This is needed because Windows paths are case-insensitive but LSP servers
   * may return paths with different casing than what we send them.
   */
  export function normalizePath(p: string): string {
    if (process.platform !== "win32") return p
    try {
      return realpathSync.native(p)
    } catch {
      return p
    }
  }

  export function normalizeGitPath(raw: string, cwd: string, platform = process.platform): string {
    const value = raw.trim()
    if (!value) return ""
    if (platform !== "win32") return path.resolve(cwd, value)
    if (/^[a-z]:[\\/]/i.test(value)) return path.win32.normalize(value)
    if (/^\/[a-z]\//i.test(value)) {
      const drive = value[1]!.toUpperCase()
      const rest = value.slice(3).replace(/\//g, "\\")
      return path.win32.normalize(`${drive}:\\${rest}`)
    }
    return path.win32.resolve(cwd, value)
  }

  export function overlaps(a: string, b: string, platform = process.platform) {
    return isInside(a, b, platform) || isInside(b, a, platform)
  }

  export function contains(parent: string, child: string, platform = process.platform) {
    return isInside(parent, child, platform)
  }

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = join(current, target)
      if (await exists(search)) result.push(search)
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = join(current, target)
        if (await exists(search)) yield search
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  export async function globUp(pattern: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({
          cwd: current,
          absolute: true,
          onlyFiles: true,
          followSymlinks: true,
          dot: true,
        })) {
          result.push(match)
        }
      } catch {
        // Skip invalid glob patterns
      }
      if (stop === current) break
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }
}
