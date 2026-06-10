#!/usr/bin/env bun

import { $ } from "bun"
import { parseArgs } from "util"

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "Kilo-Org/kilocode"
const workflow = "publish-jetbrains.yml"
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    pr: { type: "string" },
    version: { type: "string" },
    merge: { type: "boolean", default: false },
    "run-id": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(
    `Usage: bun .kilo/skills/release-jetbrains/script/watch-publish.ts --pr <number> --version <version> [--merge] [--run-id <id>]`,
  )
  process.exit(0)
}

const pr = values.pr
const ver = values.version
if (!pr) throw new Error("--pr is required")
if (!ver) throw new Error("--version is required")

const branch = `jetbrains/release/v${ver}`
const id = values["run-id"] ?? (values.merge ? await merge() : await find())
const url = `https://github.com/${repo}/actions/runs/${id}`

console.log(`publishRunId=${id}`)
console.log(`runUrl=${url}`)

await $`gh run watch ${id} --repo ${repo} --exit-status`

const rel = (await $`gh release view ${`jetbrains/v${ver}`} --repo ${repo} --json url,isPrerelease`.json()) as {
  url: string
  isPrerelease: boolean
}
console.log(
  JSON.stringify(
    {
      version: ver,
      marketplaceChannel: rel.isPrerelease ? "eap" : "default",
      releaseUrl: rel.url,
      runUrl: url,
    },
    null,
    2,
  ),
)

async function merge() {
  const before = new Set((await runs()).map((run) => run.databaseId))
  await $`gh pr merge ${pr} --repo ${repo} --merge`

  for (const _ of Array.from({ length: 120 })) {
    const run = (await runs()).find((item) => item.headBranch === branch && !before.has(item.databaseId))
    if (run) return String(run.databaseId)
    await Bun.sleep(1000)
  }
  throw new Error(`No new ${workflow} run appeared after merging PR ${pr}`)
}

async function find() {
  for (const _ of Array.from({ length: 120 })) {
    const run = (await runs()).find((item) => item.headBranch === branch && active(item.status))
    if (run) return String(run.databaseId)
    await Bun.sleep(1000)
  }
  throw new Error(
    `No ${workflow} run found for ${branch}. Merge PR ${pr} first, or pass --merge to merge it automatically.`,
  )
}

function active(status: string) {
  return (
    status === "queued" ||
    status === "in_progress" ||
    status === "waiting" ||
    status === "requested" ||
    status === "pending"
  )
}

async function runs() {
  return (await $`gh run list --repo ${repo} --workflow ${workflow} --event pull_request --json databaseId,createdAt,headBranch,status --limit 100`.json()) as {
    databaseId: number
    createdAt: string
    headBranch: string
    status: string
  }[]
}
