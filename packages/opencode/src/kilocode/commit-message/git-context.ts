import type { GitContext, FileChange } from "./types"

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
    windowsHide: true, // kilocode_change - prevent cmd.exe flash on Windows
  })
  return result.stdout.toString().trimEnd()
}

// Parses `git diff --name-status -z`. Records are NUL-separated so names keep
// their real bytes; without `-z`, git C-quotes names with non-ASCII characters.
export function parseNameStatus(output: string): Array<{ status: string; path: string }> {
  const fields = output.split("\0")
  const result: Array<{ status: string; path: string }> = []
  for (let i = 0; fields.at(i); ) {
    const status = fields.at(i) ?? ""
    // Renames and copies carry two paths (old, new); use the new path
    const pair = status.startsWith("R") || status.startsWith("C")
    result.push({ status, path: fields.at(pair ? i + 2 : i + 1) ?? "" })
    i += pair ? 3 : 2
  }
  return result
}

// Parses `git status --porcelain -z`. Each record is `XY path`; a rename or
// copy record is followed by one more field holding the source path. Without
// `-z`, git C-quotes names with spaces or non-ASCII characters.
export function parsePorcelain(output: string): Array<{ status: string; path: string }> {
  const fields = output.split("\0")
  const result: Array<{ status: string; path: string }> = []
  for (let i = 0; i < fields.length; i++) {
    const line = fields.at(i)
    if (!line) continue
    const xy = line.slice(0, 2)
    result.push({ status: xy.trim(), path: line.slice(3) })
    if (xy.includes("R") || xy.includes("C")) i++
  }
  return result
}

export function mapStatus(code: string): FileChange["status"] {
  if (code.startsWith("R")) return "renamed"
  if (code === "A" || code === "??" || code === "?") return "added"
  if (code === "D") return "deleted"
  if (code === "M") return "modified"
  return "modified"
}

export function isUntracked(code: string): boolean {
  return code === "??" || code === "?"
}

export async function getGitContext(repoPath: string, selectedFiles?: string[]): Promise<GitContext> {
  const branch = git(["branch", "--show-current"], repoPath) || "HEAD"
  const log = git(["log", "--oneline", "-5"], repoPath)
  const recentCommits = log ? log.split("\n") : []

  // Check staged files first
  const staged = parseNameStatus(git(["diff", "--name-status", "-z", "--cached"], repoPath))
  const useStaged = staged.length > 0

  // Fall back to all changes if nothing staged
  const raw = useStaged ? staged : parsePorcelain(git(["status", "--porcelain", "-z"], repoPath))

  const selected = selectedFiles ? new Set(selectedFiles) : undefined

  const files: FileChange[] = []
  for (const entry of raw) {
    if (isLockFile(entry.path)) continue
    if (selected && !selected.has(entry.path)) continue

    const status = mapStatus(entry.status)
    const untracked = isUntracked(entry.status)

    let diff: string
    if (untracked) {
      diff = `New untracked file: ${entry.path}`
    } else if (status === "deleted") {
      diff = useStaged
        ? git(["diff", "--cached", "--", entry.path], repoPath)
        : git(["diff", "--", entry.path], repoPath)
    } else {
      const raw = useStaged
        ? git(["diff", "--cached", "--", entry.path], repoPath)
        : git(["diff", "--", entry.path], repoPath)

      // Detect binary files
      if (raw.includes("Binary files") || raw.includes("GIT binary patch")) {
        diff = `Binary file ${entry.path} has been modified`
      } else {
        diff = raw
      }
    }

    // Truncate large diffs
    if (diff.length > MAX_DIFF_LENGTH) {
      diff = diff.slice(0, MAX_DIFF_LENGTH) + "\n... [truncated]"
    }

    files.push({ status, path: entry.path, diff })
  }

  return { branch, recentCommits, files }
}
