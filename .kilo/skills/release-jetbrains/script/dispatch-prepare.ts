#!/usr/bin/env bun

import { $ } from "bun"
import { parseArgs } from "util"

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "Kilo-Org/kilocode"
const workflow = "prepare-jetbrains-release.yml"
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    kind: { type: "string" },
    version: { type: "string" },
    "from-tag": { type: "string" },
    "run-id": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(`Usage: bun .kilo/skills/release-jetbrains/script/dispatch-prepare.ts --kind <rc|stable> --version <version> [--from-tag <tag>] [--run-id <id>]`)
  process.exit(0)
}

const kind = values.kind
const ver = values.version
const branch = `jetbrains/release/v${ver}`

if (kind !== "rc" && kind !== "stable") throw new Error("--kind must be rc or stable")
if (!ver) throw new Error("--version is required")

const id = values["run-id"] ?? (await dispatch())
const url = `https://github.com/${repo}/actions/runs/${id}`

console.log(`prepareRunId=${id}`)
console.log(`runUrl=${url}`)

await $`gh run watch ${id} --repo ${repo} --exit-status`

const pr = (await $`gh pr view ${branch} --repo ${repo} --json number,url`.json()) as { number: number; url: string }
console.log(
  JSON.stringify(
    {
      prNumber: pr.number,
      prUrl: pr.url,
      runUrl: url,
      branch,
    },
    null,
    2,
  ),
)

async function dispatch() {
  const before = new Set((await runs()).map((run) => run.databaseId))
  const args = ["workflow", "run", workflow, "--repo", repo, "-f", `kind=${kind}`, "-f", `version=${ver}`]
  if (values["from-tag"]) args.push("-f", `from_tag=${values["from-tag"]}`)
  await $`gh ${args}`

  for (const _ of Array.from({ length: 60 })) {
    const run = (await runs()).find((item) => !before.has(item.databaseId))
    if (run) return String(run.databaseId)
    await Bun.sleep(1000)
  }
  throw new Error(`No new ${workflow} run appeared after dispatch`)
}

async function runs() {
  return (await $`gh run list --repo ${repo} --workflow ${workflow} --event workflow_dispatch --json databaseId,createdAt,status --limit 100`.json()) as {
    databaseId: number
    createdAt: string
    status: string
  }[]
}
