#!/usr/bin/env bun
// kilocode_change - new file

import { $ } from "bun"
import semver from "semver"
import { parseArgs } from "util"

const props = new URL("../packages/kilo-jetbrains/gradle.properties", import.meta.url).pathname
const log = new URL("../packages/kilo-jetbrains/CHANGELOG.md", import.meta.url).pathname
const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "Kilo-Org/kilocode"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    kind: { type: "string" },
    version: { type: "string" },
    "from-tag": { type: "string" },
    dry: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`
Usage: bun script/jetbrains-release-pr.ts --kind <rc|stable> --version <version> [--from-tag <tag>] [--dry]

Examples:
  bun script/jetbrains-release-pr.ts --kind rc --version 7.3.13-rc.1
  bun script/jetbrains-release-pr.ts --kind stable --version 7.3.13
`)
  process.exit(0)
}

const kind = values.kind
const ver = values.version
const dry = values.dry ?? false

if (kind !== "rc" && kind !== "stable") throw new Error("--kind must be rc or stable")
if (!ver) throw new Error("--version is required")
if (kind === "rc" && !/^\d+\.\d+\.\d+-rc\.\d+$/.test(ver)) throw new Error("RC versions must match x.y.z-rc.n")
if (kind === "stable" && !/^\d+\.\d+\.\d+$/.test(ver)) throw new Error("Stable versions must match x.y.z")
if (!semver.valid(ver)) throw new Error(`Invalid semver: ${ver}`)

await $`git fetch origin main --tags`
if (!(await pinned())) {
  throw new Error("packages/kilo-jetbrains/gradle.properties has kilo.cli.pinned=false; JetBrains releases require kilo.cli.pinned=true")
}

const tag = `jetbrains/v${ver}`
const branch = `jetbrains/release/v${ver}`
const sha = (await $`git rev-parse origin/main`.text()).trim()
const from = values["from-tag"] ?? (await base(ver, kind))
const state = await lock(tag, sha, dry)
const notes = await release(from, tag, sha)
const entry = section(ver, notes)

console.log(`JetBrains ${kind} release PR`)
console.log(`version: ${ver}`)
console.log(`base: ${from}`)
console.log(`tag: ${tag}`)
console.log(`commit: ${sha}`)
console.log(`branch: ${branch}`)
console.log(`tag state: ${state}`)

if (dry) {
  console.log("\nGenerated changelog entry:\n")
  console.log(entry)
  console.log("\nDry run complete. No tag, branch, commit, push, or PR was created.")
  process.exit(0)
}

await $`git checkout -B ${branch} ${sha}`
await writeprops(ver)
await writelog(ver, entry)
await $`git add packages/kilo-jetbrains/gradle.properties packages/kilo-jetbrains/CHANGELOG.md`

const changed = await $`git diff --cached --quiet`.nothrow()
if (changed.exitCode !== 0) await $`git commit -m ${`release(jetbrains): v${ver}`}`

await $`git push --force-with-lease origin ${branch}`
await label("jetbrains-release", "5319e7", "Required gate for JetBrains release publishing")

const text = body(ver, kind, from, tag, sha, notes)
const view = await $`gh pr view ${branch} --repo ${repo} --json number --jq .number`.nothrow()
if (view.exitCode === 0 && view.stdout.toString().trim()) {
  const num = view.stdout.toString().trim()
  await $`gh pr edit ${num} --repo ${repo} --title ${`release(jetbrains): v${ver}`} --body ${text}`
  await $`gh pr edit ${num} --repo ${repo} --add-label jetbrains-release`
  await $`gh pr edit ${num} --repo ${repo} --add-label release`.nothrow()
  console.log(`Updated PR #${num}`)
  process.exit(0)
}

const create =
  await $`gh pr create --repo ${repo} --base main --head ${branch} --title ${`release(jetbrains): v${ver}`} --body ${text}`.text()
await $`gh pr edit ${branch} --repo ${repo} --add-label jetbrains-release`
await $`gh pr edit ${branch} --repo ${repo} --add-label release`.nothrow()
console.log(create.trim())

async function base(ver: string, kind: "rc" | "stable") {
  const text = await $`git tag --list ${"jetbrains/v*"}`.text()
  const tags = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ tag: item, ver: item.replace(/^jetbrains\/v/, "") }))
    .filter((item) => semver.valid(item.ver))

  const want = semver.parse(ver)!
  const stable = tags
    .filter((item) => !semver.prerelease(item.ver) && semver.lt(item.ver, ver))
    .sort((a, b) => semver.rcompare(a.ver, b.ver))

  if (kind === "stable") {
    const hit = stable[0]
    if (!hit) throw new Error("No previous stable JetBrains tag found; pass --from-tag")
    return hit.tag
  }

  const rc = tags
    .filter((item) => {
      const parsed = semver.parse(item.ver)
      if (!parsed) return false
      if (parsed.major !== want.major || parsed.minor !== want.minor || parsed.patch !== want.patch) return false
      return Boolean(semver.prerelease(item.ver)) && semver.lt(item.ver, ver)
    })
    .sort((a, b) => semver.rcompare(a.ver, b.ver))

  const hit = rc[0] ?? stable[0]
  if (!hit) throw new Error("No previous JetBrains tag found; pass --from-tag")
  return hit.tag
}

async function lock(tag: string, sha: string, dry: boolean) {
  const res = await $`git rev-parse -q --verify ${`refs/tags/${tag}`}`.nothrow()
  if (res.exitCode === 0) {
    const got = (await $`git rev-list -n 1 ${tag}`.text()).trim()
    if (got === sha) return "exists"
    throw new Error(`${tag} already exists at ${got}, expected ${sha}`)
  }
  if (dry) return "would-create"
  await $`git tag ${tag} ${sha}`
  await $`git push origin ${tag}`
  return "created"
}

async function release(from: string, tag: string, sha: string) {
  const res =
    await $`gh api repos/${repo}/releases/generate-notes --method POST -f tag_name=${tag} -f target_commitish=${sha} -f previous_tag_name=${from} --jq .body`
      .quiet()
      .nothrow()
  if (res.exitCode === 0) return res.stdout.toString().trim()

  const base = await $`git rev-parse -q --verify ${from}`.nothrow()
  if (base.exitCode !== 0) throw new Error(`Previous JetBrains tag not found: ${from}`)

  const text = await $`git log --format=%s ${from}..${sha}`.text()
  const lines = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^(chore|ci|test|release)(\(|:)/i.test(item))
  return lines.map((item) => `- ${item}`).join("\n") || "- No notable changes."
}

async function label(name: string, color: string, desc: string) {
  const labels: { name: string }[] = await $`gh label list --repo ${repo} --json name --limit 1000`.json()
  if (labels.some((item) => item.name === name)) return
  await $`gh label create ${name} --repo ${repo} --color ${color} --description ${desc}`
}

function section(ver: string, notes: string) {
  const date = new Date().toISOString().slice(0, 10)
  const groups = entries(notes)
  const lines = [`## [${ver}] - ${date}`, ""]
  for (const title of ["Added", "Fixed", "Changed"] as const) {
    const items = groups.get(title)
    if (!items?.length) continue
    lines.push(`### ${title}`, ...items, "")
  }
  if (lines.length === 2) lines.push("### Changed", "- No notable changes.", "")
  return lines.join("\n")
}

function entries(notes: string) {
  const groups = new Map<string, string[]>([
    ["Added", []],
    ["Fixed", []],
    ["Changed", []],
  ])
  for (const line of notes
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("- ") || item.startsWith("* "))
    .map((item) => item.slice(2).trim())) {
    if (line.startsWith("@") && line.includes(" made their first contribution ")) continue
    const text = `- ${line}`
    if (/^(feat|add)(\(.+\))?:/i.test(line)) {
      groups.get("Added")!.push(text)
      continue
    }
    if (/^(fix|bug)(\(.+\))?:/i.test(line)) {
      groups.get("Fixed")!.push(text)
      continue
    }
    groups.get("Changed")!.push(text)
  }
  return groups
}

async function writeprops(ver: string) {
  const current = await Bun.file(props).text()
  const line = `kilo.jetbrains.version=${ver}`
  const next = current.match(/^kilo\.jetbrains\.version=/m)
    ? current.replace(/^kilo\.jetbrains\.version=.*$/m, line)
    : `${current.trim()}\n${line}\n`
  await Bun.write(props, next.endsWith("\n") ? next : `${next}\n`)
}

async function pinned() {
  const text = await Bun.file(props).text()
  const value = text.split(/\r?\n/).flatMap((line) => {
    const [key, raw] = line.split("=", 2)
    if (key.trim() !== "kilo.cli.pinned") return []
    return [raw?.trim().toLowerCase()]
  })[0]
  return value == null || value === "true"
}

async function writelog(ver: string, entry: string) {
  const current = await Bun.file(log)
    .text()
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return "# Changelog\n\n## [Unreleased]\n"
      throw err
    })
  const clean = current.replace(regex(ver), "").replace(/\n{3,}/g, "\n\n")
  const marker = "## [Unreleased]"
  if (!clean.includes(marker)) throw new Error("CHANGELOG.md must contain ## [Unreleased]")
  const next = clean.replace(marker, `${marker}\n\n${entry.trim()}\n`)
  await Bun.write(log, `${next.trim()}\n`)
}

function regex(ver: string) {
  const safe = ver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\n?## \\[${safe}\\][\\s\\S]*?(?=\\n## \\[|$)`)
}

function body(ver: string, kind: string, from: string, tag: string, sha: string, notes: string) {
  return `## Summary
- Prepare JetBrains ${kind} release ${ver}.
- Review \`packages/kilo-jetbrains/gradle.properties\` and edit \`packages/kilo-jetbrains/CHANGELOG.md\` before merging.

JetBrains-Version: ${ver}
JetBrains-Kind: ${kind}
JetBrains-From-Tag: ${from}
JetBrains-Tag: ${tag}
JetBrains-Commit: ${sha}

## Generated Notes
${notes || "No notable changes."}
`
}
