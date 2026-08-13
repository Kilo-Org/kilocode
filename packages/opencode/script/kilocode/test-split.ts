// kilocode_change - new file
//
// Splits a handful of very heavy test files into several `bun test -t` slices so
// the shard splitter can place them independently.
//
// Sharding can only ever be as fast as its heaviest indivisible unit. On Windows
// `test/cli/run/run-process.test.ts` is 253s of test time on its own, so any
// shard holding it costs at least that long no matter how many shards exist --
// at 10 shards the rest of the suite balances to ~206s per shard and that one
// file is the whole tail. Splitting it three ways drops the floor to ~96s.
//
// The mechanism is bun's `-t` (`--test-name-pattern`), which matches a regex
// against the composed test name (describe titles joined with the test title).
// Each entry below lists `total - 1` patterns; the parts are then built so they
// are provably a partition of the name space, whatever tests exist:
//
//   part i (i < total)  ^(?!.*(?:P1|...|Pi-1))(?=.*(?:Pi))
//   part total          ^(?!.*(?:P1|...|Ptotal-1))
//
// Every part excludes all earlier patterns, so no test can run twice; the last
// part matches everything the others reject, so no test can be missed. A test
// renamed or added therefore still runs -- it lands in the last part -- and the
// only way to break coverage is for a pattern to match nothing at all, which
// bun exits nonzero for ("regex ... matched 0 tests"). Stale patterns fail the
// job loudly instead of quietly skipping tests.
//
// `weights` are the per-part totals of measured per-test Windows durations
// (max across the shards of runs 31657477161 and 31703950716). They exist to
// tell the sharder how heavy each part is relative to its siblings; the file's
// absolute weight still comes from history. Refresh them when a split file
// changes materially -- a stale share costs balance, never correctness.
//
// Keep this list short. Every entry buys one less indivisible unit and costs one
// more process launch (~4s on Windows), so it only pays for files whose runtime
// is far above the shard average.

export namespace TestSplit {
  type Entry = {
    /** `total - 1` regex sources; the final part is their complement. */
    patterns: string[]
    /** Measured seconds per part, in part order. Balance only, not correctness. */
    weights: number[]
  }

  const SPLITS: Record<string, Entry> = {
    // 19 tests, 253s. `--format json` covers the six JSON-output cases; the
    // second part takes the two permission cases and the two ordering cases
    // that are not JSON, both of which are among the file's slowest.
    "cli/run/run-process.test.ts": {
      patterns: ["--format json", "permission|prints "],
      weights: [77.0, 83.7, 95.5],
    },
    // 56 tests, 133-158s, all of them 2-4s: nothing dominates, so the halves
    // are chosen purely for even weight.
    "snapshot/snapshot.test.ts": {
      patterns: ["diffFull|revert|gitignore"],
      weights: [75.6, 78.1],
    },
    // 75 tests, 198s, and the heaviest file on Linux once run-process is split.
    // The shell and loop cases are half the weight between them, which happens
    // to halve the file almost exactly.
    "session/prompt.test.ts": {
      patterns: ["shell|loop"],
      weights: [98.8, 99.2],
    },
  }

  export type Part = {
    /** Shard-item key: unique per part, and never a real test file path. */
    key: string
    file: string
    /** 1-based. */
    index: number
    total: number
    /** Value for `bun test -t`. */
    filter: string
    /** Fraction of the file's weight this part carries; the parts sum to 1. */
    share: number
    /** Progress-line and failure-report name. */
    label: string
  }

  const cache = new Map<string, Part[]>()

  export function parts(file: string): Part[] | undefined {
    const entry = SPLITS[file]
    if (!entry) return undefined
    const cached = cache.get(file)
    if (cached) return cached

    const total = entry.patterns.length + 1
    const sum = entry.weights.reduce((a, b) => a + b, 0)
    const built = Array.from({ length: total }, (_, i) => {
      const earlier = entry.patterns.slice(0, i)
      const own = entry.patterns[i]
      const exclude = earlier.length > 0 ? `^(?!.*(?:${earlier.join("|")}))` : ""
      return {
        key: `${file}#${i + 1}of${total}`,
        file,
        index: i + 1,
        total,
        filter: own === undefined ? exclude : `${exclude}(?=.*(?:${own}))`,
        share: sum > 0 ? (entry.weights[i] ?? 0) / sum : 1 / total,
        label: `${file} (part ${i + 1}/${total})`,
      }
    })
    cache.set(file, built)
    return built
  }

  /** Replace each split file in `files` with its parts, preserving order. */
  export function expand(files: readonly string[]): string[] {
    return files.flatMap((file) => parts(file)?.map((part) => part.key) ?? [file])
  }

  /** The `Part` a key from `expand` refers to, or undefined for a plain file. */
  export function lookup(key: string): Part | undefined {
    const hash = key.lastIndexOf("#")
    if (hash < 0) return undefined
    return parts(key.slice(0, hash))?.find((part) => part.key === key)
  }

  /** The file a key from `expand` belongs to, split or not. */
  export function fileOf(key: string): string {
    return lookup(key)?.file ?? key
  }

  /** Split entries that no longer name an existing test file. */
  export function stale(all: readonly string[]): string[] {
    const known = new Set(all)
    return Object.keys(SPLITS).filter((file) => !known.has(file))
  }
}
