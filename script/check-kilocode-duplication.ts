import { lstat, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scanner = "jscpd@5.0.16"
const root = resolve(import.meta.dir, "..")
const filename = "script/kilocode-duplication-allowlist.json"
const roots = [
  "packages/kilo-*/src",
  "packages/kilo-vscode/webview-ui",
  "packages/plugin-atomic-chat/src",
  "packages/*/src/kilocode",
  "packages/*/src/kilo-*",
]
const excluded = {
  "packages/kilo-jetbrains/**": "Outside the VS Code scope",
  "packages/kilo-i18n/**": "Locale dictionaries",
  "packages/kilo-docs/**": "Documentation",
  "**/node_modules/**": "Dependencies",
  "**/dist/**": "Build output",
  "**/build/**": "Build output",
  "**/out/**": "Build output",
  "**/coverage/**": "Test output",
  "**/__tests__/**": "Tests",
  "**/tests/**": "Tests",
  "**/test/**": "Tests",
  "**/fixture/**": "Fixtures",
  "**/fixtures/**": "Fixtures",
  "**/__fixtures__/**": "Fixtures",
  "**/recordings/**": "Recorded test data",
  "**/__snapshots__/**": "Test snapshots",
  "**/testdata/**": "Test data",
  "**/stories/**": "Component examples",
  "**/*.test.*": "Tests",
  "**/*.spec.*": "Tests",
  "**/*.stories.*": "Component examples",
  "**/*.d.ts": "Ambient declarations",
  "**/*.gen.ts": "Generated source",
  "**/i18n/**": "Locale dictionaries",
  "**/locales/**": "Locale dictionaries",
  "**/translations/**": "Locale dictionaries",
  "packages/kilo-vscode/src/services/autocomplete/continuedev/**": "Vendored Continue implementation",
  "**/examples/**": "Examples",
}
const ignored = Object.keys(excluded).map((pattern) => new Bun.Glob(pattern))

export type Finding = {
  files: string[]
  fingerprint: string
  matches: number
  tokens: number
  locations: { file: string; start: number; end: number }[]
}

export type Exception = {
  files: string[]
  fingerprint: string
  maxMatches: number
  maxTokens: number
  kind: "legacy" | "intentional"
  owner: string
  reason: string
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function object(value: unknown) {
  if (!record(value)) throw new Error("Expected a JSON object")
  return value
}

function array(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Expected a JSON array")
  return value as unknown[]
}

function text(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected a non-empty string")
  return value
}

function integer(value: unknown, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Expected an integer of at least ${minimum}`)
  }
  return value
}

function path(value: unknown) {
  const file = text(value)
  if (
    isAbsolute(file) ||
    file.includes("\\") ||
    file.split("/").some((part) => !part || part === ".." || part === ".")
  ) {
    throw new Error(`Expected a repository-relative path: ${file}`)
  }
  return file
}

function fingerprint(value: unknown) {
  const hash = text(value)
  if (!/^[a-f0-9]{16}$/.test(hash)) throw new Error(`Invalid duplication fingerprint: ${hash}`)
  return hash
}

function key(entry: Pick<Exception, "files" | "fingerprint">) {
  return JSON.stringify([entry.files, entry.fingerprint])
}

export function parse(value: unknown): Exception[] {
  const data = object(value)
  if (data.version !== 1 || data.scanner !== scanner)
    throw new Error("Unsupported duplication allowlist version or scanner")
  const seen = new Set<string>()
  return array(data.exceptions).map((value) => {
    const item = object(value)
    const files = array(item.files).map(path)
    if (files.length !== 2 || files.join("\0") !== files.toSorted().join("\0")) {
      throw new Error("An exception must contain exactly two sorted file paths")
    }
    const kind = item.kind
    if (kind !== "legacy" && kind !== "intentional") throw new Error("An exception must be legacy or intentional")
    const entry: Exception = {
      files,
      fingerprint: fingerprint(item.fingerprint),
      maxMatches: integer(item.maxMatches, 1),
      maxTokens: integer(item.maxTokens, 1),
      kind,
      owner: text(item.owner),
      reason: text(item.reason),
    }
    const id = key(entry)
    if (seen.has(id)) throw new Error(`Duplicate exception: ${files.join(" and ")}`)
    seen.add(id)
    return entry
  })
}

export async function scan(cwd: string) {
  const directory = await realpath(cwd)
  const candidates = new Set<string>()
  for (const scope of roots) {
    const glob = new Bun.Glob(`${scope}/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,css}`)
    for await (const file of glob.scan({ cwd: directory, onlyFiles: true, followSymlinks: false })) {
      const normalized = file.replaceAll("\\", "/")
      if (!ignored.some((glob) => glob.match(normalized))) candidates.add(normalized)
    }
  }
  const files: string[] = []
  for (const file of [...candidates].sort()) {
    const absolute = join(directory, file)
    const info = await lstat(absolute)
    if (info.isSymbolicLink()) continue
    if (info.size > 10 * 1024 * 1024) throw new Error(`Source exceeds the duplication scanner size limit: ${file}`)
    const content = await Bun.file(absolute).text()
    if (/jscpd:ignore-(?:start|end)/.test(content)) {
      throw new Error(`Inline duplication suppression is not allowed: ${file}. Use a bounded exception instead.`)
    }
    files.push(absolute)
  }
  if (files.length === 0) throw new Error("No Kilo-owned source files found for duplication analysis")
  const temporary = await mkdtemp(join(tmpdir(), "kilo-duplication-"))
  try {
    const config = join(temporary, "config.json")
    await Bun.write(
      config,
      JSON.stringify({
        path: files,
        mode: "weak",
        minLines: 10,
        minTokens: 100,
        format: ["typescript", "tsx", "javascript", "jsx", "css"],
        crossFormats: [["typescript", "tsx"]],
        maxSize: "10mb",
        absolute: true,
        noColors: true,
        noTips: true,
        reporters: ["json", "sarif"],
        output: temporary,
      }),
    )
    const proc = Bun.spawn(
      [process.execPath, "x", "--package", scanner, "jscpd", "--config", config, "--workers", "1", "--no-gitignore"],
      { cwd: directory, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    )
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    if (code !== 0) throw new Error(`Duplication scanner failed (${code}):\n${stderr || stdout}`)
    const json = object(await Bun.file(join(temporary, "jscpd-report.json")).json())
    const total = object(object(json.statistics).total)
    const report = object(await Bun.file(join(temporary, "jscpd-report.sarif")).json())
    const runs = array(report.runs)
    if (runs.length !== 1) throw new Error("Expected one duplication scanner run")
    const run = object(runs.at(0))
    if (object(object(run.tool).driver).version !== scanner.slice("jscpd@".length)) {
      throw new Error("Unexpected duplication scanner version")
    }
    const results = array(run.results)
    if (integer(total.clones) !== results.length)
      throw new Error("Duplication reports disagree on the number of findings")
    const findings = new Map<string, Finding>()
    for (const value of results) {
      const result = object(value)
      if (result.ruleId !== "jscpd/duplicate-code") throw new Error("Unexpected duplication scanner result")
      const locations = [...array(result.locations), ...array(result.relatedLocations)].map((value) => {
        const location = object(object(value).physicalLocation)
        const artifact = object(location.artifactLocation)
        const uri = text(artifact.uri)
        const absolute = isAbsolute(uri)
          ? uri
          : fileURLToPath(new URL(uri, text(object(object(run.originalUriBaseIds)[text(artifact.uriBaseId)]).uri)))
        const region = object(location.region)
        return {
          file: path(relative(directory, absolute).replaceAll("\\", "/")),
          start: integer(region.startLine, 1),
          end: integer(region.endLine, 1),
        }
      })
      if (locations.length !== 2) throw new Error("Expected two locations for a duplicated block")
      const files = locations.map((location) => location.file).sort()
      const hash = fingerprint(object(result.partialFingerprints)["jscpdCloneHash/v1"])
      const tokens = integer(object(result.properties).token_count, 1)
      const id = key({ files, fingerprint: hash })
      const previous = findings.get(id)
      findings.set(id, {
        files,
        fingerprint: hash,
        matches: (previous?.matches ?? 0) + 1,
        tokens: Math.max(previous?.tokens ?? 0, tokens),
        locations: [...(previous?.locations ?? []), ...locations],
      })
    }
    return {
      scanner,
      files: integer(total.sources, 1),
      lines: integer(total.lines, 1),
      pairs: results.length,
      duplicatedLines: integer(total.duplicatedLines),
      duplicatedTokens: integer(total.duplicatedTokens),
      findings: [...findings.values()].sort((a, b) => key(a).localeCompare(key(b))),
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export function compare(findings: Finding[], exceptions: Exception[]) {
  const allowed = new Map(exceptions.map((entry) => [key(entry), entry]))
  const current = new Set(findings.map(key))
  const failures: string[] = []
  for (const finding of findings) {
    const entry = allowed.get(key(finding))
    const locations = finding.locations
      .map((location) => `${location.file}:${location.start}-${location.end}`)
      .join(" and ")
    if (!entry) {
      failures.push(`Unclassified duplication (${finding.tokens} tokens, ${finding.matches} match(es)): ${locations}`)
      continue
    }
    if (finding.matches > entry.maxMatches || finding.tokens > entry.maxTokens) {
      failures.push(
        `Duplication grew: ${locations}. Matches ${finding.matches}/${entry.maxMatches}, tokens ${finding.tokens}/${entry.maxTokens}. ${entry.reason}`,
      )
    }
  }
  for (const entry of exceptions) {
    if (!current.has(key(entry)))
      failures.push(
        `Stale exception: ${entry.files.join(" and ")} (${entry.fingerprint}). Remove it to lock in cleanup.`,
      )
  }
  return failures
}

export function prune(findings: Finding[], exceptions: Exception[]) {
  const current = new Map(findings.map((finding) => [key(finding), finding]))
  return exceptions.flatMap((entry) => {
    const finding = current.get(key(entry))
    return finding
      ? [
          {
            ...entry,
            maxMatches: Math.min(entry.maxMatches, finding.matches),
            maxTokens: Math.min(entry.maxTokens, finding.tokens),
          },
        ]
      : []
  })
}

async function main() {
  const args = process.argv.slice(2)
  const mode = args.at(0)
  if (args.length > 1 || (mode && !["--help", "--report", "--init", "--prune"].includes(mode))) {
    throw new Error("Usage: bun run check:duplication [--report | --prune | --init | --help]")
  }
  if (mode === "--help") {
    console.log(
      "Check Kilo-owned production code for copied blocks of at least 10 lines and 100 tokens.\n" +
        "--report prints findings without changing the allowlist.\n" +
        "--prune only removes stale exceptions and lowers existing limits; new findings still fail.\n" +
        "--init creates the initial legacy baseline and refuses to overwrite an existing allowlist.\n" +
        "JetBrains, shared upstream files, docs, translations, tests, generated source and vendored code are outside this ratchet.",
    )
    return
  }
  const file = Bun.file(join(root, filename))
  if (mode === "--init" && (await file.exists()))
    throw new Error("The duplication allowlist already exists; review individual exceptions instead")
  const result = await scan(root)
  if (mode === "--report") {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  const initial: Exception[] = result.findings.map((finding) => ({
    files: finding.files,
    fingerprint: finding.fingerprint,
    maxMatches: finding.matches,
    maxTokens: finding.tokens,
    kind: "legacy",
    owner: finding.files.at(0)?.split("/").at(1) ?? "kilo",
    reason: "Existing duplication before the ratchet; remove through a focused, behavior-preserving extraction.",
  }))
  const previous = mode === "--init" ? initial : parse(await file.json())
  const exceptions = mode === "--prune" ? prune(result.findings, previous) : previous
  const failures = compare(result.findings, exceptions)
  if (failures.length)
    throw new Error(`${failures.join("\n")}\nRefactor new copies; review bounded exceptions in ${filename}.`)
  if (mode === "--init" || (mode === "--prune" && JSON.stringify(exceptions) !== JSON.stringify(previous))) {
    await Bun.write(file, `${JSON.stringify({ version: 1, scanner, exceptions }, null, 2)}\n`)
  }
  const percentage = ((100 * result.duplicatedLines) / result.lines).toFixed(2)
  console.log(
    `check:duplication: ${result.pairs} block pairs, ${result.duplicatedLines} duplicated lines (${percentage}%), ${result.files} eligible files.\n` +
      `${exceptions.length} bounded exceptions; no new duplication.`,
  )
}

if (import.meta.main) {
  await main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
