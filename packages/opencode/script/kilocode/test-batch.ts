// kilocode_change - new file
//
// Groups isolation-safe test files so they share one `bun test` process.
//
// The runner spawns a process per test file to stop cross-file contamination
// (see test-runner.ts). That isolation is what makes the suite trustworthy, but
// the process itself is not free: a `bun test` run over a trivial file costs
// ~1.0s on macOS and ~2-3x that on Windows, before any test body executes. At
// 660 files the spawns, not the assertions, are the bulk of the bill.
//
// Batching is opt-in per file and fails safe in two independent ways:
//
//  1. A file is isolated unless it appears in `test-batch.json`. New test files
//     therefore keep full isolation until someone deliberately adds them, so
//     the risky direction requires an explicit, reviewable edit.
//  2. If a batched group fails, the runner re-runs that group's files one per
//     process and reports those results instead (see `Plan.groups`). A file
//     that contaminates its neighbours can only cost time, never turn a passing
//     suite red or a failing suite green.
//
// Groups are balanced by the same weight function the shard splitter uses, and
// there are several of them rather than one, so a batch never becomes the
// makespan floor the way a single 169s process would.

import { TestShard } from "./test-shard"

export namespace TestBatch {
  export type Plan = {
    /** Batched groups; every file in a group shares one process. */
    groups: string[][]
    /** Files that get a process to themselves, as before. */
    isolated: string[]
    /**
     * Allowlist entries that no longer exist anywhere in the suite, for drift
     * warnings. Measured against `universe`, not `files`: a shard or a pattern
     * filter legitimately runs a fraction of the allowlist, and warning about
     * that on every sharded CI run would bury real drift in noise.
     */
    stale: string[]
  }

  /** Files per group aimed for. See `plan` for why it is not one group per lane. */
  export const TARGET = 16

  /**
   * Partition `files` into batched groups plus isolated files.
   *
   * Group *count* matters more than it looks. One group per lane sounds right --
   * every worker gets one, no spawn is wasted -- but a group is a fixed
   * partition decided before anything runs, while isolated files are handed out
   * dynamically as workers free up. Coarse fixed partitions lose to dynamic
   * scheduling exactly when the weights are wrong, and locally the weight is
   * file size, which the epic already documents as a poor proxy for duration
   * (measured: one group per lane over 14 acp files put the two slowest in one
   * group and took 26.4s against 16.1s unbatched). So aim for `TARGET` files per
   * group and never fewer groups than lanes: at ~16 files a group still removes
   * 15 of every 16 spawns, and the extra groups give the scheduler something to
   * balance with.
   *
   * Small selections skip batching altogether. Under `4 * concurrency` eligible
   * files the absolute saving is a few seconds while the straggler risk is at
   * its worst, so a filtered local run like `test-runner.ts acp/` keeps the
   * behaviour it had before.
   */
  export function plan(
    files: readonly string[],
    allow: ReadonlySet<string>,
    concurrency: number,
    weight: (file: string) => number,
    universe: readonly string[] = files,
  ): Plan {
    const eligible = files.filter((file) => allow.has(file))
    const present = new Set(universe)
    const stale = [...allow].filter((file) => !present.has(file)).sort()
    const lanes = Math.max(1, concurrency)

    if (eligible.length < 4 * lanes) return { groups: [], isolated: files.slice(), stale }

    const count = Math.min(eligible.length, Math.max(lanes, Math.ceil(eligible.length / TARGET)))
    const split = TestShard.split(eligible, weight, count)
    // A group of one is an isolated file with a confusing name, and it would
    // send the fallback path down a pointless re-run on failure.
    const groups = split.filter((group) => group.length > 1)
    const batched = new Set(groups.flat())
    // Everything else keeps its own process: files that are not allowlisted,
    // plus any single-file group the split happened to produce.
    return { groups, isolated: files.filter((file) => !batched.has(file)), stale }
  }

  /** Parse the checked-in allowlist. Accepts the JSON module's shape only. */
  export function allowlist(input: unknown): ReadonlySet<string> {
    if (!Array.isArray(input)) throw new Error("test batch allowlist must be an array of test file paths")
    const files = new Set<string>()
    for (const entry of input) {
      if (typeof entry !== "string" || entry.trim() === "") {
        throw new Error(`test batch allowlist has a non-string entry: ${JSON.stringify(entry)}`)
      }
      const file = entry.replaceAll("\\", "/")
      if (files.has(file)) throw new Error(`test batch allowlist lists ${file} twice`)
      files.add(file)
    }
    return files
  }
}
