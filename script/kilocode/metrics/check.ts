import { $ } from "bun"
import { lstat, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { readMirrors } from "../../upstream/utils/mirrors"

const product = /^packages\/(?:kilo-[^/]+\/src\/|kilo-vscode\/webview-ui\/|.+\/src\/kilocode\/).*\.tsx?$/
const excluded =
  /\.(?:test|spec|stories|d|gen|generated)\.tsx?$|\/(?:kilo-i18n|i18n|locales|translations|language-dictionaries|tests?|__tests__|__fixtures__|fixtures?|stories|examples|generated|vendor|continuedev)\//

type Finding = { file: string; label: string; line: number; column: number; score: number }
type Report = {
  number_of_files: number
  diagnostics: {
    filename: string
    code: string
    message: string
    labels: { span: { line: number; column: number } }[]
  }[]
}

async function measure(dir: string, sources: Map<string, string>): Promise<Finding[]> {
  if (!sources.size) return []
  for (const [file, text] of sources) {
    // Inline disables apply to project lint, not this independent measurement.
    await Bun.write(join(dir, file), text.replace(/(?:eslint|oxlint)-disable/g, "metric-disable"))
  }
  await Bun.write(
    join(dir, "config.json"),
    JSON.stringify({ categories: { correctness: "off" }, rules: { complexity: ["error", 20] } }),
  )
  const cli = join(dirname(Bun.resolveSync("oxlint/package.json", import.meta.dir)), "bin/oxlint")
  const result = await $`${process.execPath} ${cli} -c config.json -f json --no-ignore packages`
    .cwd(dir)
    .quiet()
    .nothrow()
  // Exit 0 and 1 are the documented outcomes (clean and diagnostics found). Anything else
  // means Oxlint itself failed, and its stderr says why.
  if (result.exitCode > 1) throw new Error(result.stderr.toString() || `Oxlint exited ${result.exitCode}`)
  const report = parseReport(result.stdout.toString(), result.stderr.toString(), result.exitCode)
  if (report.number_of_files !== sources.size) throw new Error("Oxlint did not measure the complete snapshot")
  return report.diagnostics.map(({ filename, code, message, labels }) => {
    const match = /^(.+) has a complexity of (\d+)\. Maximum allowed is 20\.$/.exec(message)
    if (code !== "eslint(complexity)" || !match || !labels[0]) throw new Error(`${filename}: ${message}`)
    return { file: filename.replaceAll("\\", "/"), label: match[1]!, score: Number(match[2]), ...labels[0].span }
  })
}

// Oxlint writes its report to stdout. A broken install or config writes only stderr,
// so surface that instead of a JSON parse error that hides the cause.
function parseReport(stdout: string, stderr: string, exitCode: number): Report {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(
      `Oxlint exited ${exitCode} without a report: ${stderr.trim() || stdout.trim().slice(0, 200) || "no output"}`,
    )
  }
}

// With zero context Git reports exactly the replaced ranges. An empty range is
// anchored *after* the numbered line. Changed declaration lines inherit no cap.
function originalLine(line: number, patch: string) {
  let offset = 0
  for (const h of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const count = Number(h[4] ?? 1)
    const start = Number(h[3]) + Number(count === 0)
    if (line < start) break
    if (line < start + count) return undefined
    offset += Number(h[2] ?? 1) - count
  }
  return line + offset
}

function lines(text = "") {
  return text.split("\n").length - Number(text.endsWith("\n") || text === "")
}

// `git diff --name-status -z` pairs a rename destination with its source, so a moved file
// is measured against the code it came from instead of counting as a new one.
function renames(status: string) {
  const entries = new Map<string, string>()
  const parts = status.split("\0")
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]!
    if (!code) break
    if (code.startsWith("R")) {
      entries.set(parts[i + 2]!, parts[i + 1]!)
      i += 2
      continue
    }
    entries.set(parts[i + 1]!, code === "A" ? "" : parts[i + 1]!)
    i += 1
  }
  return entries
}

async function check(base: string) {
  const registry = await readMirrors(process.cwd())
  const mirrors = new Set(Object.values(registry.mirrors).map((x) => x.mirror))
  const status = renames(await $`git diff -M --diff-filter=AMRT --name-status -z ${base} -- packages`.text())
  const added = await $`git ls-files --others --exclude-standard -z -- packages`.text()
  const files = [...new Set([...status.keys(), ...added.split("\0")])].filter(
    (f) => product.test(f) && !excluded.test(f) && !mirrors.has(f),
  )
  const before = new Map<string, string>()
  const after = new Map<string, string>()
  const errors: string[] = []
  for (const file of files) {
    if ((await lstat(file)).isSymbolicLink()) continue
    const source = status.get(file)
    if (source) before.set(file, await $`git show ${base}:${source}`.text())
    const text = await Bun.file(file).text()
    after.set(file, text)
    const cap = Math.max(1000, lines(before.get(file)))
    if (lines(text) > cap)
      errors.push(
        `${file}: ${lines(text)} lines (limit ${cap}). Extract a cohesive responsibility into its own module.`,
      )
  }
  const tmp = await mkdtemp(join(tmpdir(), "kilo-metrics-"))
  try {
    const old = await measure(join(tmp, "before"), before)
    const current = await measure(join(tmp, "after"), after)
    const patches = new Map<string, string>()
    for (const f of current) {
      const source = status.get(f.file)
      if (!source || patches.has(f.file)) continue
      const paths = source === f.file ? [f.file] : [source, f.file]
      patches.set(
        f.file,
        await $`git diff --no-ext-diff --no-textconv --no-color -M --ignore-cr-at-eol -U0 --inter-hunk-context=0 ${base} -- ${paths}`.text(),
      )
    }
    for (const f of current) {
      const line = originalLine(f.line, patches.get(f.file) ?? "")
      const inherited = old.filter((o) => o.file === f.file)
      const exact = inherited.find((o) => o.line === line && o.column === f.column && o.label === f.label)
      const cap = exact?.score ?? ceiling(inherited, current, f)
      if (f.score > cap)
        errors.push(
          `${f.file}:${f.line}:${f.column}: ${f.label} complexity ${f.score} (limit ${cap}). Separate a decision or dispatch path and test it independently.`,
        )
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
  for (const error of errors) console.error(`ERROR ${error}`)
  console.log(`Kilo metrics: ${files.length} changed source files, ${errors.length} regressions.`)
  return Number(errors.length > 0)
}

// A declaration on an edited line, or reindented, cannot be matched by position. Its ceiling
// still applies while the file has a single over-limit function with that label, so an edit
// beside the declaration cannot reset debt it did not create. Ambiguous labels start at 20.
function ceiling(before: Finding[], after: Finding[], finding: Finding) {
  const same = before.filter((o) => o.label === finding.label)
  const peers = after.filter((o) => o.file === finding.file && o.label === finding.label)
  return same.length === 1 && peers.length === 1 ? same[0]!.score : 20
}

if (import.meta.main)
  process.exitCode = await check(process.argv[2] ?? (await $`git merge-base origin/v2 HEAD`.text()).trim())
