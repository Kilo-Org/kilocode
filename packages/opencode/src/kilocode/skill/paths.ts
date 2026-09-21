import path from "path"
import { Effect } from "effect"

// `skills.paths` entries like "/.github/skills" are almost always meant as "relative to the
// project root", but `path.isAbsolute` reads them as the filesystem root (or the current drive
// root on Windows), so discovery silently finds nothing. Keep the upstream absolute-first
// semantics, and only when that directory does not exist, fall back to the project-relative
// reading. Drive-qualified ("C:\...") and UNC ("\\server\...") paths never fall back.
export function rooted(value: string): boolean {
  return /^[\\/](?![\\/])/.test(value)
}

export const resolve = Effect.fn("KilocodeSkillPaths.resolve")(function* (
  expanded: string,
  directory: string,
  isDir: (dir: string) => Effect.Effect<boolean>,
) {
  const dir = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded)
  if (!rooted(expanded)) return dir
  if (yield* isDir(dir)) return dir
  const alt = path.join(directory, expanded)
  if (!(yield* isDir(alt))) return dir
  yield* Effect.logInfo("skill path resolved relative to the project", { path: expanded, dir: alt })
  return alt
})
