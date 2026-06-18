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

const rel = await retry(
  async () =>
    (await $`gh release view ${`jetbrains/v${ver}`} --repo ${repo} --json url,isPrerelease`.json()) as {
      url: string
      isPrerelease: boolean
    },
  "view release",
)
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
  try {
    await $`gh pr merge ${pr} --repo ${repo} --merge`
  } catch (err) {
    if (await merged()) {
      console.warn(`PR ${pr} is already merged; looking for the publish workflow run`)
      return await find()
    }
    throw err
  }

  for (const _ of Array.from({ length: 120 })) {
    const run = (await runs()).find((item) => item.headBranch === branch && !before.has(item.databaseId))
    if (run) return String(run.databaseId)
    await Bun.sleep(1000)
  }
  throw new Error(`No new ${workflow} run appeared after merging PR ${pr}`)
}

async function find() {
  for (const _ of Array.from({ length: 120 })) {
    const run = (await runs()).find((item) => item.headBranch === branch)
    if (run) return String(run.databaseId)
    await Bun.sleep(1000)
  }
  throw new Error(`No ${workflow} run found for ${branch}. Merge PR ${pr} first, or pass --merge to merge it automatically.`)
}

async function merged() {
  const info = await retry(
    async () => (await $`gh pr view ${pr} --repo ${repo} --json state`.json()) as { state: string },
    "check PR state",
  )
  return info.state === "MERGED"
}

async function runs() {
  return await retry(
    async () =>
      (await $`gh run list --repo ${repo} --workflow ${workflow} --event pull_request --json databaseId,createdAt,headBranch,status --limit 100`.json()) as {
        databaseId: number
        createdAt: string
        headBranch: string
        status: string
      }[],
    "list workflow runs",
  )
}

async function retry<T>(task: () => Promise<T>, label: string, tries = 5): Promise<T> {
  try {
    return await task()
  } catch (err) {
    if (tries <= 1 || !transient(err)) throw err
    console.warn(`${label} failed with a transient GitHub error; retrying (${tries - 1} left): ${message(err)}`)
    await Bun.sleep(2000)
    return await retry(task, label, tries - 1)
  }
}

function transient(err: unknown) {
  return /\bHTTP 5\d\d\b|\b50[234]\b|Bad Gateway|Gateway Timeout|Service Unavailable/i.test(message(err))
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
