#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

type Level = "error" | "warn"

type Issue = {
  level: Level
  file?: string
  message: string
}

const root = path.resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const strict = args.includes("--enforce")
const issues: Issue[] = []

const docs = [
  "docs/engineering/index.md",
  "docs/engineering/architecture.md",
  "docs/engineering/plans.md",
  "docs/engineering/quality.md",
  "docs/engineering/reliability.md",
  "docs/engineering/security.md",
  "docs/engineering/fork-hygiene.md",
  "docs/engineering/standards.md",
  "docs/engineering/technical-debt.md",
  ".planning/README.md",
]

function abs(file: string) {
  return path.join(root, file)
}

function unix(file: string) {
  return file.replaceAll("\\", "/")
}

function rel(file: string) {
  return unix(path.relative(root, file))
}

function read(file: string) {
  return readFileSync(abs(file), "utf8")
}

function add(level: Level, message: string, file?: string) {
  issues.push({ level, file, message })
}

function list(dir: string): string[] {
  const base = abs(dir)
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(base, entry.name)
    if (entry.isDirectory()) return list(rel(file))
    if (entry.isFile()) return [rel(file)]
    return []
  })
}

function line(text: string, value: string) {
  return text.split(/\r?\n/).findIndex((item) => item.includes(value)) + 1
}

function label(file: string, suffix = "") {
  if (!suffix) return file
  return `${file}:${suffix}`
}

function load(file: string) {
  if (!existsSync(abs(file))) {
    add("error", "Required file is missing.", file)
    return ""
  }
  return read(file)
}

function links(file: string, text: string) {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1] ?? "")
}

function local(file: string, target: string) {
  if (!target || target.startsWith("#")) return undefined
  if (/^[a-z]+:/i.test(target)) return undefined
  const clean = target.split("#")[0] ?? ""
  if (!clean) return undefined
  if (clean.startsWith("/")) return clean.slice(1)
  return unix(path.normalize(path.join(path.dirname(file), clean)))
}

function checkLinks(file: string, text: string) {
  for (const target of links(file, text)) {
    const dest = local(file, target)
    if (!dest) continue
    if (!existsSync(abs(dest))) add("error", `Broken local link: ${target}`, file)
  }
}

function checkDocs() {
  for (const doc of docs) load(doc)

  const map = load("docs/engineering/index.md")
  for (const doc of docs.filter((item) => item !== "docs/engineering/index.md" && item !== ".planning/README.md")) {
    const name = path.basename(doc)
    if (!map.includes(name)) add("error", `Engineering index does not link ${name}.`, "docs/engineering/index.md")
  }

  for (const doc of docs) checkLinks(doc, load(doc))
}

function checkAgents() {
  const text = load("AGENTS.md")
  const lines = text.trimEnd().split(/\r?\n/).length
  if (lines > 120) add("error", `Root AGENTS.md has ${lines} lines; keep it at or below 120.`, "AGENTS.md")
  for (const doc of docs.filter((item) => item.startsWith("docs/engineering/"))) {
    if (!text.includes(doc)) add("error", `Root AGENTS.md should link ${doc}.`, "AGENTS.md")
  }
}

function checkPackages() {
  const rootpkg = JSON.parse(load("package.json")) as { scripts?: Record<string, string> }
  const scripts = rootpkg.scripts ?? {}
  for (const name of ["random", "hello"]) {
    if (scripts[name]) add("error", `Remove placeholder root script "${name}".`, "package.json")
  }
  for (const name of ["standards:check", "standards:enforce"]) {
    if (!scripts[name]) add("error", `Missing root script "${name}".`, "package.json")
  }

  const cli = JSON.parse(load("packages/opencode/package.json")) as {
    scripts?: Record<string, string>
    randomField?: string
  }
  const cmds = cli.scripts ?? {}
  if (cli.randomField) add("error", "Remove placeholder randomField.", "packages/opencode/package.json")
  for (const name of ["random", "clean", "lint", "format", "docs", "deploy"]) {
    const cmd = cmds[name] ?? ""
    if (cmd.startsWith("echo ")) add("error", `Remove placeholder CLI script "${name}".`, "packages/opencode/package.json")
  }
}

function checkMarkers() {
  for (const file of ["script/check-opencode-annotations.ts", ".github/workflows/check-opencode-annotations.yml"]) {
    const text = load(file)
    if (text.includes("kilocode_change")) {
      add("error", "Use canonical devilcode_change marker terminology.", label(file, String(line(text, "kilocode_change"))))
    }
  }
}

function checkWorkflows() {
  for (const file of list(".github/workflows").filter((item) => item.match(/\.ya?ml$/))) {
    const text = read(file)
    if (text.match(/github\.repository\s*==\s*['"]Kilo-Org\/kilocode['"]/)) {
      add("error", "Active workflow repository guard should target Devil-Org/devilcode.", file)
    }
    if (text.includes("Kilo-Org/kilocode")) {
      add("warn", "Active workflow contains stale Kilo-Org/kilocode text; verify compatibility or rename.", file)
    }
    if (text.match(/if:\s*false|\&\&\s*false/)) {
      add("warn", "Workflow contains a disabled guard; keep only if intentionally documented.", file)
    }
  }
}

checkDocs()
checkAgents()
checkPackages()
checkMarkers()
checkWorkflows()

const groups = {
  error: issues.filter((issue) => issue.level === "error"),
  warn: issues.filter((issue) => issue.level === "warn"),
}

for (const issue of issues) {
  const where = issue.file ? ` ${issue.file}` : ""
  console.log(`${issue.level.toUpperCase()}${where} - ${issue.message}`)
}

if (issues.length === 0) console.log("Harness standards check passed.")
else console.log(`Harness standards check found ${groups.error.length} errors and ${groups.warn.length} warnings.`)

if (strict && groups.error.length > 0) process.exit(1)
process.exit(0)
