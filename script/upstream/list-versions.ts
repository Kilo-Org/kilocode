#!/usr/bin/env bun
/**
 * List available upstream versions
 *
 * Usage:
 *   bun run script/upstream/list-versions.ts
 */

import { getAvailableUpstreamVersions, getCurrentKiloVersion } from "./utils/version"
import { fetchUpstream, hasUpstreamRemote, isAncestor } from "./utils/git"
import { header, info, success, warn, error } from "./utils/logger"

async function main() {
  header("Available Upstream Versions")

  // Check upstream remote
  if (!(await hasUpstreamRemote())) {
    error("No 'upstream' remote found. Please add it:")
    info("  git remote add upstream git@github.com:anomalyco/opencode.git")
    process.exit(1)
  }

  info("Fetching upstream tags...")
  await fetchUpstream()

  const versions = await getAvailableUpstreamVersions()
  const kiloVersion = await getCurrentKiloVersion()

  console.log()
  success(`Current Kilo version: ${kiloVersion}`)
  console.log()

  info("Available upstream versions (newest first):")
  console.log()

  const limit = process.argv.includes("--all") ? versions.length : 20
  const shown = versions.slice(0, Math.min(limit, versions.length))

  // Check merge status in parallel — fast because is-ancestor short-circuits.
  const merged = await Promise.all(shown.map((v) => isAncestor(v.commit, "HEAD")))

  for (let i = 0; i < shown.length; i++) {
    const v = shown[i]
    if (!v) continue
    const marker = merged[i] ? " ✓ merged" : i === 0 ? " (latest)" : ""
    console.log(`  ${v.tag.padEnd(12)} ${v.commit.slice(0, 8)}${marker}`)
  }

  if (versions.length > limit) {
    console.log()
    info(`Showing ${limit} of ${versions.length} versions. Use --all to see all.`)
  }

  console.log()
  info("To merge a specific version:")
  info("  bun run script/upstream/merge.ts --version v1.1.49")
  console.log()
  info("To merge the latest version:")
  info("  bun run script/upstream/merge.ts")
}

main().catch((err) => {
  error(`Error: ${err}`)
  process.exit(1)
})
