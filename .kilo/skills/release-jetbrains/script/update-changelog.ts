#!/usr/bin/env bun

import { $ } from "bun"
import { parseArgs } from "util"

const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "Kilo-Org/kilocode"
const path = "packages/kilo-jetbrains/CHANGELOG.md"
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    version: { type: "string" },
    file: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
})

if (values.help) {
  console.log(
    `Usage: bun .kilo/skills/release-jetbrains/script/update-changelog.ts --version <version> --file <section.md>`,
  )
  process.exit(0)
}

const ver = values.version
const file = values.file
if (!ver) throw new Error("--version is required")
if (!file) throw new Error("--file is required")

const branch = `jetbrains/release/v${ver}`
const section = strip((await Bun.file(file).text()).trim())
validate(section, ver)

const current = (await $`gh api ${`repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`}`.json()) as {
  content: string
  encoding: string
  sha: string
}
if (current.encoding !== "base64") throw new Error(`Unexpected content encoding: ${current.encoding}`)

const text = Buffer.from(current.content.replace(/\s/g, ""), "base64").toString("utf8")
const pattern = regex(ver)
if (!pattern.test(text)) throw new Error(`${path} is missing a section for ${ver} on ${branch}`)

const next =
  text
    .replace(pattern, `\n${section}\n`)
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n"
if (next === text) {
  console.log("CHANGELOG.md already contains the provided section")
  process.exit(0)
}

const body = {
  message: `docs(jetbrains): edit changelog for v${ver}`,
  content: Buffer.from(next).toString("base64"),
  sha: current.sha,
  branch,
}
const tmp = await temp(body)
await $`gh api ${`repos/${repo}/contents/${path}`} --method PUT --input ${tmp}`
console.log(`Committed changelog update to ${branch}`)

function strip(text: string) {
  return text.replace(/<!--\s*CONTEXT[\s\S]*?-->/g, "").trim()
}

function validate(section: string, ver: string) {
  if (!section.startsWith(`## [${ver}]`)) throw new Error(`Section must start with ## [${ver}]`)
  if (!/^### (Added|Fixed|Changed)$/m.test(section)) {
    throw new Error("Section must contain at least one Added, Fixed, or Changed heading")
  }
}

function regex(ver: string) {
  const safe = ver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\n?## \\[${safe}\\][\\s\\S]*?(?=\n## \\[|$)`)
}

async function temp(body: object) {
  const file = `/tmp/kilo-jetbrains-changelog-${Date.now()}.json`
  await Bun.write(file, JSON.stringify(body))
  return file
}
