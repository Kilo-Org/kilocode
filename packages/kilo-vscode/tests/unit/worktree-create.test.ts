import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"
import {
  createWorktreeOnDisk,
  type CreateWorktreeOnDiskContext,
  type WorktreeCreationFailure,
} from "../../src/agent-manager/worktree-create"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("createWorktreeOnDisk", () => {
  it("reports no-commit failures to multi-version callers and the webview", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-empty-"))
    tempDirs.push(root)
    const result = Bun.spawnSync(["git", "init", "-b", "main", root], { stdout: "ignore", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"))

    const messages: AgentManagerOutMessage[] = []
    const failures: WorktreeCreationFailure[] = []
    const state = { getDefaultBaseBranch: () => undefined }
    const ctx = {
      getWorktreeManager: () => new WorktreeManager(root, () => {}),
      getStateManager: () => state,
      postToWebview: (message: AgentManagerOutMessage) => messages.push(message),
      capture: () => {},
      pushState: () => {},
      log: () => {},
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
  })
})
