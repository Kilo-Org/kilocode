import { spawnSync } from "node:child_process"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { candidates, unresolved } from "../src/branding-audit"
import { KiloBranding } from "../src/branding/transform"

function safe(value: string) {
  return JSON.stringify(value).replace(
    /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`)
  return result.stdout
}

function tree(root: string, commit: string) {
  const entries = git(["ls-tree", "-r", "-z", "--full-tree", commit, "--", "packages"], root).split("\0")
  return new Map(
    entries.flatMap((entry): [string, string][] => {
      const tab = entry.indexOf("\t")
      if (tab < 0) return []
      const [mode, type, oid] = entry.slice(0, tab).split(" ")
      if ((mode !== "100644" && mode !== "100755") || type !== "blob") return []
      return [[entry.slice(tab + 1), oid]]
    }),
  )
}

function workingFile(root: string, file: string) {
  const segments = file.split("/")
  let current = root
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment)
    const info = lstatSync(current, { throwIfNoEntry: false })
    if (!info || info.isSymbolicLink() || (index < segments.length - 1 ? !info.isDirectory() : !info.isFile())) return
  }
  const resolved = realpathSync(current)
  if (!resolved.startsWith(root + path.sep)) return
  return readFileSync(resolved, "utf8")
}

function main() {
  const args = process.argv.slice(2)
  if (!args[0] || args.length > 2 || (args[1] && args[1] !== "--working-tree")) {
    throw new Error("Usage: bun run script/branding-audit.ts <git-base-commit> [--working-tree]")
  }
  const root = realpathSync(git(["rev-parse", "--show-toplevel"], process.cwd()).replace(/\r?\n$/, ""))
  const base = git(["rev-parse", "--verify", "--end-of-options", `${args[0]}^{commit}`], root).trim()
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"], root).trim()
  const working = args[1] === "--working-tree"
  const before = tree(root, base)
  const after = working ? undefined : tree(root, head)
  const files = new Set(
    git(
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--name-only",
        "--no-renames",
        "-z",
        base,
        ...(working ? [] : [head]),
        "--",
      ],
      root,
    ).split("\0"),
  )
  if (working)
    for (const file of git(["ls-files", "--others", "--exclude-standard", "-z"], root).split("\0")) files.add(file)
  console.log(`Branding audit: ${base} to ${working ? `working tree (HEAD ${head}, including untracked files)` : head}`)
  console.log("Uses the branding transform from the running checkout.")
  console.log(
    "Checks changed packages/*/src TS/JS strings, templates and JSX, and raw txt/html/svg lines; excludes Kilo-owned paths and symlinks.",
  )
  console.log(
    "TS/JS imports, type syntax, technical URLs and OpenCode Go/Console/Zen names are excluded; asset lines are scanned as raw text.",
  )
  console.log(
    "Identical text in indistinguishable contexts, computed expressions, other assets, artwork and runtime reachability require manual review.",
  )
  console.log(
    "Duplicate baseline candidates and unmatched AST nodes need review; same-shape node reordering is not tracked.",
  )
  let failures = 0
  for (const file of [...files].sort()) {
    if (
      !/^packages\/(?!kilo-)[^/]+\/src\//.test(file) ||
      file.includes("/src/kilocode/") ||
      !/\.(?:[cm]?[jt]sx?|txt|html|svg)$/i.test(file)
    )
      continue
    try {
      const oid = after?.get(file)
      const current = working ? workingFile(root, file) : oid ? git(["cat-file", "blob", oid], root) : undefined
      if (current === undefined || !candidates(file, current).length) continue
      const previous = before.has(file) ? git(["cat-file", "blob", before.get(file)!], root) : ""
      const transformed = /\.[cm]?[jt]sx?$/i.test(file)
        ? KiloBranding.transform(path.join(root, file), current)
        : current
      for (const item of unresolved(file, previous, current, transformed)) {
        console.log(`${safe(file)}:${item.line}: ${safe(item.text)}`)
        failures++
      }
    } catch (error) {
      console.error(`${safe(file)}: audit failed: ${safe(error instanceof Error ? error.message : String(error))}`)
      failures++
    }
  }
  if (failures) {
    console.error(`Branding audit failed: ${failures} unresolved candidate(s) or errors`)
    process.exitCode = 1
    return
  }
  console.log("Branding audit passed")
}

try {
  main()
} catch (error) {
  console.error(`Branding audit failed: ${safe(error instanceof Error ? error.message : String(error))}`)
  process.exitCode = 1
}
