#!/usr/bin/env bun

import path from "path"
import semver from "semver"
import { parseArgs } from "util"

type Bump = "major" | "minor" | "patch"

export type Release = {
  tag_name: string
  name?: string | null
  body?: string | null
  draft?: boolean
  prerelease?: boolean
}

type Opts = {
  from: string
  to: string
  root: string
}

type Group = Map<string, Map<string, string[]>>

const repo = "anomalyco/opencode"
const pkgs = ["@kilocode/cli", "kilo-code"]
const bump: Bump = "patch"
const drop = ["Desktop", "SDK"]

const usage = `
Usage: bun script/upstream/opencode-changesets.ts --from <version> --to <version>

Creates one changeset for upstream opencode releases in the semver range (from, to].

Options:
      --from <version>  Starting opencode version, exclusive
      --to <version>    Ending opencode version, inclusive
  -h, --help            Show this help message

Example:
  bun script/upstream/opencode-changesets.ts --from v1.16.0 --to v1.17.7
`

function clean(input: string) {
  const raw = input.trim().replace(/^v/, "")
  const version = semver.valid(raw)
  if (!version) throw new Error(`Invalid semver version: ${input}`)
  return version
}

function tag(input: string) {
  return `v${clean(input)}`
}

function slug(from: string, to: string) {
  const base = tag(from)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
  const head = tag(to)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
  return `opencode-${base}-to-${head}.md`
}

function header(input: string[], bump: Bump) {
  return input.map((item) => `"${item}": ${bump}`).join("\n")
}

function body(release: Release) {
  const text = release.body?.replace(/\r\n?/g, "\n").trim()
  if (text) return text

  const name = release.name?.trim()
  if (name && name !== release.tag_name) return name

  return `Integrate upstream opencode ${release.tag_name}.`
}

function filter(input: string, sections: string[]) {
  const dropped = new Set(sections.map((item) => item.trim().toLowerCase()).filter(Boolean))
  const lines = input.replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let skip = false
  let thanks = false

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/)
    if (match) {
      skip = dropped.has(match[1].trim().toLowerCase())
      thanks = false
    }

    if (line.match(/^\*\*Thank you to \d+ community contributors?:\*\*\s*$/)) {
      thanks = true
      continue
    }

    if (thanks) {
      if (!line.startsWith("-") && !line.startsWith("  -") && line.trim() !== "") thanks = false
      if (thanks) continue
    }

    if (!skip) out.push(line)
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function add(groups: Group, section: string, category: string, lines: string[]) {
  const text = lines.join("\n").trim()
  if (!text) return
  if (!groups.has(section)) groups.set(section, new Map())
  const group = groups.get(section)!
  if (!group.has(category)) group.set(category, [])
  group.get(category)!.push(text)
}

function collect(releases: Release[]) {
  const groups: Group = new Map()

  for (const release of releases) {
    const text = filter(body(release), drop)
    let section = "Core"
    let category = ""
    const block: string[] = []

    const flush = () => {
      add(groups, section, category, block.splice(0))
    }

    for (const line of text.split("\n")) {
      const heading = line.match(/^##\s+(.+?)\s*$/)
      if (heading) {
        flush()
        section = heading[1].trim()
        category = ""
        if (!groups.has(section)) groups.set(section, new Map())
        continue
      }

      const sub = line.match(/^###\s+(.+?)\s*$/)
      if (sub) {
        flush()
        category = sub[1].trim()
        if (!groups.has(section)) groups.set(section, new Map())
        if (!groups.get(section)!.has(category)) groups.get(section)!.set(category, [])
        continue
      }

      if (!line.trim() && block.length === 0) continue
      if (line.match(/^[-*]\s+/) && block.length > 0) flush()
      block.push(line)
    }

    flush()
  }

  return groups
}

function render(groups: Group) {
  const lines: string[] = []

  for (const [section, cats] of groups) {
    for (const [category, items] of cats) {
      if (items.length === 0) continue
      const prefix = [section, category].filter(Boolean).join(" ")
      for (const item of items) {
        const text = item.replace(/^\s*[-*]\s+/, "").trimEnd()
        const body = text.split("\n")
        const [first = "", ...rest] = body
        lines.push(`- ${prefix}: ${first.trim()}`)
        lines.push(...rest.map((line) => (line.trim() ? `  ${line}` : "")))
      }
    }
  }

  return lines.join("\n")
}

function isRelease(input: unknown): input is Release {
  return Boolean(input && typeof input === "object" && "tag_name" in input && typeof input.tag_name === "string")
}

export function select(releases: Release[], from: string, to: string) {
  const base = clean(from)
  const head = clean(to)
  if (semver.gt(base, head) || base === head) throw new Error(`Expected from version to be lower than to version`)

  const seen = new Set<string>()
  const published = releases
    .filter((release) => !release.draft)
    .filter((release) => !release.prerelease)
    .map((release) => ({ release, version: semver.valid(release.tag_name.replace(/^v/, "")) }))
    .filter((item): item is { release: Release; version: string } => Boolean(item.version))

  if (!published.some((item) => item.version === base)) {
    throw new Error(`Starting opencode release does not exist or is not published: ${tag(base)}`)
  }

  if (!published.some((item) => item.version === head)) {
    throw new Error(`Target opencode release does not exist or is not published: ${tag(head)}`)
  }

  return published
    .filter((item) => {
      if (seen.has(item.version)) return false
      seen.add(item.version)
      return semver.gt(item.version, base) && semver.lte(item.version, head)
    })
    .sort((a, b) => semver.compare(a.version, b.version))
    .map((item) => ({ ...item.release, tag_name: tag(item.version) }))
}

export function changeset(releases: Release[], from: string, to: string) {
  const text = render(collect(releases)) || "No upstream release notes were published."
  return `---\n${header(pkgs, bump)}\n---\n\nChanges from opencode ${tag(from)} to ${tag(to)} upstream:\n\n${text}\n`
}

async function fetch_all() {
  const list: Release[] = []
  const auth = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN

  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
    })

    if (!res.ok) throw new Error(`GitHub releases request failed for ${repo}: ${res.status} ${await res.text()}`)

    const json: unknown = await res.json()
    if (!Array.isArray(json) || !json.every(isRelease)) throw new Error(`GitHub returned invalid release data`)

    const batch = json
    list.push(...batch)
    if (batch.length < 100) return list
  }
}

function parse_opts() {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      from: { type: "string" },
      to: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  if (parsed.values.help) {
    process.stdout.write(usage)
    process.exit(0)
  }

  const from = parsed.values.from
  const to = parsed.values.to
  if (!from || !to) throw new Error("Expected from and to opencode versions")

  return { from, to, root: path.resolve(import.meta.dir, "../..") } satisfies Opts
}

export async function run(opts: Opts) {
  const releases = select(await fetch_all(), opts.from, opts.to)
  if (releases.length === 0) throw new Error(`No opencode releases found in range (${opts.from}, ${opts.to}]`)

  const dir = path.join(opts.root, ".changeset")
  const file = path.join(dir, slug(opts.from, opts.to))
  await Bun.write(file, changeset(releases, opts.from, opts.to))
  process.stdout.write(`Wrote ${path.relative(opts.root, file)}\n`)
}

if (import.meta.main) {
  await (async () => run(parse_opts()))().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
