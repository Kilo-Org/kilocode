// Report outdated dependencies of Kilo-owned workspace packages.
//
// Dependabot's root `bun` scan has version updates turned off (it mostly
// touched upstream files), so nothing else says when a Kilo-owned package falls
// behind. This script runs `bun outdated` for `packages/kilo-*` and prints a
// JSON report `{ count, text, full }`: `text` is the short Slack message and
// `full` the complete list for the job summary.
//
// kilo-docs is left out because Dependabot still has its own block for it.
// kilo-jetbrains has no bun dependencies (its Gradle ones are covered by the
// Dependabot gradle block), so the filter matches it but finds nothing.

export type Row = {
  name: string
  current: string
  latest: string
  where: string
  catalog: boolean
}

export type Kind = "major" | "minor" | "patch"

// Lines per section in the Slack message. The job summary lists everything.
const LIMIT = 15

// Parse the table printed by `bun outdated`:
// | Package | Current | Update | Latest | Workspace |
export function parse(text: string): Row[] {
  return text.split("\n").flatMap((line) => {
    if (!line.startsWith("|")) return []
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length !== 5) return []
    if (cells[0] === "Package" || /^-+$/.test(cells[0])) return []
    // bun appends "*" to some versions. It is not part of the version.
    const version = (cell: string) => cell.replace(/\s*\*$/, "")
    const where = cells[4]
    return [
      {
        name: cells[0].replace(/\s*\((dev|peer|optional)\)$/, ""),
        current: version(cells[1]),
        latest: version(cells[3]),
        where,
        catalog: where.startsWith("catalog"),
      },
    ]
  })
}

function nums(version: string) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

// How far `latest` is ahead of `current`. Undefined when it is not ahead or a
// version is not plain semver (git refs, tags).
export function kind(current: string, latest: string): Kind | undefined {
  const a = nums(current)
  const b = nums(latest)
  if (!a || !b) return undefined
  if (b[0] !== a[0]) return b[0] > a[0] ? "major" : undefined
  if (b[1] !== a[1]) return b[1] > a[1] ? "minor" : undefined
  if (b[2] !== a[2]) return b[2] > a[2] ? "patch" : undefined
  return undefined
}

type Options = { url?: string; limit?: number; patch?: boolean }

// `limit` caps the rows printed per section. `patch` lists patch updates too
// (the full report); otherwise they are only counted.
export function report(rows: Row[], opts: Options = {}) {
  const limit = opts.limit ?? Infinity
  const found = rows.flatMap((row) => {
    const level = kind(row.current, row.latest)
    return level ? [{ ...row, level }] : []
  })
  if (found.length === 0) return { count: 0, text: "" }

  const levels: Kind[] = opts.patch ? ["major", "minor", "patch"] : ["major", "minor"]
  const count = (level: Kind) => found.filter((row) => row.level === level).length
  const sections = levels.flatMap((level) => {
    const list = found.filter((row) => row.level === level)
    return list.length ? [{ level, list, shown: list.slice(0, limit) }] : []
  })
  const line = (row: (typeof found)[number]) =>
    `- \`${row.name}\` ${row.current} -> ${row.latest} (${row.where.replace(/^catalog \((.*)\)$/, "$1")})${row.catalog ? " [root catalog]" : ""}`
  const block = (item: (typeof sections)[number]) => [
    `*${item.level[0].toUpperCase()}${item.level.slice(1)}*`,
    ...item.shown.map(line),
    ...(item.list.length > item.shown.length
      ? [`- ...and ${item.list.length - item.shown.length} more (see the job summary)`]
      : []),
  ]
  const unlisted = opts.patch ? 0 : count("patch")

  const text = [
    `*Outdated Kilo-owned dependencies: ${count("major")} major, ${count("minor")} minor, ${count("patch")} patch*`,
    ...sections.flatMap(block),
    unlisted > 0 ? `${unlisted} patch update${unlisted === 1 ? "" : "s"} not listed.` : "",
    // Derived from the rows actually printed, so the label and the note agree.
    sections.some((item) => item.shown.some((row) => row.catalog))
      ? "[root catalog] entries are pinned in the root package.json, which is shared with upstream. Bump them with care."
      : "",
    opts.url ? `<${opts.url}|Workflow run>` : "",
  ]
    .filter(Boolean)
    .join("\n")
  return { count: found.length, text }
}

// `bun outdated` exits 0 even when it fails, and prints nothing but a banner
// when everything is current. Reject the two cases that would otherwise look
// like "nothing outdated": an error line, and a table that no longer parses.
export function verify(text: string, rows: Row[]) {
  const bad = text.split("\n").find((line) => /^error/i.test(line))
  if (bad) throw new Error(`bun outdated failed: ${bad}`)
  if (text.includes("| Package") && rows.length === 0) throw new Error("bun outdated table format changed")
}

async function run() {
  const proc = Bun.spawn(["bun", "outdated", "--filter", "./packages/kilo-*", "--filter", "!./packages/kilo-docs"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    console.error(err || out)
    process.exit(code)
  }
  const all = out + "\n" + err
  const rows = parse(all)
  verify(all, rows)
  const short = report(rows, { url: process.env.RUN_URL, limit: LIMIT })
  console.log(JSON.stringify({ count: short.count, text: short.text, full: report(rows, { patch: true }).text }))
}

if (import.meta.main) await run()
