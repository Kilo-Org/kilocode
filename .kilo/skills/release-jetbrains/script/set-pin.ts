#!/usr/bin/env bun

import { $ } from "bun"
import semver from "semver"
import { parseArgs } from "util"
import { latest, missing } from "./pin-common"

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "Kilo-Org/kilocode"
const file = "packages/kilo-jetbrains/package.json"
const label = "jetbrains-cli-pin-bump"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    version: { type: "string" },
    latest: { type: "boolean", default: false },
    pr: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`
Usage: bun .kilo/skills/release-jetbrains/script/set-pin.ts (--latest | --version <x.y.z>) [--pr]

Without --pr, rewrites ${file} in the local worktree so you can test a CLI pin.
With --pr, opens or updates a PR against main using the GitHub API; prepare tags
origin/main, so the pin bump must merge there before a JetBrains release starts.

Examples:
  bun .kilo/skills/release-jetbrains/script/set-pin.ts --latest
  bun .kilo/skills/release-jetbrains/script/set-pin.ts --version 7.4.1
  bun .kilo/skills/release-jetbrains/script/set-pin.ts --latest --pr
`)
  process.exit(0)
}

if (values.latest && values.version) throw new Error("Pass either --latest or --version, not both")
const version = values.latest ? await latest(repo) : values.version?.replace(/^v/, "")
if (!version || !semver.valid(version) || semver.prerelease(version)) {
  throw new Error("Pass a stable CLI version with --version x.y.z or use --latest")
}

const miss = await missing(repo, version)
if (miss.length > 0) {
  throw new Error(`CLI release v${version} is missing required assets: ${miss.join(", ")}`)
}

if (values.pr) {
  await pr(version)
  process.exit(0)
}

const pkg = await Bun.file(file).json()
const previous = pkg.version as string
pkg.version = version
await Bun.write(file, `${JSON.stringify(pkg, null, 2)}\n`)
if (previous === version) {
  console.log(`${file} already pins CLI v${version}`)
} else {
  console.log(`Pinned JetBrains CLI ${previous} -> ${version} in ${file}`)
}
console.log("Test locally with: cd packages/kilo-jetbrains && ./gradlew typecheck && ./gradlew test")
console.log("When satisfied, run this script again with --pr so the bump lands on main before prepare tags it.")

async function pr(version: string) {
  await $`git fetch origin main`.quiet()
  const branch = `chore/jetbrains-cli-pin-v${version}`
  const main = (await $`git rev-parse origin/main`.text()).trim()
  const text = await $`git show origin/main:${file}`.text()
  const pkg = JSON.parse(text)
  const previous = pkg.version as string
  if (previous === version) {
    console.log(`origin/main already pins CLI v${version}; no PR needed.`)
    return
  }
  pkg.version = version
  const body = `${JSON.stringify(pkg, null, 2)}\n`
  await ensure(branch, main)
  const current = (await $`gh api ${`repos/${repo}/contents/${file}?ref=${branch}`}`.json()) as { sha: string }
  await $`gh api --method PUT ${`repos/${repo}/contents/${file}`} -f message=${`chore(jetbrains): bump CLI pin to v${version}`} -f content=${Buffer.from(body).toString("base64")} -f branch=${branch} -f sha=${current.sha}`.quiet()

  const title = `chore(jetbrains): bump CLI pin to v${version}`
  const desc = [
    `Bumps the JetBrains CLI pin from v${previous} to v${version}.`,
    "",
    "Prepare tags origin/main, so this PR must merge before dispatching a JetBrains release that should lock this CLI.",
    "",
    "After merging, re-run:",
    "",
    "```bash",
    "bun .kilo/skills/release-jetbrains/script/check-pin.ts",
    "```",
  ].join("\n")
  const view = await $`gh pr view ${branch} --repo ${repo} --json url --jq .url`.quiet().nothrow()
  if (view.exitCode === 0 && view.stdout.toString().trim()) {
    await $`gh pr edit ${branch} --repo ${repo} --title ${title} --body ${desc}`
    await tag(branch)
    console.log(view.stdout.toString().trim())
    return
  }
  const url = await $`gh pr create --repo ${repo} --base main --head ${branch} --title ${title} --body ${desc}`.text()
  await tag(branch)
  console.log(url.trim())
}

async function ensure(branch: string, sha: string) {
  const ref = `repos/${repo}/git/refs/heads/${branch}`
  const exists = await $`gh api ${ref}`.nothrow().quiet()
  if (exists.exitCode === 0) {
    await $`gh api --method PATCH ${ref} -f sha=${sha} -F force=true`.quiet()
    return
  }
  await $`gh api --method POST ${`repos/${repo}/git/refs`} -f ref=${`refs/heads/${branch}`} -f sha=${sha}`.quiet()
}

async function tag(branch: string) {
  await $`gh label create ${label} --repo ${repo} --color 1D76DB --description ${"JetBrains pinned CLI version bump"}`.quiet().nothrow()
  const result = await $`gh pr edit ${branch} --repo ${repo} --add-label ${label}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    console.warn(`Warning: failed to add ${label} label to ${branch}`)
  }
}
