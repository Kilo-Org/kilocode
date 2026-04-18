// Audit Appendix C: cross-platform replacement for the shell-based check-devilcode-change
// script (the original `! grep -rn ... | grep -v ...` chain only works under bash/grep and
// silently passes on Windows/PowerShell because the binaries are missing).
//
// Behavior: scan all packages/* except opencode/ for any devilcode-change marker outside
// excluded paths. Documentation references that wrap the literal in backticks are ignored.
// Any other occurrence is reported and the script exits 1.

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const PACKAGES = path.join(ROOT, "packages")

const EXCLUDED_DIRS = new Set(["node_modules", "dist", "out", ".turbo", ".vscode-test"])
const EXCLUDED_FILES = new Set(["package.json", "package-lock.json", "bun.lock", "bun.lockb"])
const EXCLUDED_EXTS = new Set([
  ".md",
  ".lock",
  ".lockb",
  ".log",
  ".png",
  ".jpg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
])

// Build the marker at runtime so this script does not match itself.
const MARKER = ["devilcode", "change"].join("_")
const SELF_FILE = path.resolve(import.meta.dir, "check-devilcode-change.ts")

type Finding = { file: string; line: number; text: string }

async function roots() {
  const entries = await readdir(PACKAGES, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== "opencode")
    .map((entry) => path.join(PACKAGES, entry.name))
}

async function* walk(dir: string): AsyncGenerator<string> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue
        yield* walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (EXCLUDED_FILES.has(entry.name)) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (EXCLUDED_EXTS.has(ext)) continue
      if (path.resolve(full) === SELF_FILE) continue
      yield full
    }
  } catch (err) {
    console.warn(`check-devilcode-change: failed to read ${dir}:`, err)
    return
  }
}

async function scan(root: string): Promise<Finding[]> {
  if (!(await Bun.file(root).exists())) return []
  const findings: Finding[] = []
  for await (const file of walk(root)) {
    let content: string
    try {
      content = await readFile(file, "utf8")
    } catch (err) {
      console.warn(`check-devilcode-change: failed to read ${file}:`, err)
      continue
    }
    if (!content.includes(MARKER)) continue
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.includes(MARKER)) continue
      // Documentation references write the literal as `devilcode_change` (backticks).
      // Treat every other occurrence as a real marker that should not exist outside opencode.
      const docRef = line.includes("`devilcode_change`")
      if (docRef && !line.replace(/`devilcode_change`/g, "").includes(MARKER)) continue
      findings.push({ file, line: i + 1, text: line.trim() })
    }
  }
  return findings
}

async function main() {
  const all: Finding[] = []
  for (const root of await roots()) {
    all.push(...(await scan(root)))
  }
  if (all.length === 0) {
    console.log("check-devilcode-change: no stale markers found")
    return
  }
  console.error(`check-devilcode-change: ${all.length} finding(s):`)
  for (const f of all) {
    const rel = path.relative(process.cwd(), f.file)
    console.error(`  ${rel}:${f.line}  ${f.text}`)
  }
  process.exit(1)
}

main().catch((err) => {
  console.error("check-devilcode-change: fatal:", err)
  process.exit(2)
})
