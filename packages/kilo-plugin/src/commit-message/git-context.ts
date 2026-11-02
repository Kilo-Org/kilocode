export * as CommitMessageGit from "./git-context.js"

export interface FileChange {
  readonly status: "added" | "modified" | "deleted" | "renamed"
  readonly path: string
  /** Diff content, or a placeholder for binary and untracked files. */
  readonly diff: string
}

export interface GitContext {
  readonly branch: string
  /** The last five commit summaries. */
  readonly recentCommits: string[]
  readonly files: FileChange[]
}

/** Lock files say nothing a commit message needs and can be very large. */
const LOCK_FILES = new Set([
  // --- JavaScript / Node.js ---
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "shrinkwrap.yaml",
  "bun.lockb",
  "bun.lock",
  ".pnp.js",
  ".pnp.cjs",
  "jspm.lock",

  // --- Python ---
  "Pipfile.lock",
  "poetry.lock",
  "pdm.lock",
  ".pdm-lock.toml",
  "uv.lock",
  "conda-lock.yml",
  "pylock.toml",

  // --- Ruby ---
  "Gemfile.lock",

  // --- PHP ---
  "composer.lock",

  // --- Java / JVM ---
  "gradle.lockfile",
  "lockfile.json",
  "dependency-lock.json",
  "dependency-reduced-pom.xml",
  "coursier.lock",

  // --- Scala ---
  "build.sbt.lock",

  // --- .NET ---
  "packages.lock.json",
  "paket.lock",
  "project.assets.json",

  // --- Rust ---
  "Cargo.lock",

  // --- Go ---
  "go.sum",
  "Gopkg.lock",
  "glide.lock",

  // --- Zig ---
  "build.zig.zon.lock",

  // --- OCaml ---
  "dune.lock",
  "opam.lock",

  // --- Swift / iOS ---
  "Package.resolved",
  "Podfile.lock",
  "Cartfile.resolved",

  // --- Dart / Flutter ---
  "pubspec.lock",

  // --- Elixir / Erlang ---
  "mix.lock",
  "rebar.lock",

  // --- Haskell ---
  "stack.yaml.lock",
  "cabal.project.freeze",

  // --- Elm ---
  "exact-dependencies.json",

  // --- Crystal ---
  "shard.lock",

  // --- Julia ---
  "Manifest.toml",
  "JuliaManifest.toml",

  // --- R ---
  "renv.lock",
  "packrat.lock",

  // --- Nim ---
  "nimble.lock",

  // --- D ---
  "dub.selections.json",

  // --- Lua ---
  "rocks.lock",

  // --- Perl ---
  "carton.lock",
  "cpanfile.snapshot",

  // --- C/C++ ---
  "conan.lock",
  "vcpkg-lock.json",

  // --- Infrastructure as Code ---
  ".terraform.lock.hcl",
  "Berksfile.lock",
  "Puppetfile.lock",
  "MODULE.bazel.lock",

  // --- Nix ---
  "flake.lock",

  // --- Deno ---
  "deno.lock",

  // --- DevContainers ---
  "devcontainer.lock.json",
])

export const MAX_DIFF_LENGTH = 4000

export function isLockFile(filepath: string): boolean {
  const name = filepath.split("/").pop() ?? filepath
  return LOCK_FILES.has(name)
}

export function git(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // No console window flashes on Windows for each git call.
    windowsHide: true,
  })
  return result.stdout.toString().trimEnd()
}

export function parseNameStatus(output: string): Array<{ status: string; path: string }> {
  if (!output) return []
  return output.split("\n").map((line) => {
    const [status = "", ...rest] = line.split("\t")
    // A rename lists the old and the new path; keep the new one.
    return { status, path: status.startsWith("R") ? (rest[1] ?? rest[0] ?? "") : rest.join("\t") }
  })
}

export function parsePorcelain(output: string): Array<{ status: string; path: string }> {
  if (!output) return []
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }))
}

export function mapStatus(code: string): FileChange["status"] {
  if (code.startsWith("R")) return "renamed"
  if (code === "A" || code === "??" || code === "?") return "added"
  if (code === "D") return "deleted"
  return "modified"
}

export function isUntracked(code: string): boolean {
  return code === "??" || code === "?"
}

/**
 * The staged changes, or every change (including untracked files) when nothing is staged, without lock files and,
 * when `selectedFiles` is set, only those paths. Each diff is cut at `MAX_DIFF_LENGTH` characters.
 */
export function getGitContext(repoPath: string, selectedFiles?: readonly string[]): GitContext {
  const branch = git(["branch", "--show-current"], repoPath) || "HEAD"
  const log = git(["log", "--oneline", "-5"], repoPath)
  const staged = parseNameStatus(git(["diff", "--name-status", "--cached"], repoPath))
  const useStaged = staged.length > 0
  const raw = useStaged ? staged : parsePorcelain(git(["status", "--porcelain"], repoPath))
  const selected = selectedFiles ? new Set(selectedFiles) : undefined
  const files = raw
    .filter((entry) => !isLockFile(entry.path) && (!selected || selected.has(entry.path)))
    .map((entry): FileChange => {
      const status = mapStatus(entry.status)
      const diff = changeDiff(entry, status, useStaged, repoPath)
      return {
        status,
        path: entry.path,
        diff: diff.length > MAX_DIFF_LENGTH ? diff.slice(0, MAX_DIFF_LENGTH) + "\n... [truncated]" : diff,
      }
    })
  return { branch, recentCommits: log ? log.split("\n") : [], files }
}

function changeDiff(entry: { status: string; path: string }, status: FileChange["status"], staged: boolean, cwd: string) {
  if (isUntracked(entry.status)) return `New untracked file: ${entry.path}`
  const diff = git(staged ? ["diff", "--cached", "--", entry.path] : ["diff", "--", entry.path], cwd)
  if (status !== "deleted" && (diff.includes("Binary files") || diff.includes("GIT binary patch")))
    return `Binary file ${entry.path} has been modified`
  return diff
}
