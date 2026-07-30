import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ScriptTerminalManager } from "../../src/agent-manager/ScriptTerminalManager"
import { createSetupScriptTask, pickSetupTask, runWorktreeSetupScript } from "../../src/agent-manager/setup-script-task"
import { SetupScriptService } from "../../src/agent-manager/SetupScriptService"
import type { RunTask } from "../../src/agent-manager/SetupScriptRunner"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"

interface StartCall {
  kind: string
  config: { worktreeId: string; command: string; args: string[]; cwd: string; env: Record<string, string> }
  done: (exit: { exitCode?: number; stopped?: boolean; error?: string }) => void
}

function wait(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function harness(opts?: {
  trusted?: boolean
  timeoutMs?: number
  gate?: ReturnType<typeof deferred<{ stop(): void }>>
  startError?: Error
}) {
  const starts: StartCall[] = []
  const stops: string[] = []
  const manager = {
    start: (kind: string, config: StartCall["config"], done: StartCall["done"]) => {
      starts.push({ kind, config, done })
      if (opts?.startError) return Promise.reject(opts.startError)
      if (opts?.gate) return opts.gate.promise
      stops.length = 0
      return Promise.resolve({
        stop: () => {
          stops.push(config.worktreeId)
        },
      })
    },
  } as unknown as ScriptTerminalManager
  const logs: string[] = []
  const task = createSetupScriptTask({
    manager,
    worktreeId: "wt-1",
    trusted: () => opts?.trusted ?? true,
    log: (msg) => logs.push(msg),
    timeoutMs: opts?.timeoutMs,
    env: async () => ({ PATH: "/bin" }),
  })
  return { task, starts, stops, logs, manager }
}

const config = {
  command: "sh",
  args: ["/repo/.kilo/setup-script"],
  cwd: "/repo/worktree",
  env: { WORKTREE_PATH: "/repo/worktree", REPO_PATH: "/repo" },
}

describe("createSetupScriptTask", () => {
  it("starts a setup script terminal with the composed environment", async () => {
    const ctx = harness()
    const result = ctx.task(config)
    await wait()

    expect(ctx.starts).toHaveLength(1)
    expect(ctx.starts[0]?.kind).toBe("setup")
    expect(ctx.starts[0]?.config).toEqual({
      worktreeId: "wt-1",
      command: "sh",
      args: ["/repo/.kilo/setup-script"],
      cwd: "/repo/worktree",
      env: { PATH: "/bin", WORKTREE_PATH: "/repo/worktree", REPO_PATH: "/repo" },
    })

    ctx.starts[0]?.done({ exitCode: 0 })
    await expect(result).resolves.toBe(0)
  })

  it("resolves a nonzero exit code so the runner can report it", async () => {
    const ctx = harness()
    const result = ctx.task(config)
    await wait()
    ctx.starts[0]?.done({ exitCode: 42 })

    await expect(result).resolves.toBe(42)
  })

  it("rejects when the terminal reports an execution error", async () => {
    const ctx = harness()
    const result = ctx.task(config)
    await wait()
    ctx.starts[0]?.done({ error: "Setup terminal was removed before it exited" })

    await expect(result).rejects.toThrow("Setup terminal was removed before it exited")
  })

  it("rejects when the terminal is stopped externally", async () => {
    const ctx = harness()
    const result = ctx.task(config)
    await wait()
    ctx.starts[0]?.done({ stopped: true })

    await expect(result).rejects.toThrow("Setup script was stopped")
  })

  it("rejects when the backend refuses to create the terminal", async () => {
    const ctx = harness({ startError: new Error("Not connected to CLI backend") })
    const result = ctx.task(config)

    await expect(result).rejects.toThrow("Not connected to CLI backend")
  })

  it("times out, rejects, and stops the process tree", async () => {
    const ctx = harness({ timeoutMs: 5 })
    const result = ctx.task(config)
    await wait()

    await expect(result).rejects.toThrow("Setup script timed out after 5 minutes")
    expect(ctx.stops).toEqual(["wt-1"])

    // A late exit after the timeout must not settle the promise again.
    ctx.starts[0]?.done({ exitCode: 0 })
  })

  it("times out by killing with the reason so the tab stays reviewable", async () => {
    const kills: string[] = []
    const stops: string[] = []
    const manager = {
      start: async (kind: string, cfg: StartCall["config"], done: StartCall["done"]) => ({
        stop: () => {
          stops.push(cfg.worktreeId)
        },
        kill: (reason: string) => {
          kills.push(reason)
        },
      }),
    } as unknown as ScriptTerminalManager
    const task = createSetupScriptTask({
      manager,
      worktreeId: "wt-1",
      trusted: () => true,
      log: () => undefined,
      timeoutMs: 5,
      env: async () => ({}),
    })
    const result = task(config)

    await expect(result).rejects.toThrow("Setup script timed out after 5 minutes")
    expect(kills).toEqual(["Setup script timed out after 5 minutes"])
    expect(stops).toEqual([])
  })

  it("stops a handle that arrives after the timeout already fired", async () => {
    const gate = deferred<{ stop(): void }>()
    const stops: string[] = []
    const starts: StartCall[] = []
    const manager = {
      start: (kind: string, config: StartCall["config"], done: StartCall["done"]) => {
        starts.push({ kind, config, done })
        return gate.promise
      },
    } as unknown as ScriptTerminalManager
    const task = createSetupScriptTask({
      manager,
      worktreeId: "wt-1",
      trusted: () => true,
      log: () => undefined,
      timeoutMs: 5,
      env: async () => ({}),
    })
    const result = task(config)

    await expect(result).rejects.toThrow("Setup script timed out after 5 minutes")
    gate.resolve({
      stop: () => {
        stops.push("wt-1")
      },
    })
    await wait()
    expect(stops).toEqual(["wt-1"])
  })

  it("keeps the retained terminal when the script exits during creation", async () => {
    const stops: string[] = []
    const manager = {
      start: async (kind: string, config: StartCall["config"], done: StartCall["done"]) => {
        // Fast scripts: the PTY exit is reconciled before start() resolves.
        done({ exitCode: 0 })
        return {
          stop: () => {
            stops.push(config.worktreeId)
          },
        }
      },
    } as unknown as ScriptTerminalManager
    const task = createSetupScriptTask({
      manager,
      worktreeId: "wt-1",
      trusted: () => true,
      log: () => undefined,
      timeoutMs: 60_000,
      env: async () => ({}),
    })

    await expect(task(config)).resolves.toBe(0)
    await wait()
    // The exited PTY must not be stopped: its tab retains the output.
    expect(stops).toEqual([])
  })

  it("recovers a lost exit event through the reconcile watchdog", async () => {
    let syncs = 0
    const starts: StartCall[] = []
    const manager = {
      start: async (kind: string, cfg: StartCall["config"], done: StartCall["done"]) => {
        starts.push({ kind, config: cfg, done })
        return { stop: () => undefined }
      },
      sync: async () => {
        syncs += 1
        // The reconcile discovers the exit the event stream missed.
        if (syncs === 2) starts[0]?.done({ exitCode: 7 })
      },
    } as unknown as ScriptTerminalManager
    const task = createSetupScriptTask({
      manager,
      worktreeId: "wt-1",
      trusted: () => true,
      log: () => undefined,
      timeoutMs: 60_000,
      watchdogMs: 5,
      env: async () => ({}),
    })

    await expect(task(config)).resolves.toBe(7)
    expect(syncs).toBeGreaterThanOrEqual(2)
    // The watchdog stops once the script settles.
    const seen = syncs
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(syncs).toBe(seen)
  })

  it("refuses to run in an untrusted workspace without touching the backend", async () => {
    const ctx = harness({ trusted: false })

    await expect(ctx.task(config)).rejects.toThrow("Trust the workspace before running setup scripts")
    expect(ctx.starts).toEqual([])
  })
})

describe("pickSetupTask", () => {
  function pick(opts: { destination: "vscode" | "agentManager"; worktreeId?: string; trusted?: boolean }) {
    const vscode: RunTask = async () => 0
    const ctx = harness({ trusted: opts.trusted })
    const task = pickSetupTask({
      destination: opts.destination,
      worktreeId: opts.worktreeId,
      trusted: () => opts.trusted ?? true,
      manager: ctx.manager,
      log: () => undefined,
      vscode,
      env: async () => ({}),
    })
    return { task, vscode, ctx }
  }

  it("uses the integrated task runner when the destination is the VS Code terminal", () => {
    const { task, vscode, ctx } = pick({ destination: "vscode", worktreeId: "wt-1" })
    expect(task).toBe(vscode)
    expect(ctx.starts).toEqual([])
  })

  it("uses the integrated task runner without a worktree id", () => {
    const { task, vscode } = pick({ destination: "agentManager" })
    expect(task).toBe(vscode)
  })

  it("does not redirect an untrusted embedded selection to VS Code", async () => {
    const { task, vscode } = pick({ destination: "agentManager", worktreeId: "wt-1", trusted: false })
    expect(task).not.toBe(vscode)
    await expect(task(config)).rejects.toThrow("Trust the workspace before running setup scripts")
  })

  it("uses the embedded script terminal when the Agent Manager panel is selected", async () => {
    const { task, vscode, ctx } = pick({ destination: "agentManager", worktreeId: "wt-1" })
    expect(task).not.toBe(vscode)

    const result = task(config)
    await wait()
    expect(ctx.starts[0]?.kind).toBe("setup")
    ctx.starts[0]?.done({ exitCode: 0 })
    await expect(result).resolves.toBe(0)
  })
})

describe("runWorktreeSetupScript", () => {
  function root(script: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-setup-flow-"))
    if (!script) return dir
    fs.mkdirSync(path.join(dir, ".kilo"), { recursive: true })
    fs.writeFileSync(path.join(dir, ".kilo", "setup-script"), "#!/bin/sh\nexit 0\n")
    return dir
  }

  function flow(
    script: boolean,
    opts?: { destination?: "vscode" | "agentManager"; code?: number; projectId?: string },
  ) {
    const posted: AgentManagerOutMessage[] = []
    const runs: string[] = []
    const ctx = harness()
    const vscode: RunTask = async (cfg) => {
      runs.push(cfg.cwd)
      return opts?.code ?? 0
    }
    const input = {
      service: new SetupScriptService(root(script)),
      destination: opts?.destination ?? ("vscode" as const),
      projectId: opts?.projectId,
      worktreeId: "wt-1",
      trusted: () => true,
      manager: ctx.manager,
      log: () => undefined,
      vscode,
      env: async () => ({}),
      post: (message: AgentManagerOutMessage) => posted.push(message),
    }
    return { input, posted, runs, ctx }
  }

  it("posts progress and executes through the picked runner", async () => {
    const scene = flow(true, { code: 0 })
    await runWorktreeSetupScript(scene.input, { worktreePath: "/repo/worktree", repoPath: "/repo" })

    expect(scene.posted).toEqual([
      {
        type: "agentManager.worktreeSetup",
        status: "creating",
        message: "Running setup script...",
        worktreeId: "wt-1",
      },
    ])
    expect(scene.runs).toEqual(["/repo/worktree"])
  })

  it("stamps progress and embedded terminals with the owning project", async () => {
    const scene = flow(true, { destination: "agentManager", projectId: "prj-a" })
    const result = runWorktreeSetupScript(scene.input, { worktreePath: "/repo/worktree", repoPath: "/repo" })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(scene.posted[0]).toMatchObject({ projectId: "prj-a", worktreeId: "wt-1" })
    expect(scene.ctx.starts[0]?.config).toMatchObject({ projectId: "prj-a", worktreeId: "wt-1" })
    scene.ctx.starts[0]?.done({ exitCode: 0 })
    await result
  })

  it("stays silent when no setup script is configured", async () => {
    const scene = flow(false)
    await runWorktreeSetupScript(scene.input, { worktreePath: "/repo/worktree", repoPath: "/repo" })

    expect(scene.posted).toEqual([])
    expect(scene.runs).toEqual([])
  })

  it("keeps worktree creation best-effort when the script fails", async () => {
    const scene = flow(true, { code: 3 })
    await expect(
      runWorktreeSetupScript(scene.input, { worktreePath: "/repo/worktree", repoPath: "/repo" }),
    ).resolves.toBeUndefined()
    expect(scene.runs).toEqual(["/repo/worktree"])
    expect(scene.posted).toContainEqual({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: "Setup script exited with code 3",
      worktreeId: "wt-1",
    })
  })
})
