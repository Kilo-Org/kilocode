// kilocode_change - new file
/**
 * Checks a release commit before the release-push job of .github/workflows/publish.yml pushes it
 * to main with the Kilo Maintainer app, which may bypass the main ruleset.
 *
 * The release-commit job writes the commit with third-party code (`bun install`,
 * `changeset version`), so this check trusts nothing it wrote: it compares the full trees of the
 * two commits with git and allows only what the version bump and `changeset version` change.
 * Imports only Node built-ins, so the release-push job runs it without installing packages.
 *
 * Allowed changes (README of .github/actions/kilo-credentials lists the same):
 * - `package.json` files (modified): only `"version"` lines, from the previous release version to
 *   the new one; same line count. Not `packages/kilo-jetbrains/package.json` (the JetBrains CLI pin).
 * - `bun.lock` (modified): the same `"version"` line rule.
 * - `packages/extensions/zed/extension.toml` (modified): only its `version = "..."` line and the
 *   `releases/download/v<version>/` part of its archive URLs.
 * - `CHANGELOG.md` files (modified): any text.
 * - `.changeset/<name>.md` (deleted), except `.changeset/README.md`.
 * Refused even where a pattern above matches: `.github/`, `script/`, `bin/`, `nix/`, every other
 * lockfile, added files, renames, every mode change (an executable bit set or cleared, a file
 * turned into a symlink) and every symlink or submodule. A file keeps its mode: some tracked
 * package.json files are executable (100755) and stay so. Every other path must have the same blob
 * and mode as in the commit it is compared with.
 */

import { execFileSync } from "node:child_process"

const DENY = [/^\.github\//, /^script\//, /^bin\//, /^nix\//]
const LOCKFILE =
  /(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|go\.sum|gradle\.lockfile|flake\.lock)$/
const PIN = "packages/kilo-jetbrains/package.json"
const EXTENSION = "packages/extensions/zed/extension.toml"
const FILE_MODES = ["100644", "100755"]
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const JSON_VERSION = /^(\s*)"version": "([^"]*)"(,?)$/
const TOML_VERSION = /^version = "([^"]*)"$/

export type Rule = { kind: "json" | "toml" | "text" | "delete" } | { refused: string }

/** What the release commit may change at `path` with git status `status`. */
export function rule(path: string, status: string): Rule {
  if (DENY.some((deny) => deny.test(path))) return { refused: "path is never part of a release commit" }
  if (path === "bun.lock") return status === "M" ? { kind: "json" } : { refused: "bun.lock may only be modified" }
  if (LOCKFILE.test(path)) return { refused: "lockfiles other than bun.lock are never part of a release commit" }
  if (path === PIN) return { refused: "the JetBrains CLI pin is bumped by its own pull request" }
  if (/(^|\/)package\.json$/.test(path)) {
    return status === "M" ? { kind: "json" } : { refused: "package.json files may only be modified" }
  }
  if (path === EXTENSION) return status === "M" ? { kind: "toml" } : { refused: "extension.toml may only be modified" }
  if (/(^|\/)CHANGELOG\.md$/.test(path)) {
    return status === "M" ? { kind: "text" } : { refused: "changelogs may only be modified" }
  }
  if (/^\.changeset\/[^/]+\.md$/.test(path) && path !== ".changeset/README.md") {
    return status === "D" ? { kind: "delete" } : { refused: "changesets may only be deleted" }
  }
  return { refused: "not a version or changelog path" }
}

type Entry = { from: string; to: string; status: string; path: string }

/** Every path whose blob or mode differs between the full trees of `from` and `to`. */
function changes(cwd: string, from: string, to: string): Entry[] {
  const out = execFileSync("git", ["diff", "--raw", "-z", "--no-renames", "--no-abbrev", from, to], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  const parts = out.split("\0")
  const entries: Entry[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]?.replace(/^:/, "").split(" ") ?? []
    entries.push({ from: meta[0] ?? "", to: meta[1] ?? "", status: meta[4] ?? "", path: parts[i + 1] ?? "" })
  }
  return entries
}

const show = (cwd: string, commit: string, path: string) =>
  execFileSync("git", ["show", `${commit}:${path}`], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })

/** Line problems of one modified file: only version lines may change, from `previous` to `version`. */
export function lines(
  kind: "json" | "toml",
  path: string,
  old: string,
  next: string,
  previous: string,
  version: string,
) {
  const before = old.split("\n")
  const after = next.split("\n")
  if (before.length !== after.length) return [`${path}: the line count changed`]
  const problems: string[] = []
  for (let i = 0; i < before.length; i++) {
    const a = before[i] ?? ""
    const b = after[i] ?? ""
    if (a === b) continue
    const where = `${path}:${i + 1}`
    if (kind === "json") {
      const match = JSON_VERSION.exec(a)
      if (!match) problems.push(`${where}: only "version" lines may change`)
      else if (match[2] !== previous) problems.push(`${where}: the old version is ${match[2]}, not ${previous}`)
      else if (b !== `${match[1]}"version": "${version}"${match[3]}`)
        problems.push(`${where}: the new line is not version ${version}`)
      continue
    }
    const match = TOML_VERSION.exec(a)
    if (match) {
      if (match[1] !== previous) problems.push(`${where}: the old version is ${match[1]}, not ${previous}`)
      else if (b !== `version = "${version}"`) problems.push(`${where}: the new line is not version ${version}`)
      continue
    }
    const from = `/releases/download/v${previous}/`
    if (!a.includes(from) || b !== a.replaceAll(from, `/releases/download/v${version}/`)) {
      problems.push(`${where}: only the version line and release download URLs may change`)
    }
  }
  return problems
}

/**
 * Problems with the change from `from` to `to` (both commits in the repository at `cwd`), for
 * release `version`. Empty when every change is one the release commit may make.
 */
export function check(input: { cwd: string; from: string; to: string; version: string }) {
  const { cwd, from, to, version } = input
  if (!VERSION.test(version)) return [`invalid release version ${JSON.stringify(version)}`]
  const previous: unknown = JSON.parse(show(cwd, from, "packages/opencode/package.json")).version
  if (typeof previous !== "string" || !VERSION.test(previous))
    return [`invalid previous version ${JSON.stringify(previous)}`]
  const problems: string[] = []
  const entries = changes(cwd, from, to)
  if (entries.length === 0) problems.push("the commit changes nothing")
  for (const entry of entries) {
    const allowed = rule(entry.path, entry.status)
    const kept = FILE_MODES.includes(entry.from) && (entry.status === "D" || entry.to === entry.from)
    if ("refused" in allowed) problems.push(`${entry.path} (${entry.status}): ${allowed.refused}`)
    if (!kept && entry.status !== "A") {
      problems.push(`${entry.path}: mode ${entry.from} -> ${entry.to}; only files that keep their mode may change`)
    }
    if ("refused" in allowed || !kept) continue
    if (allowed.kind === "json" || allowed.kind === "toml") {
      problems.push(
        ...lines(allowed.kind, entry.path, show(cwd, from, entry.path), show(cwd, to, entry.path), previous, version),
      )
    }
  }
  return problems
}

/** Problems with the commit object itself: its exact parents and, when given, its subject. */
export function shape(input: { cwd: string; commit: string; parents: string[]; subject?: string }) {
  const { cwd, commit, parents, subject } = input
  const problems: string[] = []
  const type = execFileSync("git", ["cat-file", "-t", commit], { cwd, encoding: "utf8" }).trim()
  if (type !== "commit") return [`${commit} is a ${type}, not a commit`]
  const actual = execFileSync("git", ["rev-list", "--parents", "-n", "1", commit], { cwd, encoding: "utf8" })
    .trim()
    .split(" ")
    .slice(1)
  if (actual.join(" ") !== parents.join(" ")) {
    problems.push(`commit ${commit} has parents [${actual.join(", ")}], expected [${parents.join(", ")}]`)
  }
  if (subject !== undefined) {
    const found = execFileSync("git", ["log", "-1", "--format=%s", commit], { cwd, encoding: "utf8" }).trim()
    if (found !== subject)
      problems.push(`commit subject is ${JSON.stringify(found)}, expected ${JSON.stringify(subject)}`)
  }
  return problems
}
