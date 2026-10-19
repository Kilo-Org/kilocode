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
 * - patch: one Kilo hunk in a shared upstream file. Its ID is a hash of the added lines. Done when a
 *   v2 file carries a done-proof with the ID: `kilocode_change(<feature>:<id>)` in a shared upstream
 *   file, or `kilo_port(<feature>:<id>)` in a Kilo-owned file. The proof also records the rung where
 *   the cell landed.
 * - test: a module or patch in a test file, same rules.
 * A disposition (`ported`, `native`, `facade`) also marks a cell done; `dropped` removes it from the
 * denominator and lists it.
 *
 * Two ratcheted numbers join the summary: the distinct core-internal upstream modules that Kilo
 * packages and adapters import, and the shared patches by rung in `script/upstream/shared-patches.json`.
 *
 * Usage, from the repository root:
 *   bun script/upstream/progress.ts                 regenerate progress.json and README.md
 *   bun script/upstream/progress.ts --check         exit 1 when the committed output is stale
 *   bun script/upstream/progress.ts --list <feature>  print the open cells of one feature
 *   bun script/upstream/progress.ts --compare <base.json> <head.json> [<pr.diff>]  markdown delta for a PR comment;
 *     with the PR diff (`git diff -U0`), also the placement line of the PR
 */

import { $ } from "bun"
import path from "node:path"
import { readBaseline } from "./utils/baseline"
import { isGenerated, isKiloOwned } from "./utils/owned"
import { coveredLines } from "./utils/shared"

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
type Kind = "module" | "api" | "patch" | "test"
/** Where Kilo code meets upstream (fork conventions): 1 plugin hook, 2 host composition, 3 seam, 4 patch. */
type Rung = 1 | 2 | 3 | 4
const RUNG = { 1: "plugin", 2: "host", 3: "seam", 4: "patch" } as const
type Rungs = Record<(typeof RUNG)[Rung], number>
type Cell = { id: string; kind: Kind; feature: string; source: string; v2?: string; state?: State; rung?: Rung }
/** Rung per shared file, from `script/upstream/shared-patches.json`. */
type SharedRungs = Record<string, { rung: 3 | 4 }>

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

export function patchId(added: string[]) {
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

export type Proof = { id: string; at: string; tag: string; rung: Rung; misplaced: boolean }

/**
 * Done-proofs in `git grep -n -o` output. `kilocode_change(<feature>:<id>)` belongs in a shared upstream file and lands at
 * the rung of that file in shared-patches.json. `kilo_port(<feature>:<id>)` belongs in a Kilo-owned file and lands at
 * rung 2 in the host package (`packages/kilo-cli`), rung 1 elsewhere. A proof in the other kind of file is misplaced.
 */
export function parseProofs(grep: string, rungs: SharedRungs): Proof[] {
  return grep.split("\n").flatMap((line) => {
    const m = line.match(/^([^:]+):(\d+):((kilocode_change|kilo_port)\(([a-z0-9-]+):([0-9a-f]{12})\))$/)
    if (!m) return []
    const owned = isKiloOwned(m[1])
    // A shared file without a shared-patches.json entry fails script/check-shared-patches.ts; count it as rung 4 until then.
    const rung: Rung = owned ? (m[1].startsWith("packages/kilo-cli/") ? 2 : 1) : (rungs[m[1]]?.rung ?? 4)
    return [{ id: `patch:${m[5]}:${m[6]}`, at: `${m[1]}:${m[2]}`, tag: m[3], rung, misplaced: owned !== (m[4] === "kilo_port") }]
  })
}

/** One proof per cell: the highest rung, then the first in path order. A cell proved twice is reported once. */
export function proofByCell(proofs: Proof[]) {
  const best = new Map<string, Proof>()
  for (const p of proofs) if ((best.get(p.id)?.rung ?? 0) < p.rung) best.set(p.id, p)
  return best
}

/**
 * Core-internal upstream modules that Kilo files import (`@opencode/core/*`, or a relative path into `packages/core/src`
 * outside `kilocode/`), as sorted `@opencode/core/<module>` names. Also the imports that break the logic-package rule:
 * `packages/kilo-*-core` imports nothing from `@opencode/*`.
 */
export function scanImports(sources: [file: string, source: string][]) {
  const modules = new Set<string>()
  const violations: string[] = []
  for (const [file, source] of sources) {
    for (const m of source.replace(/^\s*(\/\/|\*).*$/gm, "").matchAll(/\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) {
      const target = m[1].startsWith("@opencode/core/")
        ? `packages/core/src/${m[1].slice("@opencode/core/".length)}`
        : m[1].startsWith(".")
          ? path.posix.join(path.posix.dirname(file), m[1])
          : ""
      const core = target.startsWith("packages/core/src/") && !isKiloOwned(target)
      if (core) modules.add(`@opencode/core/${target.slice("packages/core/src/".length).replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "")}`)
      if (/^packages\/kilo-[^/]+-core\//.test(file) && (core || m[1].startsWith("@opencode/"))) violations.push(`${file}: ${m[1]}`)
    }
  }
  return { modules: [...modules].sort(byName), violations: violations.sort(byName) }
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
  const baseline = await readBaseline(ROOT)
  // Done-proofs of patch cells, from the working tree like the files above.
  const found = parseProofs(await git(["grep", "-n", "-o", "-E", "(kilocode_change|kilo_port)\\([a-z0-9-]+:[0-9a-f]{12}\\)", "--", "packages"]).catch(() => ""), baseline.files)
  const proofs = proofByCell(found)

  // Ratchet: core-internal upstream modules imported by the non-test files of Kilo packages and adapters.
  const adapters = v2Files.filter((f) => /^packages\/(kilo-[^/]+|.+\/src\/kilocode)\//.test(f) && /\.[cm]?[jt]sx?$/.test(f) && !isTestPath(f))
  // A tracked file deleted from the working tree reads as empty, as `git grep` skips it.
  const imports = scanImports(await Promise.all(adapters.map(async (f): Promise<[string, string]> => [f, await Bun.file(path.join(ROOT, f)).text().catch(() => "")])))
  if (imports.violations.length) throw new Error(`logic packages (packages/kilo-*-core) must import nothing from @opencode/*:\n  ${imports.violations.join("\n  ")}`)
  // Ratchet: shared patches by rung.
  const sharedPatches = { seam: 0, patch: 0 }
  for (const entry of Object.values(baseline.files)) sharedPatches[RUNG[entry.rung]]++

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

  // patch cells: Kilo hunks in shared upstream files.
  const shared = (await git(["diff", "--diff-filter=M", "--name-only", v1Base, v1Target, "--", "packages"]))
    .split("\n")
    .filter((f) => f && !isKiloOwned(f) && !GENERATED.some((re) => re.test(f)))
  // An empty pathspec after `--` would diff the whole tree, so skip the diff when no shared file changed.
  const diff = shared.length ? await git(["diff", "-U0", "--no-color", v1Base, v1Target, "--", ...shared]) : ""
  const hunks = parseHunks(diff)
  const bindings = new Map<string, Map<string, string>>()
  const batch = shared.length
    ? await $`git cat-file --batch < ${new Response(shared.map((f) => `${v1Target}:${f}`).join("\n") + "\n")}`.cwd(ROOT).quiet().text()
    : ""
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
    const id = `patch:${result.feature}:${patchId(hunk.added)}`
    const proof = proofs.get(id)
    cells.push({ id, kind: isTestPath(hunk.file) ? "test" : "patch", feature: result.feature, source: `${hunk.file}:${hunk.line}`, v2: proof?.at, rung: proof?.rung })
  }

  // Done-proofs and dispositions name cells. Unknown IDs and misplaced or incomplete entries are errors so they cannot rot.
  const ids = new Set(cells.map((c) => c.id))
  const unknown = found.filter((p) => !ids.has(p.id)).map((p) => `${p.at}: ${p.tag}`)
  if (unknown.length) throw new Error(`done-proofs name cells that do not exist on the v1 target:\n  ${unknown.join("\n  ")}`)
  const misplaced = found.filter((p) => p.misplaced).map((p) => `${p.at}: ${p.tag}`)
  if (misplaced.length)
    throw new Error(`done-proofs in the wrong kind of file (kilocode_change in shared upstream files, kilo_port in Kilo-owned files):\n  ${misplaced.join("\n  ")}`)
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

  return { cells, notCounted, attribution, shared: shared.length, hunks: hunks.length, coreImports: imports.modules, sharedPatches }
}

type Box = { feature: string; kinds: Record<Kind, { done: number; total: number }>; done: number; total: number; dropped: number; landed: Rungs; excluded?: string }

function boxes(cells: Cell[], config: Config) {
  const map = new Map<string, Box>()
  for (const cell of cells) {
    const box = map.get(cell.feature) ?? {
      feature: cell.feature,
      kinds: { module: { done: 0, total: 0 }, api: { done: 0, total: 0 }, patch: { done: 0, total: 0 }, test: { done: 0, total: 0 } },
      done: 0,
      total: 0,
      dropped: 0,
      landed: { plugin: 0, host: 0, seam: 0, patch: 0 },
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
    if (cell.rung) box.landed[RUNG[cell.rung]]++
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
/** `31 plugin, 2 seam, 1 patch`. Zero counts are left out unless `all` is set. */
const rungText = (counts: Partial<Rungs>, all = false) =>
  Object.entries(counts)
    .filter(([, v]) => all || v)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ")

// Treemap: squarified boxes per feature, a grid of cells inside each box,
// green for done, grey for open, yellow for dropped. Boxes above CAP cells draw CAP cells that each stand for
// several, so the file stays small enough to commit. The legend row names the colors and the landed rungs.
const PANEL = 495
const GAP = 10
const HEADER = 30
const MAP = 280
const LEGEND = 24
const CAP = 200
type Rect = [number, number, number, number]

export function squarify(values: number[], x: number, y: number, w: number, h: number) {
  const scale = (w * h) / values.reduce((a, b) => a + b, 0)
  const areas = values.map((v) => v * scale)
  const rects: Rect[] = []
  const worst = (row: number[], side: number) => {
    const area = row.reduce((a, b) => a + b, 0)
    return Math.max(...row.map((r) => Math.max((side * side * r) / (area * area), (area * area) / (side * side * r))))
  }
  const place = (row: number[]) => {
    const thickness = row.reduce((a, b) => a + b, 0) / Math.min(w, h)
    let offset = 0
    for (const area of row) {
      const length = area / thickness
      rects.push(w >= h ? [x, y + offset, thickness, length] : [x + offset, y, length, thickness])
      offset += length
    }
    if (w >= h) {
      x += thickness
      w -= thickness
    } else {
      y += thickness
      h -= thickness
    }
  }
  let row: number[] = []
  while (areas.length) {
    const side = Math.min(w, h)
    if (!row.length || worst([...row, areas[0]], side) <= worst(row, side)) {
      row.push(areas.shift()!)
      continue
    }
    place(row)
    row = []
  }
  if (row.length) place(row)
  return rects
}

export function grid(count: number, x: number, y: number, w: number, h: number) {
  if (!count || w <= 0 || h <= 0) return [] as Rect[]
  const rows = Math.max(1, Math.min(count, Math.round(Math.sqrt((count * h) / w))))
  const result: Rect[] = []
  for (let r = 0; r < rows; r++) {
    const inRow = Math.floor(count / rows) + (r < count % rows ? 1 : 0)
    const cw = w / inRow
    for (let c = 0; c < inRow; c++) result.push([x + c * cw, y + (r * h) / rows, cw, h / rows])
  }
  return result
}

const n = (v: number) => v.toFixed(2)
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")
const label = (x: number, y: number, text: string, size: number) =>
  `<text x="${n(x)}" y="${n(y)}" font-size="${size}">${esc(text)}</text>`

function panel(title: string, items: Box[], left: number) {
  const shown = items.filter((b) => b.total + b.dropped > 0).sort((a, b) => b.total + b.dropped - (a.total + a.dropped) || byName(a.feature, b.feature))
  const done = shown.reduce((s, b) => s + b.done, 0)
  const total = shown.reduce((s, b) => s + b.total, 0)
  const parts = [label(left + 4, 21, `${title}: ${pct(done, total)}% (${done}/${total})`, 16)]
  if (!shown.length) return parts
  const rects = squarify(shown.map((b) => b.total + b.dropped), left, HEADER, PANEL, MAP)
  shown.forEach((box, i) => {
    const [x, y, w, h] = rects[i]
    const all = box.total + box.dropped
    const cells = Math.min(all, CAP)
    const doneCells = Math.round((cells * box.done) / all)
    const droppedCells = Math.round((cells * box.dropped) / all)
    const name = box.feature.replace(/^unattributed:/, "")
    parts.push(`<g><title>${esc(name)}: ${box.done}/${box.total} (${pct(box.done, box.total)}%)${box.dropped ? `, ${box.dropped} dropped` : ""}</title>`)
    grid(cells, x + 1, y + 1, w - 2, h - 2).forEach(([cx, cy, cw, ch], j) => {
      const cls = j < doneCells ? "d" : j >= cells - droppedCells ? "x" : "o"
      parts.push(`<rect class="${cls}" x="${n(cx)}" y="${n(cy)}" width="${n(cw)}" height="${n(ch)}"/>`)
    })
    parts.push(`<rect class="b" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`)
    const text = name.slice(0, Math.max(0, Math.floor((w - 10) / 7)))
    if ((text === name || text.length >= 3) && h > 22) parts.push(label(x + 5, y + 16, text, 12))
    parts.push("</g>")
  })
  return parts
}

function svg(features: Box[], unattributed: Box[], landed: Rungs) {
  const width = 2 * PANEL + GAP
  const height = HEADER + MAP + LEGEND
  const y = HEADER + MAP + 6
  const swatch = (x: number, cls: string, text: string) => `<rect class="${cls}" x="${x}" y="${y}" width="12" height="12"/>${label(x + 16, y + 11, text, 12)}`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<style>rect{stroke:#0d1117;stroke-width:.5}.d{fill:#2ea043}.o{fill:#6e7681}.x{fill:#d29922}.b{fill:none;stroke-width:2}text{font-family:sans-serif;fill:#fff;stroke:#0d1117;stroke-width:3;paint-order:stroke}</style>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#0d1117" stroke="none"/>`,
    ...panel("Features", features, 0),
    ...panel("Unattributed patches by upstream area", unattributed, PANEL + GAP),
    swatch(4, "d", "done"),
    swatch(60, "o", "open"),
    swatch(112, "x", "dropped"),
    label(190, y + 11, `Landed by rung: ${rungText(landed, true)}`, 12),
    "</svg>",
    "",
  ].join("\n")
}

function badge(label: string, percent: number) {
  const value = `${percent}%`
  const color = percent >= 90 ? "#4c1" : percent >= 60 ? "#97ca00" : percent >= 30 ? "#dfb317" : "#fe7d37"
  const left = 10 + 7 * label.length
  const right = 10 + 7 * value.length
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${left + right}" height="20" role="img" aria-label="${label}: ${value}">`,
    `<rect width="${left}" height="20" fill="#555"/><rect x="${left}" width="${right}" height="20" fill="${color}"/>`,
    `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">`,
    `<text x="${left / 2}" y="14">${esc(label)}</text><text x="${left + right / 2}" y="14">${value}</text></g></svg>`,
    "",
  ].join("\n")
}

/** The committed progress.json shape that `--compare` reads. */
export type Snapshot = {
  summary?: { done: number; total: number; percent: number; dropped: number; coreImports?: number; sharedPatches?: { seam: number; patch: number } }
  features?: { feature: string; done: number; total: number; dropped: number; kinds: Record<Kind, { done: number; total: number }> }[]
  coreImports?: string[]
  done?: string[]
  dropped?: string[]
}

export type Placement = { marked: Rungs; ports: number }

/**
 * Placement of a PR, from its diff (`git diff -U0`) and the head text of the shared files it touches: new marked lines in
 * shared upstream files by rung (shared-patches.json), with the same marker rules as script/check-shared-patches.ts, and
 * new `kilo_port(<feature>:<id>)` annotations in Kilo-owned files under `packages/`.
 */
export function placement(diff: string, contents: Map<string, string>, rungs: SharedRungs): Placement {
  const hunks = parseHunks(diff)
  const fresh = new Set([...diff.matchAll(/^diff --git a\/.* b\/(.*)\nnew file mode/gm)].map((m) => m[1]))
  const marked = { plugin: 0, host: 0, seam: 0, patch: 0 }
  for (const file of new Set(hunks.map((h) => h.file))) {
    const text = contents.get(file)
    if (text === undefined || isKiloOwned(file) || isGenerated(file)) continue
    const covered = coveredLines(text.split(/\r?\n/), fresh.has(file))
    const count = hunks.filter((h) => h.file === file).reduce((s, h) => s + h.added.filter((l, i) => l.trim() !== "" && covered.has(h.line + i)).length, 0)
    marked[RUNG[rungs[file]?.rung ?? 4]] += count
  }
  const ports = hunks
    .filter((h) => h.file.startsWith("packages/") && isKiloOwned(h.file))
    .reduce((s, h) => s + (h.added.join("\n").match(/kilo_port\([a-z0-9-]+:[0-9a-f]{12}\)/g)?.length ?? 0), 0)
  return { marked, ports }
}

/** Markdown delta between two progress.json files, for the PR comment. Deterministic and self-contained. */
export function compare(base: Snapshot, head: Snapshot, place?: Placement) {
  const b = base.summary ?? { done: 0, total: 0, percent: 0, dropped: 0 }
  const h = head.summary ?? { done: 0, total: 0, percent: 0, dropped: 0 }
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)
  const before = new Map((base.features ?? []).map((f) => [f.feature, f]))
  const after = new Map((head.features ?? []).map((f) => [f.feature, f]))
  const names = [...new Set([...before.keys(), ...after.keys()])].sort(byName)
  const kinds: Kind[] = ["module", "api", "patch", "test"]
  const plural = (k: string, v: number) => (Math.abs(v) === 1 ? k : k.endsWith("ch") ? `${k}es` : `${k}s`)
  const rows = names.flatMap((name) => {
    const x = before.get(name)
    const y = after.get(name)
    if (x && y && x.done === y.done && x.total === y.total && x.dropped === y.dropped) return []
    const changes = kinds
      .map((k) => {
        const d = (y?.kinds[k].done ?? 0) - (x?.kinds[k].done ?? 0)
        const t = (y?.kinds[k].total ?? 0) - (x?.kinds[k].total ?? 0)
        return [d ? `${sign(d)} ${plural(k, d)} done` : "", t ? `${sign(t)} ${plural(k, t)} total` : ""].filter(Boolean).join(", ")
      })
      .filter(Boolean)
    const dropped = (y?.dropped ?? 0) - (x?.dropped ?? 0)
    if (dropped) changes.push(`${sign(dropped)} dropped`)
    const cell = (f?: { done: number; total: number }) => (f ? `${f.done}/${f.total}` : "")
    return [`| ${name} | ${cell(x)} | ${cell(y)} | ${changes.join("; ") || "new box"} |`]
  })
  const baseDone = new Set(base.done ?? [])
  const headDone = new Set(head.done ?? [])
  const closed = [...headDone].filter((id) => !baseDone.has(id)).sort(byName)
  const reopened = [...baseDone].filter((id) => !headDone.has(id)).sort(byName)
  const baseDropped = new Set(base.dropped ?? [])
  const dropped = (head.dropped ?? []).filter((id) => !baseDropped.has(id)).sort(byName)
  const list = (title: string, ids: string[]) =>
    ids.length ? ["", `<details><summary>${ids.length} ${title}</summary>`, "", ...ids.slice(0, 100).map((id) => `- \`${id}\``), ...(ids.length > 100 ? [`- ... ${ids.length - 100} more`] : []), "", "</details>"] : []
  const icon = h.percent > b.percent ? "📈" : h.percent < b.percent ? "📉" : "➖"
  const lines = [
    `${icon} **v2 migration progress: ${b.percent}% → ${h.percent}%** (${sign(h.done - b.done)} done, ${sign(h.total - b.total)} total, ${sign(h.dropped - b.dropped)} dropped; ${h.done}/${h.total} cells)`,
  ]
  if (place) {
    const marked = Object.values(place.marked).reduce((s, v) => s + v, 0)
    const known = base.coreImports
    const added = known && (head.coreImports ?? []).filter((m) => !known.includes(m))
    const imports = added
      ? `${added.length} new core-internal ${plural("import", added.length)}${added.length ? ` (${added.map((m) => `\`${m}\``).join(", ")})` : ""}`
      : "core-internal imports not compared (the base map has no import list)"
    lines.push(
      "",
      `**Placement:** ${marked} new marked ${plural("line", marked)} in shared files${marked ? ` (${rungText(place.marked)})` : ""}, ${place.ports} new \`kilo_port\` ${plural("annotation", place.ports)}, ${imports}.`,
    )
  }
  const shared = (s?: { seam: number; patch: number }) => (s ? rungText(s, true) : "n/a")
  lines.push(
    "",
    `**Ratchets:** ${head.summary?.coreImports ?? "n/a"} core-internal imports (base ${base.summary?.coreImports ?? "n/a"}); shared patches by rung ${shared(head.summary?.sharedPatches)} (base ${shared(base.summary?.sharedPatches)}).`,
  )
  if (!rows.length && !closed.length && !reopened.length && !dropped.length) return [...lines, "", "No change to the progress map.", ""].join("\n")
  if (rows.length) lines.push("", "| Feature | Before | After | Change |", "|---|---:|---:|---|", ...rows)
  lines.push(...list("cells closed", closed), ...list("cells reopened (were done on the base)", reopened), ...list("cells dropped", dropped), "")
  return lines.join("\n")
}

type Point = { date: string; done: number; total: number; percent: number }

/**
 * Past states from the committed progress.json files on the first-parent history, one point per day
 * (the last commit of the day). A commit whose file equals the current output is skipped, so the result
 * is the same before and after the commit that stores it, which keeps `--check` stable.
 */
async function history(current: string) {
  const log = await git(["log", "--first-parent", "--format=%H %cs", "--", "migration-tracking/progress/progress.json"]).catch(() => "")
  const points: Point[] = []
  const seen = new Set<string>()
  for (const line of log.split("\n").filter(Boolean)) {
    const [sha, date] = line.split(" ")
    if (seen.has(date)) continue
    const text = await git(["show", `${sha}:migration-tracking/progress/progress.json`]).catch(() => "")
    if (!text || text + "\n" === current) continue
    const summary = (JSON.parse(text) as { summary: { done: number; total: number; percent: number } }).summary
    seen.add(date)
    points.push({ date, done: summary.done, total: summary.total, percent: summary.percent })
  }
  return points.reverse()
}

function chart(points: Point[]) {
  const width = 2 * PANEL + GAP
  const height = 200
  const left = 40
  const top = 20
  const w = width - left - 10
  const h = height - top - 30
  const x = (i: number) => left + (points.length > 1 ? (i * w) / (points.length - 1) : w / 2)
  const y = (p: number) => top + h - (h * p) / 100
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<style>text{font-family:sans-serif;font-size:11px;fill:#8b949e}.l{stroke:#30363d;stroke-width:1}.p{fill:none;stroke:#2ea043;stroke-width:2}.m{fill:#2ea043}</style>`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#0d1117"/>`,
    ...[0, 25, 50, 75, 100].map((v) => `<line class="l" x1="${left}" y1="${n(y(v))}" x2="${width - 10}" y2="${n(y(v))}"/><text x="4" y="${n(y(v) + 4)}">${v}%</text>`),
  ]
  if (points.length) {
    parts.push(`<polyline class="p" points="${points.map((p, i) => `${n(x(i))},${n(y(p.percent))}`).join(" ")}"/>`)
    const step = Math.max(1, Math.ceil(points.length / 12))
    points.forEach((p, i) => {
      parts.push(`<circle class="m" cx="${n(x(i))}" cy="${n(y(p.percent))}" r="3"><title>${p.date}: ${p.percent}% (${p.done}/${p.total})</title></circle>`)
      if (i % step === 0 || i === points.length - 1) parts.push(`<text x="${n(x(i))}" y="${height - 8}" text-anchor="middle">${p.date}</text>`)
    })
  }
  parts.push("</svg>", "")
  return parts.join("\n")
}

function render(config: Config, data: Awaited<ReturnType<typeof collect>>, dispositions: Record<string, Disposition>, past: Point[] = []) {
  const all = boxes(data.cells, config)
  const features = all.filter((b) => !b.excluded && !b.feature.startsWith("unattributed:"))
  const unattributed = all.filter((b) => b.feature.startsWith("unattributed:")).sort((a, b) => b.total - a.total || byName(a.feature, b.feature))
  const excluded = all.filter((b) => b.excluded)
  const counted = [...features, ...unattributed]
  const total = counted.reduce((s, b) => s + b.total, 0)
  const done = counted.reduce((s, b) => s + b.done, 0)
  const dropped = all.reduce((s, b) => s + b.dropped, 0)
  const kinds = (["module", "api", "patch", "test"] as Kind[]).map((k) => ({
    kind: k,
    done: counted.reduce((s, b) => s + b.kinds[k].done, 0),
    total: counted.reduce((s, b) => s + b.kinds[k].total, 0),
  }))
  const droppedCells = data.cells.filter((c) => c.state === "dropped").sort((a, b) => byName(a.id, b.id))
  const doneIds = data.cells
    .filter((c) => c.state !== "dropped" && (c.v2 !== undefined || c.state !== undefined))
    .map((c) => c.id)
    .sort()
  const landed = { plugin: 0, host: 0, seam: 0, patch: 0 }
  for (const b of counted) for (const r of Object.values(RUNG)) landed[r] += b.landed[r]

  const json = {
    pins: config.pins,
    summary: { done, total, percent: pct(done, total), dropped, kinds, landed, coreImports: data.coreImports.length, sharedPatches: data.sharedPatches },
    notCounted: data.notCounted,
    attribution: data.attribution,
    coreImports: data.coreImports,
    features: all.map((b) => ({
      feature: b.feature,
      done: b.done,
      total: b.total,
      dropped: b.dropped,
      kinds: b.kinds,
      landed: Object.values(b.landed).some(Boolean) ? b.landed : undefined,
      excluded: b.excluded,
    })),
    landed: Object.fromEntries(
      data.cells.flatMap((c) => (c.rung && c.state !== "dropped" ? [[c.id, RUNG[c.rung]]] : [])).sort(([a], [b]) => byName(a, b)),
    ),
    done: doneIds,
    dropped: droppedCells.map((c) => c.id),
  }

  const points = [...past, { date: "now", done, total, percent: pct(done, total) }]
  const row = (b: Box) =>
    `| ${b.feature} | ${ratio(b.kinds.module)} | ${ratio(b.kinds.api)} | ${ratio(b.kinds.patch)} | ${ratio(b.kinds.test)} | ${b.done}/${b.total} | ${pct(b.done, b.total)}% | \`${bar(b.done, b.total)}\` | ${rungText(b.landed)} |`
  const imports = data.coreImports.length ? ` (${data.coreImports.map((m) => `\`${m}\``).join(", ")})` : ""
  const md = [
    "# Kilo v2 migration progress",
    "",
    `Generated by \`bun script/upstream/progress.ts\`. Do not edit; edit \`features.json\` or \`dispositions.json\` and regenerate. CI fails when this file is stale.`,
    "",
    `Measures Kilo's v1 delta: Kilo \`main\` pinned at \`${config.pins.v1Target.slice(0, 12)}\` (the v1 target) compared with the upstream commit it was synced to, \`${config.pins.v1Base.slice(0, 12)}\` (pins in \`features.json\`). Every Kilo change becomes a cell; a cell is done when the tracked v2 working tree has it.`,
    "",
    `![Progress map: one box per feature sized by its cells, green done, grey open, yellow dropped](progress.svg)`,
    "",
    `## Summary`,
    "",
    `**${done} / ${total} cells done (${pct(done, total)}%)**, ${dropped} dropped. \`${bar(done, total)}\``,
    "",
    `| Kind | Done | Total | % |`,
    `|---|---:|---:|---:|`,
    ...kinds.map((k) => `| ${k.kind} | ${k.done} | ${k.total} | ${pct(k.done, k.total)}% |`),
    "",
    `Not counted: ${data.notCounted.branding} branding-only hunks (rename script territory), ${data.notCounted.marker} marker-only hunks (block boundaries), generated files. Patch attribution: ${data.attribution.tag} by tag, ${data.attribution.import} by import, ${data.attribution.identifier} by identifier, ${data.attribution.unattributed} unattributed (see below).`,
    "",
    `Landed by rung, for patch cells closed by a done-proof: ${rungText(landed, true)}.`,
    "",
    `Ratchets: ${data.coreImports.length} core-internal upstream modules imported by Kilo packages and adapters${imports}; ${data.sharedPatches.seam + data.sharedPatches.patch} shared patches by rung: ${rungText(data.sharedPatches, true)} (\`script/upstream/shared-patches.json\`).`,
    "",
    `## History`,
    "",
    `![Progress history](history.svg)`,
    "",
    `One point per day from the committed \`progress.json\` on the first-parent history, plus the current state.`,
    "",
    `| Date | Done | Total | % |`,
    `|---|---:|---:|---:|`,
    ...points.slice(-30).map((p) => `| ${p.date} | ${p.done} | ${p.total} | ${p.percent}% |`),
    "",
    `## Features`,
    "",
    `Cells per kind as done/total. A cell is done when it exists on v2 by the rules below, or has a disposition. Landed: the rungs of the done-proofs.`,
    "",
    `| Feature | Modules | API | Patches | Tests | Done | % | | Landed |`,
    `|---|---:|---:|---:|---:|---:|---:|---|---|`,
    ...features.map(row),
    "",
    `## Unattributed patches`,
    "",
    `Hunks in shared upstream files with no \`kilocode_change(<feature>)\` tag, no Kilo import and no Kilo identifier, grouped by upstream area. They count in the total. Tag them on \`main\` to move them into a feature box, or give them a disposition.`,
    "",
    `| Area | Patches | Tests | Done | % |`,
    `|---|---:|---:|---:|---:|`,
    ...unattributed.map((b) => `| ${b.feature.slice("unattributed:".length)} | ${ratio(b.kinds.patch)} | ${ratio(b.kinds.test)} | ${b.done}/${b.total} | ${pct(b.done, b.total)}% |`),
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
    `- patch: one Kilo hunk in a shared upstream file (\`git diff -U0\` of the v1 target over its upstream base). Its ID hashes the added lines without whitespace and comments. Done when a tracked v2 file under \`packages/\` carries a done-proof with the ID: \`kilocode_change(<feature>:<id>)\` in a shared upstream file, \`kilo_port(<feature>:<id>)\` in a Kilo-owned file. A proof with an unknown ID, or in the wrong kind of file, fails the run.`,
    `- test: a module or patch in a test file, same rules.`,
    `- landed: the rung of the done-proof. \`kilo_port\` is rung 2 (host) in \`packages/kilo-cli\` and rung 1 (plugin) in other Kilo-owned files; a marker has the rung of its file in \`script/upstream/shared-patches.json\` (3 seam, 4 patch). A cell with more than one proof counts once, at the highest rung.`,
    `- Ratchets: core-internal imports count the distinct modules in \`packages/core/src\` outside \`kilocode/\` that non-test files in \`packages/kilo-*\` and \`packages/*/src/kilocode\` import, as \`@opencode/core/*\` or by relative path. A non-test file of a logic package (\`packages/kilo-*-core\`) that imports anything from \`@opencode/*\` fails the run. Shared patches by rung count the entries in \`shared-patches.json\`.`,
    `- A disposition in \`dispositions.json\` overrides: \`ported\`, \`native\` and \`facade\` count as done, \`dropped\` leaves the denominator and is listed above. Every disposition needs a note and an author. A module ported under another name needs \`ported\` with the v2 path.`,
    `- A proof or a disposition says that v2 has the behavior. Close a cell only after you compare the v1 code with v2; a cell with a known gap stays open. \`dropped\` is for behavior that is not carried (a shim, dead v1 code, or a decision the plan records), not for behavior that a later unit ports. Rules: \`.kilo/skills/v2-migration/SKILL.md\`, section "Progress map".`,
    `- Hunks whose only change is a brand rename, and hunks that contain only markers, are not cells.`,
    "",
    `## Terms`,
    "",
    `- cell: one unit of Kilo's v1 delta (a file, an API operation or a hunk). open: not done and no disposition.`,
    `- feature box: the cells of one feature. The feature comes from the v1 path or from \`features.json\`; a tag is always a feature name.`,
    `- area: for unattributed patches, the upstream directory of the shared file (\`session\`, \`tui/component\`); \`<pkg>/pkg\` means a file outside \`src\`, \`test\` and \`script\`, such as \`package.json\` or a Dockerfile.`,
    `- re-pin: moving \`pins.v1Target\` in \`features.json\` to a newer \`main\` commit, normally in an upstream sync PR. Cells and patch IDs follow the new target.`,
    `- rung: where Kilo code meets upstream (fork conventions): 1 plugin hook, 2 host composition, 3 seam, 4 patch.`,
    "",
    `## Working with the map`,
    "",
    `- \`bun script/upstream/progress.ts --list <feature>\` prints the open cells of a feature with their IDs and v1 source lines.`,
    `- To mark a patch ported, put its ID on the v2 code that replaces it: \`kilocode_change(<feature>:<id>)\` on a marked line in a shared upstream file, \`kilo_port(<feature>:<id>)\` in a Kilo-owned file. To record a decision instead, add the cell ID to \`dispositions.json\`.`,
    `- To move an unattributed patch into a feature, tag its marker on \`main\` as \`kilocode_change(<feature>)\`; the next v1 re-pin picks it up.`,
    "",
  ].join("\n")

  return { json: JSON.stringify(json, null, 2) + "\n", md, svg: svg(features, unattributed, landed), history: chart(points), badge: badge("v2 migration", pct(done, total)) }
}

async function main() {
  const args = process.argv.slice(2)
  const cmp = args.indexOf("--compare")
  if (cmp >= 0) {
    // One-time mapping: a base snapshot written before the cell kind `hook` became `patch` uses the old kind and ID prefix.
    const read = async (file: string) => ((await Bun.file(file).text().catch(() => "")) || "{}").replaceAll('"hook"', '"patch"').replaceAll('"hook:', '"patch:')
    const base = JSON.parse(await read(args[cmp + 1])) as Snapshot
    const head = JSON.parse(await read(args[cmp + 2])) as Snapshot
    if (!args[cmp + 3]) {
      console.log(compare(base, head))
      return
    }
    // The placement line reads the shared files the PR touches from the working tree, which is the head of the PR.
    const diff = await Bun.file(args[cmp + 3]).text()
    const shared = [...new Set(parseHunks(diff).map((h) => h.file))].filter((f) => !isKiloOwned(f))
    const contents = new Map(await Promise.all(shared.map(async (f): Promise<[string, string]> => [f, await Bun.file(path.join(ROOT, f)).text().catch(() => "")])))
    console.log(compare(base, head, placement(diff, contents, (await readBaseline(ROOT)).files)))
    return
  }
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

  const past = await history(render(config, data, dispositions).json)
  const out = render(config, data, dispositions, past)
  const files = { "progress.json": out.json, "README.md": out.md, "progress.svg": out.svg, "history.svg": out.history, "badge.svg": out.badge }
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
