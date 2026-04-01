import * as nodePath from "path"
import * as fs from "fs/promises"
import * as cp from "child_process"

/**
 * Portable git state snapshot — captures uncommitted changes as patches
 * that can be applied to any directory on the same commit.
 *
 * Used by "Continue in Worktree" to copy git state from the user's
 * working tree into a fresh worktree without modifying the source.
 */
export interface GitSnapshot {
  branch: string
  head: string
  /** Binary-safe unified diff of unstaged changes, or null if clean. */
  unstaged: string | null
  /** Binary-safe unified diff of staged changes, or null if none staged. */
  staged: string | null
  /** Untracked files (new files not yet added to git). */
  untracked: UntrackedFile[]
}

export interface UntrackedFile {
  /** Relative path from repo root. */
  path: string
  /** Raw file content. */
  content: Buffer
}

const MAX_FILE = 10 * 1024 * 1024 // 10 MB

function git(args: string[], cwd: string, stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    if (stdin !== undefined) {
      // Use spawn for stdin piping — execFile doesn't reliably create a stdin pipe
      const child = cp.spawn("git", args, { cwd, windowsHide: true })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()))
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
      child.stdin.end(stdin)
    } else {
      cp.execFile(
        "git",
        args,
        { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ code: 0, stdout, stderr })
            return
          }
          const exec = error as cp.ExecException
          resolve({ code: typeof exec.code === "number" ? exec.code : 1, stdout: stdout ?? "", stderr: stderr ?? "" })
        },
      )
    }
  })
}

async function raw(args: string[], cwd: string): Promise<string> {
  const result = await git(args, cwd)
  return result.stdout.trim()
}

/**
 * Capture the current git state from `cwd` as a portable snapshot.
 * This is a read-only operation — the source directory is never modified.
 */
export async function capture(cwd: string, log: (...args: unknown[]) => void): Promise<GitSnapshot> {
  const patch = (args: string[]) =>
    git(args, cwd).then((r) => {
      const out = r.stdout
      return out.trim() ? out : null
    })

  const [branch, head, unstaged, staged, untrackedRaw] = await Promise.all([
    raw(["branch", "--show-current"], cwd),
    raw(["rev-parse", "HEAD"], cwd),
    patch(["diff", "--binary"]),
    patch(["diff", "--cached", "--binary"]),
    raw(["ls-files", "--others", "--exclude-standard"], cwd).then((s: string) =>
      s.split("\n").filter((l: string) => l.length > 0),
    ),
  ])

  const untracked: UntrackedFile[] = []
  for (const rel of untrackedRaw) {
    const full = nodePath.resolve(cwd, rel)
    try {
      const stat = await fs.stat(full)
      if (stat.size > MAX_FILE) {
        log(`Skipping untracked file ${rel}: ${(stat.size / 1024 / 1024).toFixed(1)} MB exceeds limit`)
        continue
      }
      const content = await fs.readFile(full)
      untracked.push({ path: rel, content })
    } catch (err) {
      log(`Failed to read untracked file ${rel}:`, err)
    }
  }

  return { branch, head, unstaged, staged, untracked }
}

/**
 * Apply a git snapshot to a target directory.
 * Applies staged changes (and re-stages them), unstaged changes, and writes untracked files.
 */
export async function apply(
  snapshot: GitSnapshot,
  target: string,
  log: (...args: unknown[]) => void,
): Promise<{ ok: boolean; error?: string }> {
  // Apply staged patch first, then re-stage those files
  if (snapshot.staged) {
    const result = await git(["apply", "--whitespace=nowarn", "-"], target, snapshot.staged)
    if (result.code !== 0) {
      const msg = result.stderr.trim() || "Patch did not apply"
      log("Failed to apply staged patch:", msg)
      return { ok: false, error: `Staged patch failed: ${msg}` }
    }
    const files = parsePatchFiles(snapshot.staged)
    if (files.length > 0) {
      await git(["add", "--", ...files], target)
    }
  }

  // Apply unstaged patch (leave as unstaged working-tree changes)
  if (snapshot.unstaged) {
    const result = await git(["apply", "--whitespace=nowarn", "-"], target, snapshot.unstaged)
    if (result.code !== 0) {
      const msg = result.stderr.trim() || "Patch did not apply"
      log("Failed to apply unstaged patch:", msg)
      return { ok: false, error: `Unstaged patch failed: ${msg}` }
    }
  }

  // Write untracked files
  for (const file of snapshot.untracked) {
    const full = nodePath.resolve(target, file.path)
    try {
      await fs.mkdir(nodePath.dirname(full), { recursive: true })
      await fs.writeFile(full, file.content)
    } catch (err) {
      log(`Failed to write untracked file ${file.path}:`, err)
    }
  }

  return { ok: true }
}

/** Extract file paths from a unified diff's `diff --git a/... b/...` headers. */
function parsePatchFiles(patch: string): string[] {
  const files: string[] = []
  for (const line of patch.split("\n")) {
    const match = /^diff --git a\/.+ b\/(.+)$/.exec(line)
    if (match && match[1]) files.push(match[1])
  }
  return files
}
