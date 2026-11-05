import { afterEach, beforeEach, describe, expect, it } from "bun:test"
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

const { AgentManagerProvider } = await import("../../src/agent-manager/AgentManagerProvider")

const tempDirs: string[] = []
let env: NodeJS.ProcessEnv

// Isolate from the developer's Git config. simple-git strips inherited GIT_* variables, so the
// WorktreeManager path reads global config from HOME/XDG_CONFIG_HOME: both point at a temp dir with
// a clean .gitconfig. GIT_CONFIG_GLOBAL/NOSYSTEM cover the direct `git` calls. Identity variables
// are cleared. Nothing here touches PATH or SHELL, so restoring process.env afterwards is enough.
beforeEach(async () => {
  env = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("GIT_") || key === "EMAIL") delete process.env[key]
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-home-"))
  tempDirs.push(dir)
  const config = path.join(dir, ".gitconfig")
  await fs.writeFile(config, "[commit]\n\tgpgsign = false\n")
  process.env.HOME = dir
  process.env.XDG_CONFIG_HOME = dir
  process.env.GIT_CONFIG_GLOBAL = config
  process.env.GIT_CONFIG_NOSYSTEM = "1"
})

afterEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in env)) delete process.env[key]
  }
  Object.assign(process.env, env)
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function empty(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-empty-"))
  tempDirs.push(root)
  // Bun.spawnSync doesn't pick up process.env changes on its own; pass the isolated env explicitly.
  const result = Bun.spawnSync(["git", "init", "-b", "main", root], {
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env },
  })
  if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"))
  return root
}

function fake(manager: WorktreeManager | undefined) {
  const messages: AgentManagerOutMessage[] = []
  const events: Array<{ event: string; props?: Record<string, unknown> }> = []
  const logs: string[] = []
  const state = { getDefaultBaseBranch: () => undefined }
  const ctx = {
    getWorktreeManager: () => manager,
    getStateManager: () => (manager ? state : undefined),
    postToWebview: (message: AgentManagerOutMessage) => messages.push(message),
    capture: (event: string, props?: Record<string, unknown>) => events.push({ event, props }),
    pushState: () => {},
    log: (message: string) => logs.push(message),
  } as unknown as CreateWorktreeOnDiskContext
  return { ctx, messages, events, logs }
}

describe("createWorktreeOnDisk", () => {
  it("reports no-commit failures to multi-version callers, the webview and telemetry", async () => {
    const root = await empty()
    const io = fake(new WorktreeManager(root, () => {}))
    const failures: WorktreeCreationFailure[] = []

    const value = await createWorktreeOnDisk(io.ctx, {
      entry: "modal",
      baseBranch: "main",
      branchName: "feature",
      name: "secret prompt text",
      onError: (failure) => failures.push(failure),
    })

    const message = "This repository has no commits yet. Create an initial commit before using worktrees."
    expect(value).toBeNull()
    expect(failures).toEqual([{ message, code: "no_commits" }])
    expect(io.messages.at(-1)).toMatchObject({
      type: "agentManager.worktreeSetup",
      status: "error",
      errorCode: "no_commits",
    })
    expect(io.logs.some((line) => line.includes("This repository has no commits yet."))).toBe(true)
    // Exact payload: no branch names, prompt text or paths in telemetry.
    expect(io.events).toEqual([
      {
        event: "Agent Manager Session Error",
        props: {
          source: "agent-manager",
          error: message,
          context: "createWorktree",
          errorCode: "no_commits",
          entry: "modal",
        },
      },
    ])
  })

  it("reports the missing project exit to telemetry with the caller's entry", async () => {
    const io = fake(undefined)

    const value = await createWorktreeOnDisk(io.ctx, { entry: "quick" })

    expect(value).toBeNull()
    expect(io.events).toEqual([
      {
        event: "Agent Manager Session Error",
        props: {
          source: "agent-manager",
          error: "Open a folder that contains a git repository to use worktrees",
          context: "createWorktree",
          errorCode: "not_git_repo",
          entry: "quick",
        },
      },
    ])
  })

  // The binary is passed directly and exits 1, so no ENOENT reaches shell-env's PATH repair.
  it
    .skipIf(process.platform === "win32")
    .each([
      "xcrun: error: invalid active developer path (/Library/Developer/CommandLineTools), missing xcrun at: /Library/Developer/CommandLineTools/usr/bin/xcrun",
      "xcode-select: note: No developer tools were found, requesting install.",
    ])("shows git_not_found when Apple's Git shim prints: %s", async (line) => {
    const root = await empty()
    const bin = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-wt-xcrun-"))
    tempDirs.push(bin)
    const git = path.join(bin, "git")
    await fs.writeFile(git, `#!/bin/sh\necho '${line}' >&2\nexit 1\n`, { mode: 0o755 })
    const io = fake(new WorktreeManager(root, () => {}, undefined, git))

    const value = await createWorktreeOnDisk(io.ctx, { entry: "other", branchName: "feature" })

    expect(value).toBeNull()
    expect(io.messages.at(-1)).toMatchObject({ status: "error", errorCode: "git_not_found" })
    expect(JSON.stringify(io.messages.at(-1))).not.toContain(line)
    expect(io.events.at(-1)?.props).toMatchObject({ errorCode: "git_not_found", entry: "other" })
  })
})

describe("Agent Manager create routing", () => {
  // After the last project is removed, the dialog can still post a create for a project that no
  // longer resolves. The provider drops it before dispatch, so the drop itself must be reported.
  it.each([
    { type: "agentManager.createMultiVersion", entry: "modal" },
    { type: "agentManager.createWorktree", entry: "quick" },
  ])("reports a $type for an unknown project as project_unavailable and dispatches nothing", async (input) => {
    const events: Array<{ event: string; props?: Record<string, unknown> }> = []
    const dispatched: unknown[] = []
    const provider = Object.assign(Object.create(AgentManagerProvider.prototype), {
      prBridge: { handleMessage: () => false },
      projects: {},
      contexts: { active: () => undefined, resolve: () => undefined },
      projectScope: { run: (ctx: unknown) => dispatched.push(ctx) },
      host: { capture: (event: string, props?: Record<string, unknown>) => events.push({ event, props }) },
      log: () => undefined,
    })

    const value = await provider.onMessage({ type: input.type, projectId: "removed", versions: 1 })

    expect(value).toBeNull()
    expect(dispatched).toEqual([])
    expect(events).toEqual([
      {
        event: "Agent Manager Session Error",
        props: {
          source: "agent-manager",
          error: "Open a folder that contains a git repository to use worktrees",
          context: "createWorktree",
          errorCode: "project_unavailable",
          entry: input.entry,
        },
      },
    ])
  })
})
