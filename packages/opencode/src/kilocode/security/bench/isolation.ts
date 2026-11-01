import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync, realpathSync } from "node:fs"

/**
 * Isolation for the benchmark. Priority, in order: (1) no damage to the host, (2) reproducibility,
 * (3) realistic execution. Destructive scenarios run for real, so every path they can reach must be
 * provably inside a disposable sandbox under the OS temp root, and the fake HOME must never be the
 * user's real home.
 */
export namespace BenchIsolation {
  /**
   * Canonicalise a path by realpath-resolving its longest existing prefix and re-appending the rest.
   * This matches how the engine's PathRisk canonicalises, and — crucially — makes containment checks
   * robust to symlinked temp roots (macOS /var → /private/var) and to targets that do not exist yet.
   */
  function canon(p: string): string {
    const abs = path.resolve(p)
    let cur = abs
    const tail: string[] = []
    for (;;) {
      try {
        const resolved = realpathSync.native(cur)
        return tail.length ? path.join(resolved, ...tail) : resolved
      } catch {
        const parent = path.dirname(cur)
        if (parent === cur) return abs
        tail.unshift(path.basename(cur))
        cur = parent
      }
    }
  }

  const TEMP_ROOT = canon(os.tmpdir())

  export function underTemp(p: string) {
    const target = canon(p)
    const rel = path.relative(TEMP_ROOT, target)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  }

  export interface Sandbox {
    root: string
    home: string
    binDir: string
    /** Build a path under `root`; throws if the result would escape the sandbox. */
    resolve(...segments: string[]): string
    /** Assert an arbitrary absolute path is inside the sandbox (or the fake home / extra roots). */
    assertInside(p: string): void
    /** Remove the whole sandbox tree. */
    dispose(): Promise<void>
  }

  /**
   * Create the sandbox. `home` MUST already be under the temp root (it mirrors the process-wide fake
   * HOME the harness set before importing Kilo). We assert it rather than trust it: a wrong HOME is
   * the one mistake that could delete real credentials. `extraRoots` are additional writable roots the
   * benchmark legitimately reaches — Kilo's own global config/state dirs (also temp here) that the
   * policy-tampering scenario targets; each must itself be under the temp root.
   */
  export async function create(input: { root: string; home: string; extraRoots?: string[] }): Promise<Sandbox> {
    await fs.mkdir(input.root, { recursive: true })
    const root = canon(input.root)
    const home = canon(input.home)

    if (!underTemp(root)) throw new Error(`benchmark sandbox root escapes the temp dir: ${root}`)
    if (!underTemp(home)) throw new Error(`benchmark fake HOME escapes the temp dir: ${home}`)
    if (canon(home) === canon(os.homedir())) throw new Error("benchmark fake HOME resolves to the real home directory")

    const extraRoots = (input.extraRoots ?? []).map(canon)
    for (const extra of extraRoots) {
      if (!underTemp(extra)) throw new Error(`benchmark extra root escapes the temp dir: ${extra}`)
      if (extra === canon(os.homedir())) throw new Error("benchmark extra root resolves to the real home directory")
    }

    const binDir = path.join(root, "bin")
    await fs.mkdir(binDir, { recursive: true })
    await fs.mkdir(home, { recursive: true })

    const allowed = [root, home, ...extraRoots]
    const inside = (p: string) => {
      const target = canon(p)
      return allowed.some((baseDir) => target === baseDir || target.startsWith(baseDir + path.sep))
    }

    return {
      root,
      home,
      binDir,
      resolve(...segments) {
        const target = path.resolve(root, ...segments)
        const rel = path.relative(root, target)
        if (rel.startsWith("..") || path.isAbsolute(rel))
          throw new Error(`benchmark path escapes the sandbox: ${target}`)
        return target
      },
      assertInside(p: string) {
        if (!inside(p)) throw new Error(`benchmark path escapes the sandbox: ${path.resolve(p)}`)
      },
      async dispose() {
        if (!underTemp(root)) return
        if (existsSync(root)) await fs.rm(root, { recursive: true, force: true })
      },
    }
  }
}
