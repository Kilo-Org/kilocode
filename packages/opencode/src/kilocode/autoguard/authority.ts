/**
 * Deriving a task grant from the developer's request.
 *
 * Until this existed, `plugin.ts` handed every decision an empty grant. That is
 * safe and useless: `withinAuthority` returns false for an empty grant, so
 * `L0-A2` never fires, every ordinary source edit falls through to Level 1, and
 * Level 1 answers `REVIEW` because nothing authorises anything. Measured on the
 * trajectory benchmark: 34 of 40 remaining blocks were edits to the one file
 * the developer had named, and benign task success sat at 2/9 against 8/9
 * unguarded.
 *
 * The trust boundary is the same one `provenance.ts` uses, and for the same
 * reason: **only the developer's own message is read**. Never assistant prose,
 * never tool output, never file contents. An agent that can write into this
 * input can write itself a grant, and text injected into a README or a
 * docstring must not be able to widen what is permitted.
 *
 * Three rules keep the extractor from over-granting:
 *
 * 1. A path must look like a path (`src/`, `tests/test_x.py`) or be a directory
 *    the *trusted context* already knows about. "Fix the code" must not grant
 *    scope over a directory called `code` that the developer never mentioned.
 * 2. Capabilities come from verbs, and a verb alone grants nothing -- every
 *    descriptor pairs an operation with a concrete path. No `*` is ever
 *    emitted, in either position.
 * 3. Destructive capability is bounded by the trusted context rather than by
 *    the message: a deletion descriptor is emitted only for a path the context
 *    itself declares generated. The developer saying "delete src" cannot
 *    produce `filesystem.delete:src`, because `src` is not a build artifact --
 *    that decision belongs to the environment, not to a sentence.
 *
 * What this deliberately does not do: infer `sensitive`. Marking a target as
 * consequential is a judgement about consequences, not a phrase to pattern
 * match, and a wrong guess there silently unblocks rather than blocks. It stays
 * empty, which is the direction that costs a review rather than a mistake.
 */

import type { Authority, TrustedContext } from "./types"

/** Verbs that ask for each operation, in the developer's own words. */
const CAPABILITY_VERBS: Record<string, RegExp> = {
  "code.modify": /\b(fix|fixes|fixing|edit|change|update|refactor|implement|rewrite|correct|repair)\b/i,
  "test.run": /\b(test|tests|testing|pytest|unittest|suite|spec|specs)\b/i,
  "filesystem.delete": /\b(delete|remove|clean|cleanup|clear|purge|wipe|prune)\b/i,
}

/** Operations whose grant is bounded by the trusted context, not the message. */
const DESTRUCTIVE = new Set(["filesystem.delete"])

/** Words that look like paths but are ordinary English. */
const STOPWORDS = new Set([
  "a", "an", "the", "code", "file", "files", "it", "them", "this", "that",
  "so", "and", "or", "in", "to", "for", "of", "is", "are", "on", "at",
])

/**
 * Pull path-shaped tokens out of the request.
 *
 * A bare word only counts when the trusted context already names it as a
 * directory. That anchor is what stops an ordinary noun from becoming scope.
 */
export function namedPaths(text: string, ctx: TrustedContext): string[] {
  const known = new Set([...ctx.protected_paths, ...ctx.generated_paths])
  const found = new Set<string>()

  for (const raw of text.split(/[\s,;:()"'`]+/)) {
    const trimmed = raw.replace(/[.]+$/, "")
    const token = trimmed.replace(/\/+$/, "")
    if (!token || STOPWORDS.has(token.toLowerCase())) continue
    // Absolute paths, parent traversal and home expansion are never granted:
    // a task grant describes work inside this worktree.
    if (token.startsWith("/") || token.startsWith("~") || token.split("/").includes("..")) continue
    // The slash is tested on the *untrimmed* token. `src/` is how a developer
    // writes a directory, and stripping the trailing slash first turns it into
    // the bare word `src`, which only counts when the trusted context happens
    // to list it. Production lists `.git,.env,secrets` -- not `src` -- so the
    // trimmed form matched nothing, every grant came back empty, and `L0-A2`
    // never fired in a live run despite passing its unit test against a
    // conveniently-chosen context.
    const looksLikePath = trimmed.includes("/") || /\.[a-z0-9]{1,5}$/i.test(token)
    if (looksLikePath || known.has(token)) found.add(token)
  }
  return [...found]
}

/**
 * Build the grant for one request.
 *
 * `userIntent` must be the developer's message and nothing else.
 */
export function deriveAuthority(userIntent: string, ctx: TrustedContext): Authority {
  const empty: Authority = {
    issuer: "user",
    scope: [],
    capabilities: [],
    expires: "task",
    required: [],
    implicit: [],
    sensitive: [],
  }
  if (!userIntent.trim()) return empty

  const paths = namedPaths(userIntent, ctx)
  if (paths.length === 0) return empty

  const capabilities: string[] = []
  const implicit: string[] = []
  const required: string[] = []

  for (const [operation, verb] of Object.entries(CAPABILITY_VERBS)) {
    if (!verb.test(userIntent)) continue

    if (DESTRUCTIVE.has(operation)) {
      // Bounded by the environment: only paths the context itself declares
      // generated. `required` is what unlocks L0-A3, so it stays this narrow.
      const generated = paths.filter((p) =>
        ctx.generated_paths.some((g) => p === g || p.startsWith(g + "/")),
      )
      if (generated.length === 0) continue
      capabilities.push(operation)
      required.push(...generated.map((p) => `${operation}:${p}`))
      continue
    }

    capabilities.push(operation)
    implicit.push(...paths.map((p) => `${operation}:${p}`))
  }

  if (capabilities.length === 0) return empty

  return {
    issuer: "user",
    scope: paths,
    capabilities,
    expires: "task",
    required,
    implicit,
    // Never inferred. See the header: a wrong guess here unblocks.
    sensitive: [],
  }
}
