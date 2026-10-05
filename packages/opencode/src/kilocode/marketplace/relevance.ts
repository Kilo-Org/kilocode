import { Cause, Duration, Effect } from "effect"
import { minimatch } from "minimatch"
import type { Ripgrep } from "@opencode-ai/core/ripgrep"
import { allowed } from "@opencode-ai/core/kilocode/fff"
import type { MarketplaceItem } from "./schema"

// Each search stops at the first match, so a found pattern costs only a short walk.
const LIMIT = 1
// Bounds a scan on very large trees. Patterns found before the budget runs out are kept.
const BUDGET = Duration.seconds(30)
// The previous VS Code scan always skipped these directories. Keep that guarantee even
// when the workspace is not a git repository and has no .gitignore.
const EXCLUDE = "**/{node_modules,dist,build,out,.kilo,.opencode,.kilocode}/**"

/** Unique `suggest_for.filename` patterns of the given items. */
export function patterns(items: readonly MarketplaceItem[]): string[] {
  return Array.from(new Set(items.flatMap((item) => item.suggest_for?.filename ?? [])))
}

function matches(file: string, pattern: string) {
  return minimatch(file, `**/${pattern}`, { dot: true })
}

/**
 * Patterns with brace or comma syntax cannot share one alternation glob, so they
 * search alone. One bad pattern then cannot break the others.
 */
function groups(list: readonly string[]) {
  const special = list.filter((pattern) => /[{},]/.test(pattern))
  const plain = list.filter((pattern) => !special.includes(pattern))
  return [plain, ...special.map((pattern) => [pattern])].filter((group) => group.length > 0)
}

/**
 * Returns the `suggest_for.filename` patterns that match at least one file in
 * `directory`. Ripgrep honors .gitignore and other ignore files, so ignored
 * build output, virtual environments, and data folders are never walked.
 */
export const detect = Effect.fn("MarketplaceRelevance.detect")(function* (input: {
  ripgrep: Ripgrep.Interface
  directory: string
  items: readonly MarketplaceItem[]
}) {
  const list = patterns(input.items)
  // Home and filesystem roots are not projects; scanning them would walk the whole disk.
  if (list.length === 0 || !allowed(input.directory)) return []
  const found = new Set<string>()

  const search = (pattern: string) =>
    input.ripgrep.glob({
      cwd: input.directory,
      pattern: `**/${pattern}`,
      limit: LIMIT,
      hidden: true,
      noRequireGit: true,
      exclude: [EXCLUDE],
    })

  const scan = (group: readonly string[]): Effect.Effect<void, Ripgrep.Error> =>
    Effect.gen(function* () {
      const left = group.filter((pattern) => !found.has(pattern))
      if (left.length === 0) return
      const globs = left.map((pattern) => `**/${pattern}`)
      const result = yield* input.ripgrep.glob({
        cwd: input.directory,
        pattern: globs.length === 1 ? globs[0] : `{${globs.join(",")}}`,
        limit: LIMIT,
        hidden: true,
        noRequireGit: true,
        exclude: [EXCLUDE],
      })
      const hits = left.filter((pattern) => result.items.some((item) => matches(item.path, pattern)))
      for (const hit of hits) found.add(hit)
      // A malformed pattern makes ripgrep reject the whole alternation, so search the
      // still-missing patterns alone. A transient error sets partial without
      // invalidPattern, and must not trigger a fresh walk per pattern.
      if (result.invalidPattern && left.length > 1) {
        for (const pattern of left.filter((item) => !found.has(item))) {
          const single = yield* search(pattern)
          if (single.items.some((item) => matches(item.path, pattern))) found.add(pattern)
        }
        return
      }
      // A truncated search stopped early, so the remaining patterns are still unknown.
      if (result.truncated && hits.length > 0) yield* scan(group)
    })

  yield* Effect.forEach(
    groups(list),
    (group) =>
      scan(group).pipe(Effect.catch((err) => Effect.logWarning("marketplace relevance search failed", { err }))),
    {
      discard: true,
    },
  ).pipe(
    // A scan failure must never break the marketplace response; return no matches instead.
    Effect.catchCause((cause) =>
      Effect.logWarning("marketplace relevance scan failed", { cause: Cause.pretty(cause) }),
    ),
    Effect.timeoutOption(BUDGET),
  )
  return [...found]
})
