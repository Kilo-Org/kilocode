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
  repo: string
  root: string
  packages: string[]
  bump: Bump
  drop: string[]
  dry: boolean
  force: boolean
  prerelease: boolean
}

type Group = Map<string, Map<string, string[]>>

const usage = `
Usage: bun script/upstream/opencode-changesets.ts <from> <to> [options]

Creates one changeset for upstream opencode releases in the semver range (from, to].

Options:
      --from <version>          Starting opencode version, exclusive
      --to <version>            Ending opencode version, inclusive
      --repo <owner/repo>       GitHub repository (default: anomalyco/opencode)
      --package <name>          Changeset package (repeatable; defaults to @kilocode/cli and kilo-code)
      --bump <type>             Changeset bump type: major, minor, patch (default: patch)
      --drop-section <heading>  Omit a markdown ## section by heading (repeatable; defaults to Desktop and SDK)
      --no-default-drop-section Do not drop the default Desktop and SDK sections
      --dry-run                 Print changesets without writing files
      --force                   Overwrite existing generated changeset files
      --include-prerelease      Include prerelease GitHub releases
  -h, --help                    Show this help message

Examples:
  bun script/upstream/opencode-changesets.ts 1.17.0 1.17.7
  bun script/upstream/opencode-changesets.ts --from v1.16.0 --to v1.17.7 --dry-run
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
  const base = tag(from).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()
  const head = tag(to).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()
  return `opencode-${base}-to-${head}.md`
}

function packages(input: string[], bump: Bump) {
  return input.map((item) => `"${item}": ${bump}`).join("\n")
}

function body(release: Release) {
  const text = release.body?.replace(/\r\n?/g, "\n").trim()
  if (text) return text

  const name = release.name?.trim()
  if (name && name !== release.tag_name) return name

  return `Integrate upstream opencode ${release.tag_name}.`
}

function filter(input: string, drop: string[]) {
  const drops = new Set(drop.map((item) => item.trim().toLowerCase()).filter(Boolean))
  const lines = input.replace(/\r\n?/g, "\n").split("\n")
  const out: string[] = []
  let section = false
  let thanks = false

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/)
    if (match) {
      section = drops.has(match[1].trim().toLowerCase())
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

    if (!section) out.push(line)
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function add(groups: Group, section: string, category: string, line: string) {
  if (!groups.has(section)) groups.set(section, new Map())
  const group = groups.get(section)!
  if (!group.has(category)) group.set(category, [])
  group.get(category)!.push(line)
}

function collect(releases: Release[], drop: string[]) {
  const groups: Group = new Map()

  for (const release of releases) {
    const text = filter(body(release), drop)
    let section = "Core"
    let category = ""

    for (const line of text.split("\n")) {
      const heading = line.match(/^##\s+(.+?)\s*$/)
      if (heading) {
        section = heading[1].trim()
        category = ""
        if (!groups.has(section)) groups.set(section, new Map())
        continue
      }

      const sub = line.match(/^###\s+(.+?)\s*$/)
      if (sub) {
        category = sub[1].trim()
        if (!groups.has(section)) groups.set(section, new Map())
        if (!groups.get(section)!.has(category)) groups.get(section)!.set(category, [])
        continue
      }

      if (!line.trim()) continue
      add(groups, section, category, line)
    }
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
        const text = item.replace(/^\s*[-*]\s+/, "").trim()
        lines.push(`- ${prefix}: ${text}`)
      }
    }
  }

  return lines.join("\n")
}

function isRelease(input: unknown): input is Release {
  return Boolean(input && typeof input === "object" && "tag_name" in input && typeof input.tag_name === "string")
}

export function select(releases: Release[], from: string, to: string, prerelease = false) {
  const base = clean(from)
  const head = clean(to)
  if (semver.gt(base, head) || base === head) throw new Error(`Expected from version to be lower than to version`)

  const seen = new Set<string>()
  return releases
    .filter((release) => !release.draft)
    .filter((release) => prerelease || !release.prerelease)
    .map((release) => ({ release, version: semver.valid(release.tag_name.replace(/^v/, "")) }))
    .filter((item): item is { release: Release; version: string } => Boolean(item.version))
    .filter((item) => {
      if (seen.has(item.version)) return false
      seen.add(item.version)
      return semver.gt(item.version, base) && semver.lte(item.version, head)
    })
    .sort((a, b) => semver.compare(a.version, b.version))
    .map((item) => ({ ...item.release, tag_name: tag(item.version) }))
}

export function changeset(releases: Release[], opts: Pick<Opts, "from" | "to" | "packages" | "bump" | "drop">) {
  const text = render(collect(releases, opts.drop)) || "No upstream release notes were published."
  return `---\n${packages(opts.packages, opts.bump)}\n---\n\nChanges from opencode ${tag(opts.from)} to ${tag(opts.to)} upstream:\n\n${text}\n`
}

async function all(repo: string) {
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

function opts() {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      from: { type: "string" },
      to: { type: "string" },
      repo: { type: "string", default: "anomalyco/opencode" },
      package: { type: "string", multiple: true },
      bump: { type: "string", default: "patch" },
      "drop-section": { type: "string", multiple: true },
      "no-default-drop-section": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "include-prerelease": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  })

  if (parsed.values.help) {
    process.stdout.write(usage)
    process.exit(0)
  }

  const from = parsed.values.from ?? parsed.positionals[0]
  const to = parsed.values.to ?? parsed.positionals[1]
  if (!from || !to) throw new Error("Expected from and to opencode versions")

  const bump = parsed.values.bump
  if (bump !== "major" && bump !== "minor" && bump !== "patch") throw new Error(`Invalid bump type: ${bump}`)

  return {
    from,
    to,
    repo: parsed.values.repo,
    root: path.resolve(import.meta.dir, "../.."),
    packages: parsed.values.package?.length ? parsed.values.package : ["@kilocode/cli", "kilo-code"],
    bump,
    drop: [...(parsed.values["no-default-drop-section"] ? [] : ["Desktop", "SDK"]), ...(parsed.values["drop-section"] ?? [])],
    dry: parsed.values["dry-run"],
    force: parsed.values.force,
    prerelease: parsed.values["include-prerelease"],
  } satisfies Opts
}

async function write(releases: Release[], opts: Opts) {
  const dir = path.join(opts.root, ".changeset")
  const file = path.join(dir, slug(opts.from, opts.to))
  const text = changeset(releases, opts)

  if (opts.dry) {
    process.stdout.write(`--- ${path.relative(opts.root, file)} ---\n${text}\n`)
    return
  }

  if (!opts.force && (await Bun.file(file).exists())) throw new Error(`Changeset already exists: ${file}`)
  await Bun.write(file, text)
  process.stdout.write(`Wrote ${path.relative(opts.root, file)}\n`)
}

export async function run(opts: Opts) {
  const releases = select(await all(opts.repo), opts.from, opts.to, opts.prerelease)
  if (releases.length === 0) throw new Error(`No opencode releases found in range (${opts.from}, ${opts.to}]`)

  await write(releases, opts)
}

if (import.meta.main) {
  await run(opts()).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
