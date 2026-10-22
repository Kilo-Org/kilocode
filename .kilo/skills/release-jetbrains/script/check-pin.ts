#!/usr/bin/env bun

import { $ } from "bun"
import semver from "semver"
import { parseArgs } from "util"
import { latest, missing } from "./pin-common"

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "Kilo-Org/kilocode"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`
Usage: bun .kilo/skills/release-jetbrains/script/check-pin.ts

Checks the CLI pin that a JetBrains release would lock. Prepare tags origin/main,
so this reads packages/kilo-jetbrains/package.json from origin/main and compares
it with the latest published Kilo CLI release plus the local worktree pin.

Exit codes:
  0  Pin is release-ready.
  2  Pin drift, repo CLI mode, or missing CLI assets require maintainer review.
`)
  process.exit(0)
}

await $`git fetch origin main --tags`.quiet()

const pinMain = JSON.parse(await $`git show origin/main:packages/kilo-jetbrains/package.json`.text()).version as string
const pinLocal = (await Bun.file("packages/kilo-jetbrains/package.json").json()).version as string
const propsMain = await $`git show origin/main:packages/kilo-jetbrains/gradle.properties`.text()
const propsLocal = await Bun.file("packages/kilo-jetbrains/gradle.properties").text()
const pinnedMain = pinned(propsMain)
const pinnedLocal = pinned(propsLocal)
const latestCli = await latest(repo)
const prevJetbrainsCli = await previous()
const missingAssets = await missing(repo, pinMain)
const assetsOk = missingAssets.length === 0
const drift = (() => {
  if (!pinnedMain) return "repo-mode-on-main"
  if (!pinnedLocal) return "repo-mode-local"
  if (pinLocal !== pinMain) return "worktree-behind-main"
  if (!assetsOk) return "assets-missing"
  if (latestCli && semver.lt(pinMain, latestCli)) return "behind"
  return "up-to-date"
})()

console.log(JSON.stringify({
  pinMain,
  pinLocal,
  latestCli,
  prevJetbrainsCli,
  pinnedMain,
  pinnedLocal,
  assetsOk,
  missingAssets,
  drift,
}, null, 2))

if (drift !== "up-to-date") process.exit(2)

async function previous() {
  const text = await $`git tag --list ${"jetbrains/v*"}`.text()
  const tag = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((tag) => ({ tag, version: tag.replace(/^jetbrains\/v/, "") }))
    .filter((item) => semver.valid(item.version))
    .sort((a, b) => semver.rcompare(a.version, b.version))[0]?.tag
  if (!tag) return null
  const res = await $`git show ${tag}:packages/kilo-jetbrains/package.json`.nothrow().text()
  if (!res.trim()) return null
  return JSON.parse(res).version as string
}

function pinned(text: string) {
  const value = text.split(/\r?\n/).flatMap((line) => {
    const [key, value] = line.split("=", 2)
    if (key.trim() !== "kilo.cli.pinned") return []
    return [value?.trim().toLowerCase()]
  })[0]
  return value == null || value === "true"
}
