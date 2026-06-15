#!/usr/bin/env bun

import { $ } from "bun"
import semver from "semver"
import { parseArgs } from "util"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    spec: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(
    `Usage: bun .kilo/skills/release-jetbrains/script/resolve-version.ts --spec <next rc|next stable|version>`,
  )
  process.exit(0)
}

const spec = values.spec?.trim().toLowerCase()
if (!spec) throw new Error("--spec is required")

await $`git fetch origin main --tags`.quiet()

const tags = await list()
const hit = explicit(spec) ?? next(spec, tags)
const from = base(hit.version, hit.kind, tags)

console.log(
  JSON.stringify(
    {
      version: hit.version,
      kind: hit.kind,
      fromTagDefault: from,
    },
    null,
    2,
  ),
)

type Kind = "rc" | "stable"
type Tag = { tag: string; version: string }

function explicit(spec: string) {
  if (/^\d+\.\d+\.\d+-rc\.\d+$/.test(spec)) return { version: spec, kind: "rc" as Kind }
  if (/^\d+\.\d+\.\d+$/.test(spec)) return { version: spec, kind: "stable" as Kind }
  return undefined
}

function next(spec: string, tags: Tag[]) {
  const latest = [...tags].sort((a, b) => semver.rcompare(a.version, b.version))[0]
  if (!latest) throw new Error("No JetBrains release tags found; pass an explicit version")
  const parsed = semver.parse(latest.version)
  if (!parsed) throw new Error(`Invalid latest JetBrains tag: ${latest.tag}`)

  if (spec === "next rc") return rc(parsed)
  if (spec === "next stable") return stable(parsed)
  throw new Error("--spec must be 'next rc', 'next stable', x.y.z-rc.n, or x.y.z")
}

function rc(ver: semver.SemVer) {
  const pre = ver.prerelease
  if (pre[0] === "rc" && typeof pre[1] === "number") {
    return { version: `${ver.major}.${ver.minor}.${ver.patch}-rc.${pre[1] + 1}`, kind: "rc" as Kind }
  }
  return { version: `${ver.major}.${ver.minor}.${ver.patch + 1}-rc.1`, kind: "rc" as Kind }
}

function stable(ver: semver.SemVer) {
  if (ver.prerelease.length) return { version: `${ver.major}.${ver.minor}.${ver.patch}`, kind: "stable" as Kind }
  return { version: `${ver.major}.${ver.minor}.${ver.patch + 1}`, kind: "stable" as Kind }
}

function base(ver: string, kind: Kind, tags: Tag[]) {
  const want = semver.parse(ver)
  if (!want) throw new Error(`Invalid semver: ${ver}`)
  const prior = tags
    .filter((item) => !semver.prerelease(item.version) && semver.lt(item.version, ver))
    .sort((a, b) => semver.rcompare(a.version, b.version))

  if (kind === "stable") {
    const hit = prior[0]
    if (!hit) return null
    return hit.tag
  }

  const prerelease = tags
    .filter((item) => {
      const parsed = semver.parse(item.version)
      if (!parsed) return false
      if (parsed.major !== want.major || parsed.minor !== want.minor || parsed.patch !== want.patch) return false
      return Boolean(semver.prerelease(item.version)) && semver.lt(item.version, ver)
    })
    .sort((a, b) => semver.rcompare(a.version, b.version))

  return (prerelease[0] ?? prior[0])?.tag ?? null
}

async function list() {
  const text = await $`git tag --list ${"jetbrains/v*"}`.text()
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((tag) => ({ tag, version: tag.replace(/^jetbrains\/v/, "") }))
    .filter((item) => semver.valid(item.version))
}
