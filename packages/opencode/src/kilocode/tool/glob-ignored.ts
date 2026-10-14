import path from "path"
import { Effect } from "effect"
import type { Ripgrep } from "@opencode-ai/core/ripgrep"
import type { Config } from "@/config/config"

/**
 * `experimental.glob_include_ignored` names ignored or hidden folders and files that the glob tool should
 * still search. Entries use gitignore-style patterns relative to the workspace root: a pattern without a
 * slash matches at any depth, and a pattern with a slash is anchored to the root.
 *
 * The normal search never descends into ignored folders. A second ripgrep run adds whitelist globs
 * (`--glob=<dir>/`) that make ripgrep descend into matching ignored folders, and keeps the agent's pattern
 * as an override glob. Override globs bypass ignore rules, so a pattern that also matches folder names can
 * enter other ignored folders, and reaching an entry below an ignored parent exposes the parent's other
 * files; that run therefore keeps only paths that match an entry, before its result limit.
 */

type Entry = { readonly anchored: boolean; readonly parts: readonly string[]; readonly glob: Bun.Glob }

export type Plan = {
  readonly include: readonly string[]
  readonly filter: (file: string) => boolean
}

const wild = (part: string) => part === "**" || /^[*?]+$/.test(part)

/** Normalize one configured entry, dropping negations, parent escapes, and patterns that match everything. */
export function parse(input: string): Entry | undefined {
  const text = input.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  if (!text || text.startsWith("!")) return undefined
  const anchored = text.replace(/\/+$/, "").includes("/")
  const parts = text.split("/").filter(Boolean)
  while (parts.at(-1) === "**") parts.pop()
  if (parts.length === 0 || parts.includes("..") || parts.every(wild)) return undefined
  return { anchored, parts, glob: new Bun.Glob(anchored ? parts.join("/") : parts[0]) }
}

/** Whitelist globs for one entry, relative to a search that runs `base` segments below the workspace root. */
function globs(entry: Entry, base: readonly string[]) {
  if (!entry.anchored) return { dir: `${entry.parts[0]}/`, parents: [] }
  const rest = base.reduce<readonly string[] | undefined>((acc, part) => {
    if (!acc || acc.length === 0 || acc[0] === "**") return acc
    return new Bun.Glob(acc[0]).match(part) ? acc.slice(1) : undefined
  }, entry.parts)
  // The entry is outside this search, or the search already runs inside it.
  if (!rest || rest.length === 0) return undefined
  const lead = rest[0] === "**" ? "" : "/"
  const stop = rest.findIndex(wild)
  const depth = Math.min(stop === -1 ? rest.length : stop, rest.length - 1)
  return {
    dir: `${lead}${rest.join("/")}/`,
    parents: Array.from({ length: depth }, (_, index) => `${lead}${rest.slice(0, index + 1).join("/")}/`),
  }
}

/** Build the extra ripgrep globs for a search rooted at `cwd` inside the workspace `root`. */
export function plan(input: readonly string[], root: string, cwd: string): Plan | undefined {
  const rel = path.relative(root, cwd).replaceAll("\\", "/")
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined
  const base = rel ? rel.split("/") : []
  const entries = input.flatMap((item) => parse(item) ?? [])
  const found = entries.flatMap((entry) => globs(entry, base) ?? [])
  if (found.length === 0) return undefined
  return {
    include: [...new Set(found.flatMap((item) => [item.dir, ...item.parents]))],
    filter: (file) => keep(entries, rel ? `${rel}/${file}` : file),
  }
}

/** True when a workspace-relative file, or one of its parent folders, matches an entry. */
function keep(entries: readonly Entry[], file: string) {
  const parts = file.split("/")
  return entries.some((entry) =>
    parts.some((part, index) => entry.glob.match(entry.anchored ? parts.slice(0, index + 1).join("/") : part)),
  )
}

/** Run a glob search that also covers the ignored paths listed in `experimental.glob_include_ignored`. */
export const search = (ripgrep: Ripgrep.Interface, config: Config.Interface, root: string, input: Ripgrep.GlobInput) =>
  Effect.gen(function* () {
    const cfg = yield* config.get()
    const extra = plan(cfg.experimental?.glob_include_ignored ?? [], root, input.cwd)
    if (!extra) return yield* ripgrep.glob(input)
    const wide = {
      ...input,
      include: [...(input.include ?? []), ...extra.include],
      filter: (file: string) => extra.filter(file) && (input.filter?.(file) ?? true),
    }
    const [plain, all] = yield* Effect.all([ripgrep.glob(input), ripgrep.glob(wide)], { concurrency: 2 })
    const seen = new Set(plain.items.map((item) => item.path))
    const items = [...plain.items, ...all.items.filter((item) => !seen.has(item.path))]
    return {
      items: items.slice(0, input.limit),
      truncated: plain.truncated || all.truncated || items.length > input.limit,
      partial: plain.partial || all.partial,
      invalidPattern: plain.invalidPattern,
    }
  })
