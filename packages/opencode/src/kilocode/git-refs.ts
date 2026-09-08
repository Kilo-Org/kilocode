// kilocode_change - new file
import { Effect } from "effect"
import { Git } from "@/git"

type DiffRefsOptions = {
  readonly context?: number
  readonly maxOutputBytes?: number
}

const kind = (code: string): Git.Kind => {
  if (code === "??") return "added"
  if (code.includes("U")) return "modified"
  if (code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  return "modified"
}

const nuls = (text: string) => text.split("\0").filter(Boolean)

export const diffRefs = Effect.fn("KiloGit.diffRefs")(function* (
  git: Git.Interface,
  cwd: string,
  from: string,
  to: string,
) {
  const result = yield* git.run(
    ["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", `${from}..${to}`, "--", "."],
    { cwd },
  )
  if (result.exitCode !== 0) return []
  const list = nuls(result.text())
  return list.flatMap((code, idx) => {
    if (idx % 2 !== 0) return []
    const file = list[idx + 1]
    if (!code || !file) return []
    return [{ file, code, status: kind(code) } satisfies Git.Item]
  })
})

export const statsRefs = Effect.fn("KiloGit.statsRefs")(function* (
  git: Git.Interface,
  cwd: string,
  from: string,
  to: string,
) {
  const result = yield* git.run(
    ["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", `${from}..${to}`, "--", "."],
    { cwd },
  )
  if (result.exitCode !== 0) return []
  return nuls(result.text()).flatMap((item) => {
    const a = item.indexOf("\t")
    const b = item.indexOf("\t", a + 1)
    if (a === -1 || b === -1) return []
    const file = item.slice(b + 1)
    if (!file) return []
    const adds = item.slice(0, a)
    const dels = item.slice(a + 1, b)
    const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10)
    const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10)
    return [
      {
        file,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      } satisfies Git.Stat,
    ]
  })
})

export const patchAllRefs = Effect.fn("KiloGit.patchAllRefs")(function* (
  git: Git.Interface,
  cwd: string,
  from: string,
  to: string,
  options?: DiffRefsOptions,
) {
  const result = yield* git.run(
    [
      "diff",
      "--patch",
      "--no-ext-diff",
      "--no-renames",
      `--unified=${options?.context ?? 3}`,
      `${from}..${to}`,
      "--",
      ".",
    ],
    { cwd, maxOutputBytes: options?.maxOutputBytes },
  )
  return { text: result.text(), truncated: result.truncated } satisfies Git.Patch
})
