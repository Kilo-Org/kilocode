import { lstatSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import type { Resource, TrustedContext } from "./types"

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/** Resolve existing ancestors too: new files must not escape through a symlink parent. */
export function canonical(value: string, cwd: string): string {
  if (!value || value.includes("\0")) throw new Error("missing_or_invalid_target")
  const expanded =
    value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value
  const absolute = path.resolve(cwd, expanded)
  const suffix: string[] = []
  let current = absolute
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...suffix)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err
      // A dangling link is not a missing ordinary ancestor.
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("dangling_symlink")
      const parent = path.dirname(current)
      if (parent === current) throw new Error("unresolvable_target")
      suffix.unshift(path.basename(current))
      current = parent
    }
  }
}

export function resource(value: string, ctx: Pick<TrustedContext, "cwd">, kind?: Resource["kind"]): Resource {
  if (kind === "reference") return { raw: value, key: value, kind }
  if (kind === "url" || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return { raw: value, key: new URL(value).href, kind: "url" }
  }
  const key = canonical(value, ctx.cwd)
  const info = statSync(key, { throwIfNoEntry: false })
  const parent = info ?? statSync(path.dirname(key), { throwIfNoEntry: false })
  return {
    raw: value,
    key,
    kind: kind ?? (info?.isDirectory() || value.endsWith("/") ? "directory" : "file"),
    exists: !!info,
    identity: parent ? `${info ? "entry" : "parent"}:${parent.dev}:${parent.ino}` : "missing",
    symlink: key !== path.resolve(ctx.cwd, value),
  }
}

export function covers(scope: Resource, target: string): boolean {
  return scope.key === target || (scope.kind === "directory" && inside(scope.key, target))
}

export function tracked(target: string, ctx: TrustedContext): boolean {
  if (!inside(canonical(ctx.workspace_root, ctx.cwd), target)) return false
  const result = spawnSync("git", ["--no-optional-locks", "ls-files", "--error-unmatch", "--", target], {
    cwd: ctx.workspace_root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 2000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull },
  })
  return result.status === 0
}

export function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex")
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    )
  }
  return value
}
