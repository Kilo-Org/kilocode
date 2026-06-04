// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  attachWorkspaceCheckpoint,
  captureWorkspaceCheckpoint,
  normalizeGitUrl,
  restoreCloudSessionWorkspace,
  restoreWorkspaceCheckpoint,
  WORKSPACE_CHECKPOINT_KEY,
} from "../../../src/kilocode/session-portability/git-checkpoint"

async function git(dir: string, args: string[], input?: string) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: dir,
    stdin: input ? "pipe" : undefined,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (input && proc.stdin) {
    proc.stdin.write(input)
    proc.stdin.end()
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
  return stdout.trim()
}

async function repo() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-checkpoint-"))
  await git(dir, ["init", "-b", "main"])
  await git(dir, ["config", "user.email", "test@example.com"])
  await git(dir, ["config", "user.name", "Test User"])
  await git(dir, ["remote", "add", "origin", "git@github.com:Kilo-Org/kilocode.git"])
  await writeFile(path.join(dir, "tracked.txt"), "base\n")
  await mkdir(path.join(dir, "nested"))
  await writeFile(path.join(dir, "nested", "keep.txt"), "keep\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "initial"])
  return dir
}

describe("workspace git checkpoints", () => {
  test("normalizes common remote URL forms to the same repo key", () => {
    expect(normalizeGitUrl("git@github.com:Kilo-Org/kilocode.git")).toBe("github.com/Kilo-Org/kilocode")
    expect(normalizeGitUrl("https://token@github.com/Kilo-Org/kilocode.git?x=1")).toBe(
      "github.com/Kilo-Org/kilocode",
    )
    expect(normalizeGitUrl("ssh://git@github.com/Kilo-Org/kilocode.git")).toBe("github.com/Kilo-Org/kilocode")
  })

  test("captures tracked and untracked dirty state and restores it into a separate worktree", async () => {
    const dir = await repo()
    const head = await git(dir, ["rev-parse", "HEAD"])
    await writeFile(path.join(dir, "tracked.txt"), "base\nchanged\n")
    await writeFile(path.join(dir, "untracked.txt"), "new\n")
    await writeFile(path.join(dir, "nested", "new.txt"), "nested new\n")
    await git(dir, ["rm", "nested/keep.txt"])

    const checkpoint = await captureWorkspaceCheckpoint({ directory: dir })

    expect(checkpoint?.head).toBe(head)
    expect(checkpoint?.gitUrl).toBe("github.com/Kilo-Org/kilocode")
    expect(checkpoint?.patch).toContain("tracked.txt")
    expect(checkpoint?.patch).toContain("untracked.txt")
    expect(checkpoint?.patch).toContain("nested/new.txt")
    expect(checkpoint?.patch).toContain("nested/keep.txt")

    const target = path.join(await mkdtemp(path.join(os.tmpdir(), "kilo-checkpoint-restore-")), "session")
    const restored = await restoreWorkspaceCheckpoint({
      directory: dir,
      checkpoint: checkpoint!,
      targetDirectory: target,
      branch: "kilo-restore-test",
    })

    expect(restored).toEqual({ status: "restored", directory: target })
    if (restored.status !== "restored") throw new Error("expected restore to succeed")
    expect(restored.directory).toBe(target)
    expect(await readFile(path.join(target, "tracked.txt"), "utf8")).toBe("base\nchanged\n")
    expect(await readFile(path.join(target, "untracked.txt"), "utf8")).toBe("new\n")
    expect(await readFile(path.join(target, "nested", "new.txt"), "utf8")).toBe("nested new\n")
    expect(await Bun.file(path.join(target, "nested", "keep.txt")).exists()).toBe(false)
    expect(await readFile(path.join(dir, "tracked.txt"), "utf8")).toBe("base\nchanged\n")
  })

  test("skips restore when the current repo does not match the checkpoint remote", async () => {
    const dir = await repo()
    const other = await repo()
    await git(other, ["remote", "set-url", "origin", "git@github.com:Kilo-Org/other.git"])
    const checkpoint = await captureWorkspaceCheckpoint({ directory: dir })

    const restored = await restoreWorkspaceCheckpoint({
      directory: other,
      checkpoint: checkpoint!,
      targetDirectory: path.join(await mkdtemp(path.join(os.tmpdir(), "kilo-checkpoint-other-")), "session"),
      branch: "kilo-restore-other",
    })

    expect(restored).toEqual({ status: "skipped", reason: "different_repo" })
  })

  test("removes the created worktree when patch apply fails", async () => {
    const dir = await repo()
    const checkpoint = await captureWorkspaceCheckpoint({ directory: dir })
    const target = path.join(await mkdtemp(path.join(os.tmpdir(), "kilo-checkpoint-patch-fail-")), "session")

    const restored = await restoreWorkspaceCheckpoint({
      directory: dir,
      checkpoint: {
        ...checkpoint!,
        patch: "diff --git a/missing.txt b/missing.txt\n--- a/missing.txt\n+++ b/missing.txt\n@@ -1 +1 @@\n-old\n+new\n",
      },
      targetDirectory: target,
      branch: "kilo-restore-patch-fail",
    })

    expect(restored.status).toBe("failed")
    expect(restored.reason).toBe("patch_failed")
    expect(await Bun.file(target).exists()).toBe(false)
    expect(await git(dir, ["worktree", "list", "--porcelain"])).not.toContain(target)
  })

  test("embeds a checkpoint in a session-shaped object without mutating the original", async () => {
    const dir = await repo()
    await writeFile(path.join(dir, "untracked.txt"), "new\n")
    const session = { id: "ses_123", directory: dir, title: "session" }

    const next = await attachWorkspaceCheckpoint(session, { now: () => 123 })

    expect(session).not.toHaveProperty(WORKSPACE_CHECKPOINT_KEY)
    expect(next).toHaveProperty(WORKSPACE_CHECKPOINT_KEY)
    expect(next[WORKSPACE_CHECKPOINT_KEY]?.createdAt).toBe(123)
    expect(next[WORKSPACE_CHECKPOINT_KEY]?.patch).toContain("untracked.txt")
  })

  test("restores a cloud session workspace from the checkpoint embedded in session info", async () => {
    const dir = await repo()
    await writeFile(path.join(dir, "tracked.txt"), "base\nchanged\n")
    await writeFile(path.join(dir, "untracked.txt"), "new\n")
    const info = await attachWorkspaceCheckpoint({ id: "ses_source", directory: dir, title: "session" })
    const peer = path.join(await mkdtemp(path.join(os.tmpdir(), "kilo-checkpoint-peer-")), "peer")
    await git(dir, ["worktree", "add", peer, "HEAD"])
    const target = path.join(await mkdtemp(path.join(os.tmpdir(), "kilo-checkpoint-cloud-")), "session")

    const restored = await restoreCloudSessionWorkspace({
      info,
      directory: peer,
      targetDirectory: target,
      sessionID: "ses_imported",
    })

    expect(restored.result).toEqual({ status: "restored", directory: target })
    expect(restored.directory).toBe(target)
    expect(await readFile(path.join(target, "tracked.txt"), "utf8")).toBe("base\nchanged\n")
    expect(await readFile(path.join(target, "untracked.txt"), "utf8")).toBe("new\n")
  })
})
