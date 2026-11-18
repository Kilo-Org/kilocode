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
  if (result.exitCode > 1) throw new Error(result.stderr.toString() || `Oxlint exited ${result.exitCode}`)
  const report: Report = result.json()
  if (report.number_of_files !== sources.size) throw new Error("Oxlint did not measure the complete snapshot")
  return report.diagnostics.map(({ filename, code, message, labels }) => {
    const match = /^(.+) has a complexity of (\d+)\. Maximum allowed is 20\.$/.exec(message)
    if (code !== "eslint(complexity)" || !match || !labels[0]) throw new Error(`${filename}: ${message}`)
    return { file: filename.replaceAll("\\", "/"), label: match[1]!, score: Number(match[2]), ...labels[0].span }
  })
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

async function check(base: string) {
  const registry = await readMirrors(process.cwd())
  const mirrors = new Set(Object.values(registry.mirrors).map((x) => x.mirror))
  const changed = await $`git diff --no-renames --diff-filter=AMT --name-only -z ${base} -- packages`.text()
  const added = await $`git ls-files --others --exclude-standard -z -- packages`.text()
  const files = [...new Set((changed + added).split("\0"))].filter(
    (f) => product.test(f) && !excluded.test(f) && !mirrors.has(f),
  )
  const originals = new Set(
    files.length ? (await $`git ls-tree -rz --name-only ${base} -- packages`.text()).split("\0") : [],
  )
  const before = new Map<string, string>()
  const after = new Map<string, string>()
  const errors: string[] = []
  for (const file of files) {
    if ((await lstat(file)).isSymbolicLink()) throw new Error(`Cannot measure symbolic link: ${file}`)
    if (originals.has(file)) before.set(file, await $`git show ${base + ":" + file}`.text())
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
      if (before.has(f.file) && !patches.has(f.file)) {
        patches.set(
          f.file,
          await $`git diff --no-ext-diff --no-textconv --no-color --no-renames --ignore-cr-at-eol -U0 --inter-hunk-context=0 ${base} -- ${f.file}`.text(),
        )
      }
      const line = originalLine(f.line, patches.get(f.file) ?? "")
      const cap =
        old.find((o) => o.file === f.file && o.line === line && o.column === f.column && o.label === f.label)?.score ??
        20
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

if (import.meta.main)
  process.exitCode = await check(process.argv[2] ?? (await $`git merge-base origin/v2 HEAD`.text()).trim())
