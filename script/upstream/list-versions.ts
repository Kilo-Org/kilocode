#!/usr/bin/env bun
/**
 * List upstream v2 releases and show which ones a Kilo branch already has.
 *
 * Usage:
 *   bun script/upstream/list-versions.ts [--base <ref>] [--all] [--no-fetch]
 *
 * The default base is origin/v2. Each row shows the tag, the release commit (the parent of the tag,
 * which is the sync target), the release date and the status.
 */

import { defaultConfig } from "./utils/config"
import { fetchUpstream, hasUpstreamRemote } from "./utils/git"
import { header, info, success, warn, error } from "./utils/logger"
import { getSyncStatus } from "./utils/version"

async function main() {
  const args = process.argv.slice(2)
  const config = defaultConfig
  const at = args.indexOf("--base")
  const base = (at === -1 ? undefined : args[at + 1]) ?? `${config.originRemote}/${config.baseBranch}`

  header("Upstream v2 Releases")

  if (!(await hasUpstreamRemote(config.upstreamRemote))) {
    error(`No '${config.upstreamRemote}' remote. Add it:`)
    info(`  git remote add ${config.upstreamRemote} ${config.upstreamUrl}`)
    process.exit(1)
  }
  if (!args.includes("--no-fetch")) {
    info(`Fetching ${config.upstreamRemote}/${config.upstreamBranch} and tags...`)
    await fetchUpstream(config.upstreamRemote, config.upstreamBranch)
  }

  const status = await getSyncStatus(base, config)
  const limit = args.includes("--all") ? status.releases.length : 20
  const merged = new Set(
    status.releases.filter((r) => !status.pending.includes(r)).map((r) => r.tag),
  )

  console.log()
  info(`Base: ${base}. Newest release in base: ${status.merged?.tag ?? "none"}`)
  console.log()
  console.log(`  ${"Tag".padEnd(10)} ${"Release".padEnd(12)} ${"Date".padEnd(26)} Status`)
  for (const r of status.releases.slice(0, limit)) {
    const label = r === status.next ? "next" : status.pending.includes(r) ? "pending" : merged.has(r.tag) ? "in base" : ""
    console.log(`  ${r.tag.padEnd(10)} ${r.commit.slice(0, 11).padEnd(12)} ${r.date.padEnd(26)} ${label}`)
  }
  if (status.releases.length > limit) {
    console.log()
    info(`Showing ${limit} of ${status.releases.length} releases. Use --all to see all.`)
  }

  console.log()
  if (!status.next) {
    success("The base has the newest release.")
    return
  }
  warn(`Lag: ${status.lag.releases} release(s), ${status.lag.days} day(s)`)
  info("Sync release by release. Next:")
  info(`  bun script/upstream/merge.ts --version ${status.next.tag}`)
}

main().catch((err) => {
  error(`Error: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
