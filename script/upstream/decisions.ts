#!/usr/bin/env bun
/**
 * Manual upstream merge decision ledger.
 *
 * Captures the conflict snapshot that remains after automation stops, then
 * records the rationale for each human/agent resolution so PR reviewers can
 * audit the manual part of an upstream merge.
 */

import { dirname, join } from "node:path"
import { mkdir } from "node:fs/promises"
import { loadConfig } from "./utils/config"
import { getRecommendation } from "./utils/report"
import * as log from "./utils/logger"

interface RunResult {
  exitCode: number
  stdout: string
}

// Use Bun.spawn instead of Bun's $ shell template. The $ template hangs
// after ~10 sequential invocations when filenames contain glob-like
// characters (e.g. `[channel]`, `[platform]`), silently killing the
// process without an error. Direct spawn avoids the shell entirely.
async function run(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  return { exitCode, stdout }
}

type Kind = "hybrid" | "take-ours" | "take-theirs" | "regenerated" | "removed" | "renamed" | "other"
type Risk = "low" | "medium" | "high"

interface Side {
  present: boolean
  hash?: string
  preview?: string
  full?: string
}

interface Item {
  file: string
  status: string
  type: string
  recommendation: string
  reason: string
  conflict?: string
  base: Side
  ours: Side
  theirs: Side
}

interface Choice {
  file: string
  kind?: Kind
  risk?: Risk
  plan?: string
  summary?: string
  rationale?: string
  alternatives: string[]
  verification: string[]
  notes?: string
  target?: string
  resolved?: string
  resolution?: string
  updated: string
}

interface Resolved extends Choice {
  resolved?: string
}

interface Ledger {
  schema: 1
  generated: string
  updated: string
  version: string
  upstreamCommit?: string
  baseBranch: string
  mergeBranch: string
  report?: string
  files: Item[]
  decisions: Choice[]
}

export interface InitOptions {
  version: string
  upstreamCommit?: string
  baseBranch?: string
  mergeBranch?: string
  report?: string
  output?: string
  ledger?: string
  force?: boolean
  files?: string[]
}

interface CliOptions extends InitOptions {
  file?: string
  kind?: Kind
  risk?: Risk
  plan?: string
  summary?: string
  rationale?: string
  notes?: string
  target?: string
  resolution?: string
  alternatives: string[]
  verification: string[]
  write: boolean
}

type Snap = Pick<Choice, "file" | "kind" | "target">

const kinds: Kind[] = ["hybrid", "take-ours", "take-theirs", "regenerated", "removed", "renamed", "other"]
const risks: Risk[] = ["low", "medium", "high"]

async function root() {
  const res = await run(["git", "rev-parse", "--show-toplevel"])
  if (res.exitCode !== 0) throw new Error("not inside a git repository")
  return res.stdout.trim()
}

async function setup() {
  process.chdir(await root())
}

function slug(ver: string) {
  return ver
    .replace(/^refs\/tags\//, "")
    .replace(/^v(?=\d)/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
}

function paths(opts: Pick<InitOptions, "version" | "output" | "ledger">) {
  if (opts.ledger) {
    return {
      json: opts.ledger,
      md: opts.ledger.endsWith(".json") ? opts.ledger.slice(0, -5) + ".md" : opts.ledger + ".md",
    }
  }
  const dir = opts.output ?? "script/upstream/reports"
  const name = `manual-decisions-${slug(opts.version)}`
  return { json: join(dir, `${name}.json`), md: join(dir, `${name}.md`) }
}

async function sha(text: string) {
  const buf = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12)
}

function clip(text: string, size = 12000) {
  const body = text.trimEnd()
  if (body.length <= size) return body
  return `${body.slice(0, size).trimEnd()}\n\n... truncated after ${size} characters ...`
}

function preview(text: string) {
  return clip(text.split("\n").slice(0, 40).join("\n"), 4000)
}

function hunks(text: string) {
  const lines = text.split("\n")
  const out: string[] = []
  const state = { open: false }
  for (const line of lines) {
    if (line.startsWith("<<<<<<< ")) state.open = true
    if (state.open) out.push(line)
    if (state.open && line.startsWith(">>>>>>> ")) {
      state.open = false
      out.push("")
    }
  }
  const body = out.join("\n").trimEnd()
  if (!body) return undefined
  return clip(body, 16000)
}

function diff3(entry: Item) {
  if (entry.conflict) return entry.conflict
  const name = `diff3 snapshot for ${entry.file}`
  const lines = [`<<<<<<< ours (${entry.ours.present ? "present" : "deleted"} in Kilo)`]
  lines.push(entry.ours.preview ?? "[not present]")
  if (entry.base.present) {
    lines.push(`||||||| base (${name})`)
    lines.push(entry.base.preview ?? "[not present]")
  }
  lines.push(`=======`, entry.theirs.preview ?? "[not present]", `>>>>>>> theirs (${name})`)
  return clip(lines.join("\n"), 16000)
}

async function side(file: string, stage: 1 | 2 | 3): Promise<Side> {
  const res = await run(["git", "show", `:${stage}:${file}`])
  if (res.exitCode !== 0 || res.stdout.length === 0) return { present: false }
  const text = res.stdout
  // Keep full ours content (clipped) so we can diff the resolution against it
  // at add-time. base/theirs don't need the full content for review.
  const keep = stage === 2 ? clip(text, 64000) : undefined
  return { present: true, hash: await sha(text), preview: preview(text), full: keep }
}

async function read(file: string) {
  const ok = await Bun.file(file).exists()
  if (!ok) return undefined
  const text = await Bun.file(file).text()
  return JSON.parse(text) as Ledger
}

async function write(file: string, ledger: Ledger) {
  await mkdir(dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(ledger, null, 2) + "\n")
}

async function branch() {
  const res = await run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
  return res.exitCode === 0 ? res.stdout.trim() : ""
}

async function status() {
  const res = await run(["git", "status", "--porcelain"])
  const map = new Map<string, string>()
  for (const line of res.stdout.split("\n")) {
    if (!line) continue
    const file = line.startsWith("?? ") ? line.slice(3) : (line.slice(3).split(" -> ").at(-1) ?? line.slice(3))
    map.set(file, line.slice(0, 2))
  }
  return map
}

async function conflict(file: string) {
  const ok = await Bun.file(file).exists()
  if (!ok) return undefined
  const text = await Bun.file(file)
    .text()
    .catch(() => "")
  return hunks(text)
}

async function conflicts() {
  const res = await run(["git", "diff", "--name-only", "--diff-filter=U"])
  return res.stdout
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
}

function type(status: string) {
  const key: Record<string, string> = {
    UU: "content",
    AA: "add/add",
    DD: "delete/delete",
    AU: "added by us",
    UA: "added by upstream",
    DU: "deleted by us",
    UD: "deleted by upstream",
  }
  return key[status] ?? "unmerged"
}

async function item(file: string, status: string): Promise<Item> {
  const ours = await side(file, 2)
  const config = loadConfig()
  const res = ours.present ? await run(["git", "show", `:2:${file}`]) : undefined
  const text = res?.exitCode === 0 ? res.stdout : ""
  const rec = getRecommendation(file, config.keepOurs, config.skipFiles, text)
  return {
    file,
    status,
    type: type(status),
    recommendation: rec.recommendation,
    reason: rec.reason,
    conflict: await conflict(file),
    base: await side(file, 1),
    ours,
    theirs: await side(file, 3),
  }
}

function choice(file: string): Choice {
  return { file, alternatives: [], verification: [], updated: new Date().toISOString() }
}

function merge(prev: Choice | undefined, next: Choice) {
  if (!prev) return next
  return {
    ...prev,
    ...next,
    alternatives: [...new Set([...prev.alternatives, ...next.alternatives])],
    verification: [...new Set([...prev.verification, ...next.verification])],
  }
}

export async function initLedger(opts: InitOptions) {
  await setup()
  const out = paths(opts)
  const prev = opts.force ? undefined : await read(out.json)
  const map = new Map((prev?.decisions ?? []).map((entry) => [entry.file, entry]))
  const stats = await status()
  const files = opts.files ?? (await conflicts())
  if (files.length === 0) throw new Error("no unresolved merge conflicts found")
  // Process sequentially to avoid overwhelming the subprocess pool.
  const items: Item[] = []
  for (const file of files) {
    items.push(await item(file, stats.get(file) ?? "UU"))
  }
  const now = new Date().toISOString()
  const ledger: Ledger = {
    schema: 1,
    generated: prev?.generated ?? now,
    updated: now,
    version: opts.version,
    upstreamCommit: opts.upstreamCommit ?? prev?.upstreamCommit,
    baseBranch: opts.baseBranch ?? prev?.baseBranch ?? loadConfig().baseBranch,
    mergeBranch: opts.mergeBranch ?? prev?.mergeBranch ?? (await branch()),
    report: opts.report ?? prev?.report,
    files: items,
    decisions: items.map((entry) => map.get(entry.file) ?? choice(entry.file)),
  }
  await write(out.json, ledger)
  await renderLedger({ ...opts, ledger: out.json })
  return out
}

async function load(opts: Pick<InitOptions, "version" | "output" | "ledger">) {
  await setup()
  const out = paths(opts)
  const ledger = await read(out.json)
  if (!ledger) throw new Error(`decision ledger not found: ${out.json}`)
  return { out, ledger }
}

function path(entry: Snap) {
  if (entry.kind === "renamed" && entry.target) return entry.target
  return entry.file
}

async function resolved(entry: Choice) {
  const file = path(entry)
  const ok = await Bun.file(file).exists()
  if (!ok && entry.kind === "removed") return "deleted"
  if (!ok) return undefined
  return sha(await Bun.file(file).text())
}

async function unifiedDiff(oursText: string, resolvedText: string, file: string) {
  const tmp = process.env.TMPDIR ?? "/tmp"
  const suffix = `${process.pid}-${Date.now()}`
  const oursPath = `${tmp}/decisions-ours-${suffix}`
  const resolvedPath = `${tmp}/decisions-resolved-${suffix}`
  await Bun.write(oursPath, oursText)
  await Bun.write(resolvedPath, resolvedText)
  const res = await run([
    "diff",
    "-u",
    "-U3",
    "--label",
    `a/${file} (ours)`,
    "--label",
    `b/${file} (resolved)`,
    oursPath,
    resolvedPath,
  ])
  await Bun.file(oursPath).delete()
  await Bun.file(resolvedPath).delete()
  // diff exits 0 when identical, 1 when different, >1 on error
  if (res.exitCode > 1) return undefined
  return res.stdout.trimEnd()
}

async function snapshot(entry: Snap, ours?: string) {
  const ok = await Bun.file(path(entry)).exists()
  if (!ok && entry.kind === "removed") return "deleted"
  if (!ok) return undefined
  const text = await Bun.file(path(entry))
    .text()
    .catch(() => "")
  if (!text) return undefined
  if (ours !== undefined) {
    const diff = await unifiedDiff(ours, text, entry.file)
    if (diff !== undefined) {
      return diff.length === 0 ? "(no changes relative to ours)" : clip(diff, 16000)
    }
  }
  return clip(text, 16000)
}

async function addDecision(opts: CliOptions) {
  if (!opts.file) throw new Error("--file is required")
  const data = await load(opts)
  if (!data.ledger.files.some((entry) => entry.file === opts.file)) {
    throw new Error(`${opts.file} is not tracked in the decision ledger`)
  }
  const map = new Map(data.ledger.decisions.map((entry) => [entry.file, entry]))
  const prev = map.get(opts.file)
  const tracked = data.ledger.files.find((entry) => entry.file === opts.file)
  const ours = tracked?.ours.full
  const next = merge(prev, {
    file: opts.file,
    kind: opts.kind ?? prev?.kind,
    risk: opts.risk ?? prev?.risk,
    plan: opts.plan ?? prev?.plan,
    summary: opts.summary ?? prev?.summary,
    rationale: opts.rationale ?? prev?.rationale,
    alternatives: opts.alternatives,
    verification: opts.verification,
    notes: opts.notes ?? prev?.notes,
    target: opts.target ?? prev?.target,
    resolution: opts.resolution ?? (await snapshot({ ...prev, ...opts, file: opts.file }, ours)) ?? prev?.resolution,
    updated: new Date().toISOString(),
  })
  map.set(opts.file, next)
  const ledger = {
    ...data.ledger,
    updated: new Date().toISOString(),
    decisions: data.ledger.files.map((entry) => map.get(entry.file) ?? choice(entry.file)),
  }
  await write(data.out.json, ledger)
  await renderLedger({ ...opts, ledger: data.out.json })
  return data.out
}

function missing(entry: Choice) {
  const gaps = []
  if (!entry.kind) gaps.push("kind")
  if (!entry.risk) gaps.push("risk")
  if (!entry.summary) gaps.push("summary")
  if (!entry.rationale) gaps.push("rationale")
  if (entry.kind === "renamed" && !entry.target) gaps.push("target")
  if (entry.verification.length === 0) gaps.push("verification")
  return gaps
}

async function markers(file: string) {
  const ok = await Bun.file(file).exists()
  if (!ok) return false
  const text = await Bun.file(file).text()
  return /^<<<<<<< |^\|\|\|\|\|\|\| |^=======$|^>>>>>>> /m.test(text)
}

async function stale(entry: Choice) {
  if (entry.kind !== "renamed") return false
  return Bun.file(entry.file).exists()
}

export async function checkLedger(opts: InitOptions & { write?: boolean }) {
  const data = await load(opts)
  const open = await conflicts()
  const files = new Set(data.ledger.files.map((entry) => entry.file))
  const issues: string[] = []
  for (const file of open) {
    if (!files.has(file)) issues.push(`${file}: unresolved conflict is missing from the ledger`)
  }
  const decisions: Resolved[] = []
  for (const entry of data.ledger.decisions) {
    decisions.push({ ...entry, resolved: await resolved(entry) })
  }
  const byFile = new Map(decisions.map((entry) => [entry.file, entry]))
  for (const entry of data.ledger.files) {
    const item = byFile.get(entry.file)
    if (!item) {
      issues.push(`${entry.file}: missing decision entry`)
      continue
    }
    const gaps = missing(item)
    if (gaps.length > 0) issues.push(`${entry.file}: missing ${gaps.join(", ")}`)
    if (open.includes(entry.file)) issues.push(`${entry.file}: still has an unresolved git conflict`)
    if (await markers(path(item))) issues.push(`${path(item)}: still has conflict markers`)
    if (await stale(item)) issues.push(`${entry.file}: original path still exists after renamed decision`)
    if (!item.resolved && item.kind !== "removed") issues.push(`${entry.file}: resolved file is missing`)
  }
  const ledger = { ...data.ledger, updated: new Date().toISOString(), decisions }
  if (opts.write !== false) {
    await write(data.out.json, ledger)
    await renderLedger({ ...opts, ledger: data.out.json })
  }
  return { out: data.out, issues }
}

export async function renderLedger(opts: Pick<InitOptions, "version" | "output" | "ledger">) {
  const data = await load(opts)
  await mkdir(dirname(data.out.md), { recursive: true })
  await Bun.write(data.out.md, markdown(data.ledger))
  return data.out
}

function count(ledger: Ledger, kind: Kind) {
  return ledger.decisions.filter((entry) => entry.kind === kind).length
}

function bullet(lines: string[], label: string, value?: string) {
  if (!value) return
  lines.push(`- ${label}: ${value}`)
}

function list(lines: string[], label: string, values: string[]) {
  if (values.length === 0) return
  lines.push(`- ${label}: ${values.join("; ")}`)
}

function fence(lines: string[], label: string, text?: string) {
  if (!text) return
  lines.push(`<details><summary>${label}</summary>`, "", "```diff", text, "```", "", "</details>", "")
}

function markdown(ledger: Ledger) {
  const complete = ledger.decisions.filter((entry) => missing(entry).length === 0).length
  const risky = ledger.decisions.filter((entry) => entry.risk === "high").length
  const lines = [
    "# Upstream Manual Merge Decisions",
    "",
    `Generated: ${ledger.generated}`,
    `Updated: ${ledger.updated}`,
    "",
    "## Summary",
    "",
    `- Version: ${ledger.version}`,
    ledger.upstreamCommit ? `- Upstream Commit: \`${ledger.upstreamCommit.slice(0, 12)}\`` : undefined,
    `- Base Branch: ${ledger.baseBranch}`,
    `- Merge Branch: ${ledger.mergeBranch}`,
    ledger.report ? `- Automation Report: \`${ledger.report}\`` : undefined,
    `- Manual Files: ${ledger.files.length}`,
    `- Complete Decisions: ${complete}/${ledger.files.length}`,
    `- High Risk Decisions: ${risky}`,
    "",
    "## Decisions By Type",
    "",
    ...kinds.map((kind) => `- ${kind}: ${count(ledger, kind)}`),
    "",
    "## File Decisions",
    "",
  ].filter((line): line is string => line !== undefined)

  const choices = new Map(ledger.decisions.map((entry) => [entry.file, entry]))
  for (const entry of ledger.files) {
    const pick = choices.get(entry.file) ?? choice(entry.file)
    lines.push(`### ${entry.file}`)
    lines.push("")
    bullet(lines, "Conflict", `${entry.status} (${entry.type})`)
    bullet(lines, "Recommendation", `${entry.recommendation} - ${entry.reason}`)
    bullet(lines, "Base Hash", entry.base.hash ? `\`${entry.base.hash}\`` : "not present")
    bullet(lines, "Ours Hash", entry.ours.hash ? `\`${entry.ours.hash}\`` : "not present")
    bullet(lines, "Theirs Hash", entry.theirs.hash ? `\`${entry.theirs.hash}\`` : "not present")
    fence(lines, "Original diff3 conflict", diff3(entry))
    bullet(lines, "Plan", pick.plan)
    bullet(lines, "Decision", pick.kind)
    bullet(lines, "Risk", pick.risk)
    bullet(lines, "Summary", pick.summary)
    bullet(lines, "Rationale", pick.rationale)
    bullet(lines, "Target", pick.target)
    list(lines, "Alternatives", pick.alternatives)
    list(lines, "Verification", pick.verification)
    bullet(lines, "Notes", pick.notes)
    bullet(lines, "Resolution Hash", pick.resolved ? `\`${pick.resolved}\`` : undefined)
    fence(lines, "Resolution (diff: ours → resolved)", pick.resolution)
    const gaps = missing(pick)
    if (gaps.length > 0) bullet(lines, "Missing", gaps.join(", "))
    lines.push("")
  }
  return lines.join("\n")
}

function body(ledger: Ledger) {
  const complete = ledger.decisions.filter((entry) => missing(entry).length === 0).length
  const lines = [
    "## Manual Merge Decisions",
    "",
    `${ledger.files.length} file(s) required manual upstream merge resolution; ${complete}/${ledger.files.length} have complete rationale entries.`,
    "",
    ...kinds
      .map((kind) => [kind, count(ledger, kind)] as const)
      .filter(([, total]) => total > 0)
      .map(([kind, total]) => `- ${kind}: ${total}`),
    ledger.report ? `- Automation report: \`${ledger.report}\`` : undefined,
    `- Local decision report: \`script/upstream/reports/manual-decisions-${slug(ledger.version)}.md\``,
    "",
  ].filter((line): line is string => line !== undefined)
  if (ledger.decisions.length > 0) {
    lines.push("### File Decisions", "")
    for (const entry of ledger.decisions) {
      lines.push(`- \`${entry.file}\`: ${entry.kind ?? "missing-kind"}${entry.risk ? `, ${entry.risk} risk` : ""}`)
      if (entry.summary) lines.push(`  - Summary: ${entry.summary}`)
      if (entry.rationale) lines.push(`  - Rationale: ${entry.rationale}`)
      if (entry.target) lines.push(`  - Target: ${entry.target}`)
      if (entry.alternatives.length > 0) lines.push(`  - Alternatives: ${entry.alternatives.join("; ")}`)
      if (entry.verification.length > 0) lines.push(`  - Verification: ${entry.verification.join("; ")}`)
      const item = ledger.files.find((file) => file.file === entry.file)
      fence(lines, "Original diff3 conflict", item ? diff3(item) : undefined)
      fence(lines, "Resolution (diff: ours → resolved)", entry.resolution)
    }
    lines.push("")
  }
  return lines.join("\n")
}

function values(args: string[], name: string) {
  const out: string[] = []
  for (const [idx, arg] of args.entries()) {
    if (arg === `--${name}` && args[idx + 1]) out.push(args[idx + 1] ?? "")
  }
  return out.filter(Boolean)
}

function value(args: string[], name: string) {
  return values(args, name)[0]
}

function flag(args: string[], name: string) {
  return args.includes(`--${name}`)
}

function parse(args: string[]): { command: string; opts: CliOptions } {
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "help"
  const version = value(args, "version") ?? value(args, "tag") ?? ""
  const kind = value(args, "kind") as Kind | undefined
  const risk = value(args, "risk") as Risk | undefined
  if (kind && !kinds.includes(kind)) throw new Error(`invalid --kind: ${kind}`)
  if (risk && !risks.includes(risk)) throw new Error(`invalid --risk: ${risk}`)
  return {
    command,
    opts: {
      version,
      upstreamCommit: value(args, "upstream-commit"),
      baseBranch: value(args, "base-branch"),
      mergeBranch: value(args, "merge-branch"),
      report: value(args, "report"),
      output: value(args, "output"),
      ledger: value(args, "ledger"),
      force: flag(args, "force"),
      file: value(args, "file"),
      kind,
      risk,
      plan: value(args, "plan"),
      summary: value(args, "summary"),
      rationale: value(args, "rationale"),
      notes: value(args, "notes"),
      target: value(args, "target"),
      resolution: value(args, "resolution"),
      alternatives: values(args, "alternative"),
      verification: values(args, "verification"),
      write: !flag(args, "no-write"),
    },
  }
}

function need(opts: CliOptions) {
  if (opts.ledger) return
  if (!opts.version) throw new Error("--version is required unless --ledger is provided")
}

function usage() {
  console.log(`Usage:
  bun script/upstream/decisions.ts init --version v1.2.3
  bun script/upstream/decisions.ts add --version v1.2.3 --file path --kind hybrid --risk low --summary "..." --rationale "..." --verification "bun turbo typecheck"
  bun script/upstream/decisions.ts check --version v1.2.3
  bun script/upstream/decisions.ts render --version v1.2.3
  bun script/upstream/decisions.ts pr-body --version v1.2.3

Options:
  --ledger <path>          Use a specific JSON ledger path instead of --version
  --output <dir>           Output directory (default: script/upstream/reports)
  --force                  Rebuild init snapshot and drop existing decisions
  --alternative <text>     Repeatable alternative considered for add
  --target <path>          New path for renamed decisions
  --resolution <text>      Override the resolved-content snapshot captured by add
  --verification <text>    Repeatable verification command/result for add
  --no-write               Do not update hashes/report during check
`)
}

async function main() {
  const args = import.meta.path === process.argv[1] ? process.argv.slice(2) : process.argv.slice(1)
  if (args.includes("--help") || args.includes("-h")) return usage()
  const { command, opts } = parse(args)
  if (command === "help") return usage()
  need(opts)
  if (command === "init") {
    const out = await initLedger(opts)
    log.success(`Initialized manual decision ledger: ${out.md}`)
    return
  }
  if (command === "add") {
    const out = await addDecision(opts)
    log.success(`Recorded decision in ${out.md}`)
    return
  }
  if (command === "check") {
    const res = await checkLedger(opts)
    if (res.issues.length > 0) {
      log.error("Manual decision ledger is incomplete:")
      log.list(res.issues)
      process.exit(1)
    }
    log.success(`Manual decision ledger is complete: ${res.out.md}`)
    return
  }
  if (command === "render") {
    const out = await renderLedger(opts)
    log.success(`Rendered ${out.md}`)
    return
  }
  if (command === "pr-body") {
    const data = await load(opts)
    console.log(body(data.ledger))
    return
  }
  throw new Error(`unknown command: ${command}`)
}

if (import.meta.main) {
  main().catch((err) => {
    log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
