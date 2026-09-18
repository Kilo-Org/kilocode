/**
 * Batched PR resolution for an Agent Manager full sync.
 *
 * Resolves every worktree in one `gh api graphql` request per chunk and hands
 * the results to the poller, which passes them straight into its per-worktree
 * fetch. Anything the batch cannot decide is left out of the result so the
 * poller's legacy per-worktree lookup runs for it unchanged. A failed batch is
 * therefore never worse than the previous behavior.
 */

import { existsSync } from "fs"
import { isTimeout } from "../command-budget"
import type { Worktree } from "../WorktreeStateManager"
import type { PRResult } from "./am-pr-types"
import { CHUNK, own, query, parse, pick, reshape, unknown } from "./am-pr-batch"
import type { BatchItem, BatchResult } from "./am-pr-batch"
import { parsePRResult } from "./am-pr-utils"

/** Everything the seed needs from the poller, as plain callbacks. */
export interface SeedHost {
  branch(wt: Worktree): Promise<string | undefined>
  /** Run a read-only git command and return stdout. Rejects on failure. */
  git(args: string[], cwd: string): Promise<string>
  /** Run a read-only gh command and return stdout. Rejects on failure. */
  gh(args: string[], cwd: string): Promise<string>
  repo(cwd: string): Promise<{ owner: string; name: string }>
  /** Whether rich fields (merge state, auto merge) are still assumed readable. */
  rich(): boolean
  /** Switch the poller to base fields after an unknown-field error. */
  degrade(): void
  /** Whether the poll generation that started this seed has been superseded. */
  stale(): boolean
  /**
   * Whether a worktree must be left out of the batch entirely — quarantined, or reported broken by
   * the health reconcile.
   *
   * The per-worktree path gates on the same answer, so a batch that ignored it would spend a git
   * process per parked worktree on every full sync and, worse, hand one of their directories to the
   * single `gh api graphql` call as its working directory.
   */
  skip(id: string): boolean
  log(...args: unknown[]): void
}

/** Resolved PR (or null for "no PR") per worktree id. Missing ids fall back to the legacy lookup. */
export type Seeds = Map<string, PRResult | null>

interface Item extends BatchItem {
  id: string
  cwd: string
}

export async function seed(targets: Worktree[], host: SeedHost): Promise<Seeds> {
  const seeds: Seeds = new Map()
  const items = await collect(targets, host)
  if (host.stale() || items.length === 0) return seeds
  const repo = await host.repo(items[0]!.cwd).catch((err: unknown) => {
    host.log("Batched PR lookup failed:", message(err))
    return undefined
  })
  if (!repo || host.stale()) return seeds
  for (let start = 0; start < items.length; start += CHUNK) {
    await chunk(items.slice(start, start + CHUNK), repo, host, seeds)
    if (host.stale()) return seeds
  }
  return seeds
}

async function collect(targets: Worktree[], host: SeedHost): Promise<Item[]> {
  const items: Item[] = []
  for (const wt of targets) {
    // Stop spawning git for the remaining worktrees once the generation is superseded.
    if (host.stale()) break
    const item = await one(wt, host)
    if (item) items.push(item)
  }
  return items
}

/** One worktree's batch item, or undefined when it cannot be resolved. */
async function one(wt: Worktree, host: SeedHost): Promise<Item | undefined> {
  if (host.skip(wt.id)) return undefined
  if (!existsSync(wt.path)) return undefined
  // A rejected branch lookup must not abort the sync for every other worktree.
  const branch = await host.branch(wt).then(
    (value) => value,
    () => undefined,
  )
  if (host.stale() || !branch) return undefined
  const head = await host.git(["rev-parse", "HEAD"], wt.path).then(
    (out) => out.trim() || undefined,
    () => undefined,
  )
  if (host.stale()) return undefined
  return { id: wt.id, branch, head, cwd: wt.path }
}

async function chunk(
  items: Item[],
  repo: { owner: string; name: string },
  host: SeedHost,
  seeds: Seeds,
): Promise<void> {
  const doc = query(items, host.rich())
  if (!doc) return
  const args = ["api", "graphql", "-f", `query=${doc}`, "-F", `owner=${repo.owner}`, "-F", `repo=${repo.name}`]
  try {
    const out = await host.gh(args, items[0]!.cwd)
    if (host.stale()) return
    const parsed = parse(out, items)
    cost(out, host)
    for (let i = 0; i < items.length; i++) {
      await resolve(items[i]!, parsed[i], host, seeds)
      if (host.stale()) return
    }
  } catch (err) {
    const msg = message(err)
    // A hung request is not an unsupported field, and asking again would spend a second full budget
    // on a command that already proved it does not answer. Named as a timeout so the log says which
    // failure this was — the per-worktree fallback below is what records it against a worktree.
    if (isTimeout(err)) {
      host.log("Batched PR lookup timed out, falling back to per-worktree lookups:", msg)
      return
    }
    if (host.rich() && unknown(msg)) {
      host.degrade()
      await chunk(items, repo, host, seeds)
      return
    }
    host.log("Batched PR lookup failed:", msg)
  }
}

async function resolve(item: Item, result: BatchResult | undefined, host: SeedHost, seeds: Seeds): Promise<void> {
  if (!result || "error" in result) return
  // Like gh, a default-branch worktree must not show its latest merged PR.
  const node = pick(result.nodes, item.head, item.branch !== result.home)
  if (node) {
    seeds.set(item.id, parsePRResult(JSON.stringify(reshape(node))))
    return
  }
  // Ambiguous candidates stay unresolved so the legacy per-worktree path decides.
  if (own(result.nodes, item.head).length > 0) return
  // A tracking ref such as refs/pull/N/head is only resolvable by `gh pr view`.
  const merge = await host.git(["config", `branch.${item.branch}.merge`], item.cwd).catch(() => "")
  if (merge.trim().startsWith("refs/pull/")) return
  seeds.set(item.id, null)
}

function cost(out: string, host: SeedHost): void {
  const value = (JSON.parse(out) as { data?: { rateLimit?: { cost?: number } } }).data?.rateLimit?.cost
  if (value !== undefined) host.log(`Batched PR lookup cost: ${value}`)
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
