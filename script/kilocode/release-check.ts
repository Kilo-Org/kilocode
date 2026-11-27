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
 * - `package.json` files (modified): only `"version"` lines change, from any version to the release
 *   version; same line count. Not `packages/kilo-jetbrains/package.json` (the JetBrains CLI pin).
 * - `bun.lock` (modified): the same `"version"` line rule.
 * - `packages/extensions/zed/extension.toml` (modified): only its `version = "..."` line and the
 *   `releases/download/v<version>/` part of its archive URLs, to the release version.
 * - The changelogs of `packages/opencode`, `packages/kilo-vscode` and `packages/kilo-jetbrains`
 *   (modified): the old text stays an exact suffix after the `# title` line, and the one block
 *   prepended before it (at most 64 KiB) holds only changesets output: a `## <version>` header
 *   (the release version, any version for JetBrains), `### Major|Minor|Patch Changes`, blank
 *   lines, bullets whose text is a line of a `.changeset/*.md` file the commit deletes (read from
 *   the parent tree), and changesets' "Updated dependencies" lines.
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
/** Each changelog with whether its block header must be the release version. */
const CHANGELOGS: Record<string, "release" | "any"> = {
  "packages/opencode/CHANGELOG.md": "release",
  "packages/kilo-vscode/CHANGELOG.md": "release",
  "packages/kilo-jetbrains/CHANGELOG.md": "any",
}
const CHANGELOG_LIMIT = 64 * 1024
const FILE_MODES = ["100644", "100755"]
const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
const VERSION = new RegExp(`^${SEMVER}$`)
const JSON_VERSION = new RegExp(`^(\\s*)"version": "(${SEMVER})"(,?)$`)
const TOML_VERSION = new RegExp(`^version = "${SEMVER}"$`)
const DOWNLOAD = new RegExp(`/releases/download/v${SEMVER}/`, "g")
const COMMIT_LINK = String.raw`\[\x60[0-9a-f]{7,40}\x60\]\(https://github\.com/Kilo-Org/kilocode/commit/[0-9a-f]{40}\)`
const USER_LINK = String.raw`\[@[\w.-]+(?:\[bot\])?\]\(https://github\.com/[\w.-]+(?:\[bot\])?\)`
const DOWNLOAD_ONE = new RegExp(DOWNLOAD.source)
/** The link prefix changesets (script/changelog-github.cjs) writes before a summary's first line. */
const PREFIX = new RegExp(
  String.raw`^(?:\[#\d+\]\(https://github\.com/Kilo-Org/kilocode/pull/\d+\) )?(?:${COMMIT_LINK} )?(?:Thanks ${USER_LINK}(?:(?:, | and )${USER_LINK})*! )?- `,
)
const DEPENDENCIES = new RegExp(String.raw`^Updated dependencies \[${COMMIT_LINK}(?:, ${COMMIT_LINK})*\]:$`)
const DEPENDENCY = new RegExp(`^- (?:@[a-z0-9-]+/)?[a-z0-9._-]+@${SEMVER}$`)

/** The identity of release commits and merges, the one setup-git-committer gives the Kilo Maintainer app. */
export const IDENTITY = { name: "kilo-maintainer[bot]", email: "kilo-maintainer[bot]@users.noreply.github.com" }

export type Rule = { kind: "json" | "toml" | "changelog" | "delete" } | { refused: string }

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
  if (path in CHANGELOGS) return status === "M" ? { kind: "changelog" } : { refused: "changelogs may only be modified" }
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

/** Line problems of one modified file: only version lines may change, from any version to `version`. */
export function lines(kind: "json" | "toml", path: string, old: string, next: string, version: string) {
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
      else if (b !== `${match[1]}"version": "${version}"${match[3]}`) {
        problems.push(`${where}: the new line is not version ${version}`)
      }
      continue
    }
    if (TOML_VERSION.test(a)) {
      if (b !== `version = "${version}"`) problems.push(`${where}: the new line is not version ${version}`)
      continue
    }
    if (!DOWNLOAD_ONE.test(a) || b !== a.replaceAll(DOWNLOAD, `/releases/download/v${version}/`)) {
      problems.push(`${where}: only the version line and release download URLs may change`)
    }
  }
  return problems
}

/** The body lines of a changeset file: the text after its front matter, without trailing spaces. */
export function body(text: string) {
  // changesets reads front matter after a byte order mark too (seen in .changeset/fix-windows-arm64-error.md).
  const match = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n"))
  return (match?.[1] ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
}

/**
 * Problems of one changelog change: `next` must be `old` with one block of changesets output
 * inserted after the `# title` line. `header` is the version the block's `## ` header must name,
 * or undefined for any version. `summaries` are the body lines of the changesets the commit deletes.
 */
export function changelog(path: string, old: string, next: string, header: string | undefined, summaries: Set<string>) {
  const title = /^# [^\n]*\n\n/.exec(old)?.[0]
  if (!title || !next.startsWith(title)) return [`${path}: the "# title" line and the blank line after it must stay`]
  const rest = old.slice(title.length)
  const updated = next.slice(title.length)
  if (!updated.endsWith(rest)) return [`${path}: the old text must stay unchanged after the new block`]
  const block = updated.slice(0, updated.length - rest.length)
  if (block === "") return [`${path}: no block was added`]
  if (Buffer.byteLength(block) > CHANGELOG_LIMIT) return [`${path}: the new block is larger than 64 KiB`]
  if (!block.endsWith("\n")) return [`${path}: the new block must end with a newline`]
  const added = block.slice(0, -1).split("\n")
  const problems: string[] = []
  const want = header === undefined ? new RegExp(`^## ${SEMVER}$`) : undefined
  const first = added[0] ?? ""
  if (want ? !want.test(first) : first !== `## ${header}`) {
    problems.push(
      `${path}: the new block must start with "## ${header ?? "<version>"}", found ${JSON.stringify(first)}`,
    )
  }
  for (const [i, line] of added.slice(1).entries()) {
    if (line === "" || /^### (?:Major|Minor|Patch) Changes$/.test(line)) continue
    if (line.startsWith("- ")) {
      const text = line.slice(2).trimEnd()
      const summary = text.replace(PREFIX, "")
      if (DEPENDENCIES.test(text) || summaries.has(summary) || summaries.has(text)) continue
    } else if (line.startsWith("  ")) {
      const text = line.slice(2).trimEnd()
      if (DEPENDENCY.test(text) || summaries.has(text)) continue
    }
    problems.push(
      `${path}: line ${i + 2} of the new block is not changesets output of a deleted changeset: ${JSON.stringify(line.slice(0, 120))}`,
    )
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
  const problems: string[] = []
  const entries = changes(cwd, from, to)
  if (entries.length === 0) problems.push("the commit changes nothing")
  const summaries = new Set(
    entries
      .filter((entry) => entry.status === "D" && "kind" in rule(entry.path, entry.status))
      .flatMap((entry) => (entry.path.startsWith(".changeset/") ? body(show(cwd, from, entry.path)) : [])),
  )
  for (const entry of entries) {
    const allowed = rule(entry.path, entry.status)
    const kept = FILE_MODES.includes(entry.from) && (entry.status === "D" || entry.to === entry.from)
    if ("refused" in allowed) problems.push(`${entry.path} (${entry.status}): ${allowed.refused}`)
    if (!kept && entry.status !== "A") {
      problems.push(`${entry.path}: mode ${entry.from} -> ${entry.to}; only files that keep their mode may change`)
    }
    if ("refused" in allowed || !kept) continue
    if (allowed.kind === "json" || allowed.kind === "toml") {
      problems.push(...lines(allowed.kind, entry.path, show(cwd, from, entry.path), show(cwd, to, entry.path), version))
    }
    if (allowed.kind === "changelog") {
      const header = CHANGELOGS[entry.path] === "release" ? version : undefined
      problems.push(...changelog(entry.path, show(cwd, from, entry.path), show(cwd, to, entry.path), header, summaries))
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
    if (found !== subject) {
      problems.push(`commit subject is ${JSON.stringify(found)}, expected ${JSON.stringify(subject)}`)
    }
  }
  return problems
}
