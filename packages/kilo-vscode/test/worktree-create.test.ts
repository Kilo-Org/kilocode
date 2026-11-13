import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { WorktreeManager } from "../src/agent-manager/WorktreeManager"
import {
  createWorktreeOnDisk,
  type CreateWorktreeOnDiskContext,
  type WorktreeCreationFailure,
} from "../src/agent-manager/worktree-create"
import type { AgentManagerOutMessage } from "../src/agent-manager/types"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })))
})

describe("createWorktreeOnDisk", () => {
  it("reports no-commit failures to multi-version callers and the webview", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-empty-"))
    tempDirs.push(root)
    const result = Bun.spawnSync(["git", "init", "-b", "main", root], { stdout: "ignore", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"))

    const messages: AgentManagerOutMessage[] = []
    const failures: WorktreeCreationFailure[] = []
    const logs: string[] = []
    const state = { getDefaultBaseBranch: () => undefined }
    const ctx = {
      getWorktreeManager: () => new WorktreeManager(root, () => {}),
      getStateManager: () => state,
      postToWebview: (message: AgentManagerOutMessage) => messages.push(message),
      capture: () => {},
      pushState: () => {},
      log: (message: string) => logs.push(message),
    } as unknown as CreateWorktreeOnDiskContext

    const value = await createWorktreeOnDisk(ctx, {
      baseBranch: "main",
      branchName: "feature",
      onError: (failure) => failures.push(failure),
    })

    expect(value).toBeNull()
    expect(failures).toEqual([
      {
        message: "This repository has no commits yet. Create an initial commit before using worktrees.",
        code: "no_commits",
      },
    ])
    expect(messages.at(-1)).toMatchObject({
      type: "agentManager.worktreeSetup",
      status: "error",
      errorCode: "no_commits",
    })
    expect(logs.some((line) => line.includes("This repository has no commits yet."))).toBe(true)
  })

  it("starts from an explicit base branch over the configured default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-base-"))
    tempDirs.push(root)
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", "-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      })
      if (result.exitCode !== 0) throw new Error(result.stderr.toString("utf8"))
      return result.stdout.toString("utf8").trim()
    }
    git("init", "-b", "main")
    git("commit", "--allow-empty", "-m", "main")
    git("branch", "release/1.0")
    git("checkout", "release/1.0")
    git("commit", "--allow-empty", "-m", "release")
    git("checkout", "main")
    const release = git("rev-parse", "release/1.0")

    const added: Array<{ parentBranch?: string }> = []
    const state = {
      getDefaultBaseBranch: () => "main",
      addWorktree: (wt: { parentBranch?: string }) => (added.push(wt), { id: "wt-1", ...wt }),
    }
    const ctx = {
      getWorktreeManager: () => new WorktreeManager(root, () => {}),
      getStateManager: () => state,
      postToWebview: () => {},
      pushState: () => {},
      log: () => {},
    } as unknown as CreateWorktreeOnDiskContext

    const value = await createWorktreeOnDisk(ctx, { baseBranch: "release/1.0", branchName: "release-fix" })

    expect(value?.result.parentBranch).toBe("release/1.0")
    expect(added[0]?.parentBranch).toBe("release/1.0")
    expect(git("-C", value!.result.path, "rev-parse", "HEAD")).toBe(release)
  }, 60_000)
})
