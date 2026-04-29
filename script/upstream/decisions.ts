#!/usr/bin/env bun
/**
 * Manual upstream merge decision ledger.
 *
 * Captures the conflict snapshot that remains after automation stops, then
 * records the rationale for each human/agent resolution so PR reviewers can
 * audit the manual part of an upstream merge.
 */

import { $ } from "bun"
import { dirname, join } from "node:path"
import { mkdir } from "node:fs/promises"
import { loadConfig } from "./utils/config"
import { getRecommendation } from "./utils/report"
import * as log from "./utils/logger"

type Kind = "hybrid" | "take-ours" | "take-theirs" | "regenerated" | "removed" | "renamed" | "other"
type Risk = "low" | "medium" | "high"

interface Side {
  present: boolean
  hash?: string
  preview?: string
}

interface Item {
  file: string
  status: string
  type: string
  recommendation: string
  reason: string
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
  resolved?: string
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
  alternatives: string[]
  verification: string[]
  write: boolean
}

const kinds: Kind[] = ["hybrid", "take-ours", "take-theirs", "regenerated", "removed", "renamed", "other"]
const risks: Risk[] = ["low", "medium", "high"]

async function root() {
  const res = await $`git rev-parse --show-toplevel`.quiet().nothrow()
  if (res.exitCode !== 0) throw new Error("not inside a git repository")
  return res.stdout.toString().trim()
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

function preview(text: string) {
  return text.split("\n").slice(0, 40).join("\n").slice(0, 4000)
}

async function side(file: string, stage: 1 | 2 | 3): Promise<Side> {
  const res = await $`git show ${`:${stage}:${file}`}`.quiet().nothrow()
  if (res.exitCode !== 0) return { present: false }
  const text = res.stdout.toString()
  return { present: true, hash: await sha(text), preview: preview(text) }
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
  const res = await $`git rev-parse --abbrev-ref HEAD`.quiet().nothrow()
  return res.exitCode === 0 ? res.stdout.toString().trim() : ""
}

async function status() {
  const res = await $`git status --porcelain`.quiet().nothrow()
  const map = new Map<string, string>()
  for (const line of res.stdout.toString().split("\n")) {
    if (!line) continue
    const file = line.startsWith("?? ") ? line.slice(3) : (line.slice(3).split(" -> ").at(-1) ?? line.slice(3))
    map.set(file, line.slice(0, 2))
  }
  return map
}

async function conflicts() {
  const res = await $`git diff --name-only --diff-filter=U`.quiet().nothrow()
  return res.stdout
    .toString()
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
  const res = ours.present ? await $`git show ${`:2:${file}`}`.quiet().nothrow() : undefined
  const text = res?.exitCode === 0 ? res.stdout.toString() : ""
  const rec = getRecommendation(file, config.keepOurs, config.skipFiles, text)
  return {
    file,
    status,
    type: type(status),
    recommendation: rec.recommendation,
    reason: rec.reason,
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
  const items = await Promise.all(files.map((file) => item(file, stats.get(file) ?? "UU")))
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

async function resolved(entry: Choice) {
  const ok = await Bun.file(entry.file).exists()
  if (!ok) return entry.kind === "removed" ? "deleted" : undefined
  return sha(await Bun.file(entry.file).text())
}

async function addDecision(opts: CliOptions) {
  if (!opts.file) throw new Error("--file is required")
  const data = await load(opts)
  if (!data.ledger.files.some((entry) => entry.file === opts.file)) {
    throw new Error(`${opts.file} is not tracked in the decision ledger`)
  }
  const map = new Map(data.ledger.decisions.map((entry) => [entry.file, entry]))
  const prev = map.get(opts.file)
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
  if (!entry.summary) gaps.push("summary")
  if (!entry.rationale) gaps.push("rationale")
  if (entry.verification.length === 0) gaps.push("verification")
  return gaps
}

async function markers(file: string) {
  const ok = await Bun.file(file).exists()
  if (!ok) return false
  const text = await Bun.file(file).text()
  return /^<<<<<<< |^\|\|\|\|\|\|\| |^=======$|^>>>>>>> /m.test(text)
}

export async function checkLedger(opts: InitOptions & { write?: boolean }) {
  const data = await load(opts)
  const open = await conflicts()
  const files = new Set(data.ledger.files.map((entry) => entry.file))
  const issues: string[] = []
  for (const file of open) {
    if (!files.has(file)) issues.push(`${file}: unresolved conflict is missing from the ledger`)
  }
  const decisions: Resolved[] = await Promise.all(
    data.ledger.decisions.map(async (entry) => ({ ...entry, resolved: await resolved(entry) })),
  )
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
    if (await markers(entry.file)) issues.push(`${entry.file}: still has conflict markers`)
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
    bullet(lines, "Plan", pick.plan)
    bullet(lines, "Decision", pick.kind)
    bullet(lines, "Risk", pick.risk)
    bullet(lines, "Summary", pick.summary)
    bullet(lines, "Rationale", pick.rationale)
    list(lines, "Alternatives", pick.alternatives)
    list(lines, "Verification", pick.verification)
    bullet(lines, "Notes", pick.notes)
    bullet(lines, "Resolution Hash", pick.resolved ? `\`${pick.resolved}\`` : undefined)
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
      if (entry.alternatives.length > 0) lines.push(`  - Alternatives: ${entry.alternatives.join("; ")}`)
      if (entry.verification.length > 0) lines.push(`  - Verification: ${entry.verification.join("; ")}`)
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
  bun script/upstream/decisions.ts add --version v1.2.3 --file path --kind hybrid --summary "..." --rationale "..." --verification "bun turbo typecheck"
  bun script/upstream/decisions.ts check --version v1.2.3
  bun script/upstream/decisions.ts render --version v1.2.3
  bun script/upstream/decisions.ts pr-body --version v1.2.3

Options:
  --ledger <path>          Use a specific JSON ledger path instead of --version
  --output <dir>           Output directory (default: script/upstream/reports)
  --force                  Rebuild init snapshot and drop existing decisions
  --alternative <text>     Repeatable alternative considered for add
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
