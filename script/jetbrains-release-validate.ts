#!/usr/bin/env bun
// kilocode_change - new file

import { $ } from "bun"
import { appendFileSync } from "node:fs"
import semver from "semver"
import { parseArgs } from "util"

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "Kilo-Org/kilocode"
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    pr: { type: "string" },
    dry: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`
Usage: bun script/jetbrains-release-validate.ts --pr <number> [--dry]

Validates a merged JetBrains release PR and the pre-created immutable release tag.
This helper never creates, moves, deletes, or pushes tags.
`)
  process.exit(0)
}

const pr = values.pr ?? process.env.PR_NUMBER
if (!pr) throw new Error("--pr is required")

type Pull = {
  body: string
  headRefName: string
  isCrossRepository: boolean
  labels: { name: string }[]
  mergedAt: string | null
  mergeCommit: { oid: string } | null
  state: string
}

const data: Pull =
  await $`gh pr view ${pr} --repo ${repo} --json body,headRefName,isCrossRepository,labels,mergedAt,mergeCommit,state`.json()
const labels = new Set(data.labels.map((item) => item.name))
if (!labels.has("jetbrains-release")) throw new Error("PR is missing jetbrains-release label")
if (data.isCrossRepository) throw new Error("JetBrains release PR must come from this repository")
if (data.state !== "MERGED" || !data.mergedAt) throw new Error("JetBrains release PR must be merged")
if (!data.mergeCommit?.oid) throw new Error("PR has no merge commit")

const ver = need(data.body, "JetBrains-Version")
const kind = need(data.body, "JetBrains-Kind")
const tag = need(data.body, "JetBrains-Tag")
const commit = need(data.body, "JetBrains-Commit")

if (!semver.valid(ver)) throw new Error(`Invalid JetBrains version: ${ver}`)
if (kind !== "rc" && kind !== "stable") throw new Error(`Invalid JetBrains kind: ${kind}`)
if (kind === "rc" && !/^\d+\.\d+\.\d+-rc\.\d+$/.test(ver)) throw new Error("RC versions must match x.y.z-rc.n")
if (kind === "stable" && !/^\d+\.\d+\.\d+$/.test(ver)) throw new Error("Stable versions must match x.y.z")
if (data.headRefName !== `jetbrains/release/v${ver}`) {
  throw new Error(`PR head branch ${data.headRefName} does not match version ${ver}`)
}
if (tag !== `jetbrains/v${ver}`) throw new Error(`Tag ${tag} does not match version ${ver}`)
if (!/^jetbrains\/v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(tag)) throw new Error(`Invalid JetBrains tag: ${tag}`)
if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Invalid JetBrains commit: ${commit}`)

await $`git fetch origin --tags`
const existing = await $`git rev-parse -q --verify ${`refs/tags/${tag}`}`.nothrow()
if (existing.exitCode !== 0) throw new Error(`${tag} does not exist`)

const sha = (await $`git rev-list -n 1 ${tag}`.text()).trim()
if (sha !== commit) throw new Error(`${tag} points at ${sha}, expected ${commit}`)

const prop = await props()
if (prop !== ver)
  throw new Error(`packages/kilo-jetbrains/gradle.properties kilo.jetbrains.version is ${prop}, expected ${ver}`)
if (!(await pinned())) {
  throw new Error("packages/kilo-jetbrains/gradle.properties has kilo.cli.pinned=false; JetBrains releases require kilo.cli.pinned=true")
}

const changelog = await Bun.file("packages/kilo-jetbrains/CHANGELOG.md").text()
if (!changelog.includes(`## [${ver}]`)) throw new Error(`CHANGELOG.md is missing section for ${ver}`)

const marketplace = kind === "rc" ? "eap" : "default"
const cli = kind === "rc" ? "rc" : "latest"
const output = {
  version: ver,
  kind,
  tag,
  commit,
  merge: data.mergeCommit.oid,
  marketplace_channel: marketplace,
  cli_channel: cli,
}

for (const [key, value] of Object.entries(output)) console.log(`${key}=${value}`)
if (process.env.GITHUB_OUTPUT && !values.dry) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(output)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  )
}

function marker(body: string, key: string) {
  const line = body.split(/\r?\n/).find((item) => item.startsWith(`${key}:`))
  return line?.slice(key.length + 1).trim()
}

function need(body: string, key: string) {
  const value = marker(body, key)
  if (!value) throw new Error(`PR body is missing ${key}`)
  return value
}

async function props() {
  const text = await Bun.file("packages/kilo-jetbrains/gradle.properties").text()
  const line = text.split(/\r?\n/).find((item) => item.startsWith("kilo.jetbrains.version="))
  const value = line?.split("=", 2)[1]?.trim()
  if (!value) throw new Error("packages/kilo-jetbrains/gradle.properties is missing kilo.jetbrains.version")
  return value
}

async function pinned() {
  const text = await Bun.file("packages/kilo-jetbrains/gradle.properties").text()
  const value = text.split(/\r?\n/).flatMap((line) => {
    const [key, raw] = line.split("=", 2)
    if (key.trim() !== "kilo.cli.pinned") return []
    return [raw?.trim().toLowerCase()]
  })[0]
  return value == null || value === "true"
}
