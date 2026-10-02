// Report outdated dependencies of Kilo-owned workspace packages.
//
// Dependabot's root `bun` scan has version updates turned off (it mostly
// touched upstream files), so nothing else says when a Kilo-owned package falls
// behind. This script runs `bun outdated` for `packages/kilo-*` and prints a
// JSON report `{ count, text, full }`: `text` is the short Slack message and
// `full` the complete list for the job summary.
//
// kilo-docs and kilo-jetbrains are left out: Dependabot still has its own
// block for each of them.

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
    // "*" marks a version bun flags as beyond the current range.
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

export function report(rows: Row[], url?: string, limit = Infinity) {
  const found = rows.flatMap((row) => {
    const level = kind(row.current, row.latest)
    return level ? [{ ...row, level }] : []
  })
  const count = (level: Kind) => found.filter((row) => row.level === level).length
  if (found.length === 0) return { count: 0, text: "" }

  const line = (row: (typeof found)[number]) =>
    `- \`${row.name}\` ${row.current} -> ${row.latest} (${row.where.replace(/^catalog \((.*)\)$/, "$1")})${row.catalog ? " [root catalog]" : ""}`
  const section = (level: Kind) => {
    const list = found.filter((row) => row.level === level)
    if (list.length === 0) return []
    const shown = list.slice(0, limit).map(line)
    const more = list.length > limit ? [`- ...and ${list.length - limit} more (see the job summary)`] : []
    return [`*${level[0].toUpperCase()}${level.slice(1)}*`, ...shown, ...more]
  }

  const shown = [...found.filter((row) => row.level === "major"), ...found.filter((row) => row.level === "minor")]
  const text = [
    `*Outdated Kilo-owned dependencies: ${count("major")} major, ${count("minor")} minor, ${count("patch")} patch*`,
    ...section("major"),
    ...section("minor"),
    count("patch") > 0 ? `${count("patch")} patch updates not listed.` : "",
    shown.slice(0, limit).some((row) => row.catalog)
      ? "[root catalog] entries are pinned in the root package.json, which is shared with upstream. Bump them with care."
      : "",
    url ? `<${url}|Workflow run>` : "",
  ]
    .filter(Boolean)
    .join("\n")
  return { count: found.length, text }
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
  // A clean workspace prints no table at all, so only a non-zero exit is an error.
  if (code !== 0) {
    console.error(err || out)
    process.exit(code)
  }
  const rows = parse(out + "\n" + err)
  const short = report(rows, process.env.RUN_URL, LIMIT)
  console.log(JSON.stringify({ count: short.count, text: short.text, full: report(rows).text }))
}

if (import.meta.main) await run()
