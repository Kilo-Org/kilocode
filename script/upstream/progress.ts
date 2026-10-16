/**
 * Kilo v2 migration progress map.
 *
 * Measures Kilo's v1 delta (the pinned v1 target over its upstream base) as cells grouped into
 * feature boxes, and checks every cell against the v2 working tree. Everything is mechanical: paths,
 * imports, identifiers, markers and string equality. The only hand-written inputs are
 * `migration-tracking/progress/features.json` (pins, feature split, exclusions) and
 * `migration-tracking/progress/dispositions.json` (decisions per cell).
 *
 * Cell kinds and the rule that marks a cell done on v2:
 * - module: a Kilo-owned v1 file. Done when a Kilo-owned v2 file has the same feature and relative
 *   path, or the same feature and basename.
 * - api: a `/kilocode/*` operation in the v1 OpenAPI document. Done when the path literal appears in
 *   `packages/protocol`, `packages/server` or a Kilo-owned v2 file.
 * - hook: one Kilo hunk in a shared upstream file. Its ID is a hash of the added lines. Done when a
 *   v2 file carries `kilocode_change(<feature>:<id>)`.
 * - test: a module or hook in a test file, same rules.
 * A disposition (`ported`, `native`, `facade`) also marks a cell done; `dropped` removes it from the
 * denominator and lists it.
 *
 * Usage, from the repository root:
 *   bun script/upstream/progress.ts                 regenerate progress.json and README.md
 *   bun script/upstream/progress.ts --check         exit 1 when the committed output is stale
 *   bun script/upstream/progress.ts --list <feature>  print the open cells of one feature
 */

import { $ } from "bun"
import path from "node:path"
import { isKiloOwned } from "./utils/owned"

const ROOT = path.resolve(import.meta.dir, "../..")
const DIR = path.join(ROOT, "migration-tracking/progress")

type Config = {
  pins: { v1Target: string; v1Base: string }
  /** `dir`, `dir/sub` or `kilo-<pkg>` -> feature. Checked longest key first. */
  split: Record<string, string>
  /** feature -> reason. Excluded features are listed, not counted. */
  exclude: Record<string, string>
}

type State = "ported" | "native" | "facade" | "dropped"
type Disposition = { state: State; v2?: string; note: string; by: string }
type Kind = "module" | "api" | "hook" | "test"
type Cell = { id: string; kind: Kind; feature: string; source: string; v2?: string; state?: State }

const TAG = /kilocode_change\(([a-z0-9-]+)(?::([0-9a-f]{12}))?\)/g
const MARKER = /^\s*(?:\/\/|\/\*|\{\/\*|<!--|#|\*)?\s*(?:\/\/|\/\*|\{\/\*)?\s*kilocode_change\b/
const GENERATED = [/openapi\.json$/, /\/gen\//, /\/generated\//, /\.gen\.ts$/, /\.lock$/, /bun\.lock$/]
/** Package scaffolding is not code to port, so it is not a module cell. */
const SCAFFOLDING = /(^|\/)(package\.json|tsconfig[^/]*\.json|bun\.lock|README[^/]*|LICENSE[^/]*|CHANGELOG[^/]*|\.gitignore|\.npmignore)$/

export function isTestPath(file: string) {
  return /(^|\/)(test|tests|__tests__)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
}

const strip = (name: string) => name.replace(/\.(test|spec)$/, "").replace(/\.[cm]?[jt]sx?$/, "").replace(/\.(test|spec|txt)$/, "")

/**
 * Feature of a Kilo-owned path, on either line. A loose file directly under `kilocode/` (for example
 * `test/kilocode/agent-manager-service.test.ts`) joins the longest known feature that prefixes its name.
 */
export function featureOf(file: string, split: Record<string, string>, known: Set<string> = new Set()) {
  const pkg = file.match(/^(?:packages\/|@kilocode\/)kilo-([a-z0-9-]+?)(?:-core)?(?:\/|$)/)
  if (pkg) return resolve(split[`kilo-${pkg[1]}`] ?? pkg[1], split)
  const inner = file.match(/(?<![\w@.-])kilocode\/([^/]+)(?:\/([^/]+))?/)
  if (!inner) return undefined
  const dir = strip(inner[1])
  const sub = inner[2] && strip(inner[2])
  if (sub && split[`${dir}/${sub}`]) return resolve(split[`${dir}/${sub}`], split)
  if (split[dir]) return resolve(split[dir], split)
  if (inner[2] || known.has(dir)) return dir
  const prefix = [...known].filter((f) => dir.startsWith(f + "-")).sort((a, b) => b.length - a.length)[0]
  return prefix ?? dir
}

/** A split target may itself be a split key (for example `sessions` -> `session`). One level is enough. */
const resolve = (feature: string, split: Record<string, string>) => split[feature] ?? feature

/** Feature directories and packages on the v1 target: the names loose files may join. */
export function knownFeatures(files: string[], split: Record<string, string>) {
  const known = new Set<string>(Object.values(split))
  for (const f of files) {
    const pkg = f.match(/^packages\/kilo-([a-z0-9-]+?)(?:-core)?\//)
    if (pkg) known.add(split[`kilo-${pkg[1]}`] ?? pkg[1])
    const dir = f.match(/kilocode\/([^/]+)\//)?.[1]
    if (dir) known.add(split[dir] ?? dir)
  }
  return known
}

/** Path of a Kilo-owned file relative to its feature root, for exact module matching. */
function relativeOf(file: string) {
  const pkg = file.match(/^packages\/kilo-[a-z0-9-]+?(?:-core)?\/(?:src\/)?(.*)$/)
  if (pkg) return pkg[1]
  return file.match(/kilocode\/[^/]+\/(.*)$/)?.[1] ?? path.basename(file)
}

/** Upstream area of a shared file, for the `unattributed:<area>` boxes. */
export function areaOf(file: string) {
  const m = file.match(/^packages\/([^/]+)\/(src|test|script)\/([^/]+)/)
  if (!m) return (file.match(/^packages\/([^/]+)/)?.[1] ?? file.split("/")[0]) + "/pkg"
  const pkg = m[1] === "opencode" ? "" : m[1] + "/"
  return m[2] === "src" ? pkg + m[3].replace(/\.[a-z]+$/, "") : pkg + m[2]
}

/** Collapse every brand spelling so a pure rename compares equal. */
export function canon(lines: string[]) {
  return lines
    .map((l) => l.replace(/(\/\/|\/\*|\{\/\*|<!--|#)\s*kilocode_change.*$/, ""))
    .join("\n")
    .toLowerCase()
    .replace(/@opencode-ai\/|@opencode\/|@kilocode\//g, "@brand/")
    .replace(/anomalyco\/opencode|sst\/opencode|kilo-org\/kilocode/g, "brandrepo")
    .replace(/opencode\.ai|kilo\.ai|kilocode\.ai/g, "brandhost")
    .replace(/kilo code|kilocode|opencode|kilo/g, "brand")
    .replace(/\s+/g, "")
}

export function hookId(added: string[]) {
  const normalized = added
    .map((l) => l.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/\s+/g, ""))
    .filter(Boolean)
    .join("\n")
  return new Bun.CryptoHasher("sha256").update(normalized).digest("hex").slice(0, 12)
}

export type Hunk = { file: string; line: number; added: string[]; removed: string[] }

export function parseHunks(diff: string) {
  const hunks: Hunk[] = []
  let file = ""
  // `---`/`+++` are file headers only between `diff --git` and the first `@@`; inside a hunk they are content.
  let header = false
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      file = line.slice(line.indexOf(" b/") + 3)
      header = true
    } else if (line.startsWith("@@")) {
      header = false
      hunks.push({ file, line: Number(line.match(/\+(\d+)/)?.[1] ?? 0), added: [], removed: [] })
    } else if (header) continue
    else if (line.startsWith("+") && hunks.length) hunks.at(-1)!.added.push(line.slice(1))
    else if (line.startsWith("-") && hunks.length) hunks.at(-1)!.removed.push(line.slice(1))
  }
  return hunks
}

/** Bindings a v1 file imports from Kilo modules, so a hunk that only uses them is attributable. */
export function importBindings(source: string, split: Record<string, string>, known: Set<string> = new Set()) {
  const map = new Map<string, string>()
  const code = source.replace(/^\s*\/\/.*$/gm, "")
  for (const m of code.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    const feature = featureOf(m[2].replace(/^@\//, "packages/opencode/src/"), split, known)
    if (!feature || !/kilocode\/|@kilocode\/kilo-/.test(m[2])) continue
    const clause = m[1]
    const names = [
      ...[...clause.matchAll(/\{([^}]*)\}/g)].flatMap((g) => g[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim())),
      ...[...clause.matchAll(/\*\s+as\s+(\w+)/g)].map((g) => g[1]),
      ...(clause.match(/^\s*(\w+)\s*(,|$)/) ? [clause.match(/^\s*(\w+)\s*(,|$)/)![1]] : []),
    ]
    for (const n of names) if (n && n !== "type") map.set(n, feature)
  }
  return map
}

export type Classified =
  | { kind: "marker" }
  | { kind: "branding" }
  | { kind: "cell"; feature: string; how: "tag" | "import" | "identifier" | "unattributed" }

/** Attribute one hunk. Explicit tag first, then import, identifier, and finally the upstream area. */
export function classify(hunk: Hunk, bindings: Map<string, string>, split: Record<string, string>, known?: Set<string>): Classified {
  const code = hunk.added.filter((l) => l.trim() !== "" && !MARKER.test(l))
  if (code.length === 0) return { kind: "marker" }
  if (hunk.removed.length && canon(hunk.removed) === canon(hunk.added)) return { kind: "branding" }
  const joined = hunk.added.join("\n")
  const tag = [...joined.matchAll(TAG)].map((m) => m[1])[0]
  if (tag) return { kind: "cell", feature: resolve(split[tag] ?? tag, split), how: "tag" }
  // A module path `kilocode/<dir>` or a Kilo package. The known-feature guard drops URL segments such as
  // `Kilo-Org/kilocode/issues`, and the lookbehind drops the `@kilocode/` package scope.
  const imported = [...joined.matchAll(/(?:(?<![\w@.-])kilocode\/|@kilocode\/kilo-)([a-z0-9-]+)(?:\/([a-z0-9-]+))?/g)]
    .map((m) => resolve((m[2] && split[`${m[1]}/${m[2]}`]) ?? split[m[1]] ?? m[1], split))
    .filter((f) => !known || known.has(f))[0]
  if (imported) return { kind: "cell", feature: imported, how: "import" }
  const used = [...bindings.keys()].find((name) => new RegExp(`\\b${name.replace(/[^\w$]/g, "")}\\b`).test(joined))
  if (used) return { kind: "cell", feature: bindings.get(used)!, how: "identifier" }
  return { kind: "cell", feature: `unattributed:${areaOf(hunk.file)}`, how: "unattributed" }
}

async function git(args: string[]) {
  return (await $`git ${args}`.cwd(ROOT).quiet().text()).trimEnd()
}

async function readJson<T>(file: string): Promise<T> {
  return (await Bun.file(path.join(DIR, file)).json()) as T
}

async function collect(config: Config, dispositions: Record<string, Disposition>) {
  const { v1Target, v1Base } = config.pins
  const split = config.split
  for (const pin of [v1Target, v1Base]) {
    const ok = await $`git cat-file -e ${pin}^{commit}`.cwd(ROOT).quiet().nothrow()
    if (ok.exitCode !== 0) throw new Error(`pinned commit ${pin} is not in this clone. Run: git fetch --filter=blob:none --no-tags origin main`)
  }

  const v1Files = (await git(["ls-tree", "-r", "--name-only", v1Target, "--", "packages"])).split("\n")
  const known = knownFeatures(v1Files, split)

  // v2 side: tracked Kilo-owned files and port markers, from the working tree.
  const v2Files = (await git(["ls-files", "--", "packages"])).split("\n").filter((f) => f && isKiloOwned(f))
  const v2Modules = new Map<string, string>()
  for (const f of v2Files) {
    const feature = featureOf(f, split, known)
    if (!feature) continue
    v2Modules.set(`${feature}|${relativeOf(f)}`, f)
    v2Modules.set(`${feature}|${path.basename(f)}`, f)
  }
  const v2Markers = new Map<string, string>()
  const grep = await git(["grep", "-n", "-o", "-E", "kilocode_change\\([a-z0-9-]+:[0-9a-f]{12}\\)", "--", "packages"]).catch(() => "")
  for (const line of grep.split("\n")) {
    const m = line.match(/^([^:]+):(\d+):kilocode_change\(([a-z0-9-]+):([0-9a-f]{12})\)$/)
    if (m) v2Markers.set(`hook:${m[3]}:${m[4]}`, `${m[1]}:${m[2]}`)
  }

  const cells: Cell[] = []

  // module and test cells: Kilo-owned files on the v1 target.
  for (const f of v1Files) {
    if (!isKiloOwned(f) || SCAFFOLDING.test(f)) continue
    const feature = featureOf(f, split, known)
    if (!feature) continue
    const v2 = v2Modules.get(`${feature}|${relativeOf(f)}`) ?? v2Modules.get(`${feature}|${path.basename(f)}`)
    cells.push({ id: `module:${f}`, kind: isTestPath(f) ? "test" : "module", feature, source: f, v2 })
  }

  // api cells: Kilo operations in the v1 OpenAPI document.
  const openapi = JSON.parse(await git(["show", `${v1Target}:packages/sdk/openapi.json`])) as {
    paths: Record<string, Record<string, unknown>>
  }
  const routes = Object.keys(openapi.paths)
    .filter((p) => p.startsWith("/kilocode/"))
    .sort()
  const literals = routes.length
    ? new Set(
        (
          await git([
            "grep",
            "-h",
            "-o",
            "-F",
            ...routes.flatMap((r) => ["-e", r]),
            "--",
            "packages/protocol/src",
            "packages/server/src",
            ...v2Files,
          ]).catch(() => "")
        ).split("\n"),
      )
    : new Set<string>()
  for (const route of routes) {
    const segment = route.split("/")[2]
    const feature = resolve(split[segment] ?? segment, split)
    for (const method of Object.keys(openapi.paths[route]).sort()) {
      const id = `api:${method.toUpperCase()} ${route}`
      cells.push({ id, kind: "api", feature, source: `packages/sdk/openapi.json ${method.toUpperCase()} ${route}`, v2: literals.has(route) ? "literal found on v2" : undefined })
    }
  }

  // hook cells: Kilo hunks in shared upstream files.
  const shared = (await git(["diff", "--diff-filter=M", "--name-only", v1Base, v1Target, "--", "packages"]))
    .split("\n")
    .filter((f) => f && !isKiloOwned(f) && !GENERATED.some((re) => re.test(f)))
  const diff = await git(["diff", "-U0", "--no-color", v1Base, v1Target, "--", ...shared])
  const hunks = parseHunks(diff)
  const bindings = new Map<string, Map<string, string>>()
  const batch = await $`git cat-file --batch < ${new Response(shared.map((f) => `${v1Target}:${f}`).join("\n") + "\n")}`
    .cwd(ROOT)
    .quiet()
    .text()
  let cursor = 0
  for (const f of shared) {
    const end = batch.indexOf("\n", cursor)
    const header = batch.slice(cursor, end)
    cursor = end + 1
    if (header.endsWith(" missing")) continue
    const size = Number(header.split(" ")[2])
    bindings.set(f, importBindings(batch.slice(cursor, cursor + size), split, known))
    cursor += size + 1
  }
  const notCounted = { marker: 0, branding: 0 }
  const attribution = { tag: 0, import: 0, identifier: 0, unattributed: 0 }
  for (const hunk of hunks) {
    const result = classify(hunk, bindings.get(hunk.file) ?? new Map(), split, known)
    if (result.kind !== "cell") {
      notCounted[result.kind]++
      continue
    }
    attribution[result.how]++
    const id = `hook:${result.feature}:${hookId(hunk.added)}`
    cells.push({ id, kind: isTestPath(hunk.file) ? "test" : "hook", feature: result.feature, source: `${hunk.file}:${hunk.line}`, v2: v2Markers.get(id) })
  }

  // dispositions: a decision per cell. Unknown IDs and incomplete entries are errors so the file cannot rot.
  const ids = new Set(cells.map((c) => c.id))
  const stale = Object.keys(dispositions).filter((id) => !ids.has(id))
  if (stale.length) throw new Error(`dispositions.json names cells that do not exist on the v1 target:\n  ${stale.join("\n  ")}`)
  const invalid = Object.entries(dispositions)
    .filter(([, d]) => !["ported", "native", "facade", "dropped"].includes(d.state) || !d.note || !d.by)
    .map(([id]) => id)
  if (invalid.length) throw new Error(`dispositions.json entries need state (ported|native|facade|dropped), note and by:\n  ${invalid.join("\n  ")}`)
  for (const cell of cells) {
    const d = dispositions[cell.id]
    if (!d) continue
    cell.state = d.state
    if (d.v2) cell.v2 = d.v2
  }

  return { cells, notCounted, attribution, shared: shared.length, hunks: hunks.length }
}

type Box = { feature: string; kinds: Record<Kind, { done: number; total: number }>; done: number; total: number; dropped: number; excluded?: string }

function boxes(cells: Cell[], config: Config) {
  const map = new Map<string, Box>()
  for (const cell of cells) {
    const box = map.get(cell.feature) ?? {
      feature: cell.feature,
      kinds: { module: { done: 0, total: 0 }, api: { done: 0, total: 0 }, hook: { done: 0, total: 0 }, test: { done: 0, total: 0 } },
      done: 0,
      total: 0,
      dropped: 0,
      excluded: config.exclude[cell.feature],
    }
    map.set(cell.feature, box)
    if (cell.state === "dropped") {
      box.dropped++
      continue
    }
    const done = cell.v2 !== undefined || cell.state !== undefined
    box.kinds[cell.kind].total++
    box.total++
    if (done) {
      box.kinds[cell.kind].done++
      box.done++
    }
  }
  return [...map.values()].sort((a, b) => byName(a.feature, b.feature))
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const pct = (done: number, total: number) => (total ? Math.round((1000 * done) / total) / 10 : 0)
const bar = (done: number, total: number) => {
  const filled = total ? Math.round((16 * done) / total) : 0
  return "█".repeat(filled) + "░".repeat(16 - filled)
}
const ratio = (k: { done: number; total: number }) => (k.total ? `${k.done}/${k.total}` : "")

function render(config: Config, data: Awaited<ReturnType<typeof collect>>, dispositions: Record<string, Disposition>) {
  const all = boxes(data.cells, config)
  const features = all.filter((b) => !b.excluded && !b.feature.startsWith("unattributed:"))
  const unattributed = all.filter((b) => b.feature.startsWith("unattributed:")).sort((a, b) => b.total - a.total || byName(a.feature, b.feature))
  const excluded = all.filter((b) => b.excluded)
  const counted = [...features, ...unattributed]
  const total = counted.reduce((s, b) => s + b.total, 0)
  const done = counted.reduce((s, b) => s + b.done, 0)
  const dropped = all.reduce((s, b) => s + b.dropped, 0)
  const kinds = (["module", "api", "hook", "test"] as Kind[]).map((k) => ({
    kind: k,
    done: counted.reduce((s, b) => s + b.kinds[k].done, 0),
    total: counted.reduce((s, b) => s + b.kinds[k].total, 0),
  }))
  const droppedCells = data.cells.filter((c) => c.state === "dropped").sort((a, b) => byName(a.id, b.id))
  const doneIds = data.cells
    .filter((c) => c.state !== "dropped" && (c.v2 !== undefined || c.state !== undefined))
    .map((c) => c.id)
    .sort()

  const json = {
    pins: config.pins,
    summary: { done, total, percent: pct(done, total), dropped, kinds },
    notCounted: data.notCounted,
    attribution: data.attribution,
    features: all.map((b) => ({ feature: b.feature, done: b.done, total: b.total, dropped: b.dropped, kinds: b.kinds, excluded: b.excluded })),
    done: doneIds,
    dropped: droppedCells.map((c) => c.id),
  }

  const row = (b: Box) =>
    `| ${b.feature} | ${ratio(b.kinds.module)} | ${ratio(b.kinds.api)} | ${ratio(b.kinds.hook)} | ${ratio(b.kinds.test)} | ${b.done}/${b.total} | ${pct(b.done, b.total)}% | \`${bar(b.done, b.total)}\` |`
  const md = [
    "# Kilo v2 migration progress",
    "",
    `Generated by \`bun script/upstream/progress.ts\`. Do not edit; edit \`features.json\` or \`dispositions.json\` and regenerate. CI fails when this file is stale.`,
    "",
    `Measures Kilo's v1 delta: Kilo \`main\` pinned at \`${config.pins.v1Target.slice(0, 12)}\` (the v1 target) compared with the upstream commit it was synced to, \`${config.pins.v1Base.slice(0, 12)}\` (pins in \`features.json\`). Every Kilo change becomes a cell; a cell is done when the tracked v2 working tree has it.`,
    "",
    `## Summary`,
    "",
    `**${done} / ${total} cells done (${pct(done, total)}%)**, ${dropped} dropped. \`${bar(done, total)}\``,
    "",
    `| Kind | Done | Total | % |`,
    `|---|---:|---:|---:|`,
    ...kinds.map((k) => `| ${k.kind} | ${k.done} | ${k.total} | ${pct(k.done, k.total)}% |`),
    "",
    `Not counted: ${data.notCounted.branding} branding-only hunks (rename script territory), ${data.notCounted.marker} marker-only hunks (block boundaries), generated files. Hook attribution: ${data.attribution.tag} by tag, ${data.attribution.import} by import, ${data.attribution.identifier} by identifier, ${data.attribution.unattributed} unattributed (see below).`,
    "",
    `## Features`,
    "",
    `Cells per kind as done/total. A cell is done when it exists on v2 by the rules below, or has a disposition.`,
    "",
    `| Feature | Modules | API | Hooks | Tests | Done | % | |`,
    `|---|---:|---:|---:|---:|---:|---:|---|`,
    ...features.map(row),
    "",
    `## Unattributed hooks`,
    "",
    `Hunks in shared upstream files with no \`kilocode_change(<feature>)\` tag, no Kilo import and no Kilo identifier, grouped by upstream area. They count in the total. Tag them on \`main\` to move them into a feature box, or give them a disposition.`,
    "",
    `| Area | Hooks | Tests | Done | % |`,
    `|---|---:|---:|---:|---:|`,
    ...unattributed.map((b) => `| ${b.feature.slice("unattributed:".length)} | ${ratio(b.kinds.hook)} | ${ratio(b.kinds.test)} | ${b.done}/${b.total} | ${pct(b.done, b.total)}% |`),
    "",
    `## Excluded`,
    "",
    ...(excluded.length ? excluded.map((b) => `- ${b.feature} (${b.total} cells): ${b.excluded}`) : ["None."]),
    "",
    `## Dropped`,
    "",
    ...(droppedCells.length ? droppedCells.map((c) => `- \`${c.id}\`: ${dispositions[c.id].note} (${dispositions[c.id].by})`) : ["None."]),
    "",
    `## Counting rules`,
    "",
    `- Feature boxes come from the v1 target: directories under \`src/kilocode/\`, \`packages/kilo-*\`, and the split table in \`features.json\`.`,
    `- module: a Kilo-owned v1 file. Done when a tracked Kilo-owned v2 file has the same feature and relative path, or the same feature and basename.`,
    `- api: a \`/kilocode/*\` operation in the v1 OpenAPI document. Done when the path literal appears in \`packages/protocol/src\`, \`packages/server/src\` or a Kilo-owned v2 file.`,
    `- hook: one Kilo hunk in a shared upstream file (\`git diff -U0\` of the v1 target over its upstream base). Its ID hashes the added lines without whitespace and comments. Done when a tracked v2 file carries \`kilocode_change(<feature>:<id>)\`.`,
    `- test: a module or hook in a test file, same rules.`,
    `- A disposition in \`dispositions.json\` overrides: \`ported\`, \`native\` and \`facade\` count as done, \`dropped\` leaves the denominator and is listed above. Every disposition needs a note and an author.`,
    `- Hunks whose only change is a brand rename, and hunks that contain only markers, are not cells.`,
    "",
    `## Terms`,
    "",
    `- cell: one unit of Kilo's v1 delta (a file, an API operation or a hunk). open: not done and no disposition.`,
    `- feature box: the cells of one feature. The feature comes from the v1 path or from \`features.json\`; a tag is always a feature name.`,
    `- area: for unattributed hooks, the upstream directory of the shared file (\`session\`, \`tui/component\`); \`<pkg>/pkg\` means a file outside \`src\`, \`test\` and \`script\`, such as \`package.json\` or a Dockerfile.`,
    `- re-pin: moving \`pins.v1Target\` in \`features.json\` to a newer \`main\` commit, normally in an upstream sync PR. Cells and hook IDs follow the new target.`,
    "",
    `## Working with the map`,
    "",
    `- \`bun script/upstream/progress.ts --list <feature>\` prints the open cells of a feature with their IDs and v1 source lines.`,
    `- To mark a hook ported, put \`kilocode_change(<feature>:<id>)\` on the marker line of the v2 code that replaces it. To record a decision instead, add the cell ID to \`dispositions.json\`.`,
    `- To move an unattributed hook into a feature, tag its marker on \`main\` as \`kilocode_change(<feature>)\`; the next v1 re-pin picks it up.`,
    "",
  ].join("\n")

  return { json: JSON.stringify(json, null, 2) + "\n", md }
}

async function main() {
  const args = process.argv.slice(2)
  const config = await readJson<Config>("features.json")
  const dispositions = await readJson<Record<string, Disposition>>("dispositions.json")
  const data = await collect(config, dispositions)

  const list = args.indexOf("--list")
  if (list >= 0) {
    const feature = args[list + 1]
    const open = data.cells.filter((c) => c.feature === feature && c.v2 === undefined && c.state === undefined)
    for (const c of open.sort((a, b) => byName(a.id, b.id))) console.log(`${c.id}\t${c.source}`)
    console.error(`${open.length} open cells in ${feature}`)
    return
  }

  const out = render(config, data, dispositions)
  const files = { "progress.json": out.json, "README.md": out.md }
  if (args.includes("--check")) {
    const stale = []
    for (const [name, content] of Object.entries(files)) {
      const current = await Bun.file(path.join(DIR, name)).text().catch(() => "")
      if (current !== content) stale.push(name)
    }
    if (stale.length) {
      console.error(`migration-tracking/progress is stale: ${stale.join(", ")}. Run: bun script/upstream/progress.ts`)
      process.exit(1)
    }
    console.log("migration-tracking/progress is up to date")
    return
  }
  for (const [name, content] of Object.entries(files)) await Bun.write(path.join(DIR, name), content)
  const summary = JSON.parse(out.json).summary
  console.log(`${summary.done}/${summary.total} cells done (${summary.percent}%), ${summary.dropped} dropped -> migration-tracking/progress/`)
}

if (import.meta.main) await main()
