import { describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { openSetupScript, runLifecycleSetup, setupHooks } from "../../src/agent-manager/provider-lifecycle"
import { SetupScriptService } from "../../src/agent-manager/SetupScriptService"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"

type Input = Parameters<typeof runLifecycleSetup>[0]
type Hooks = NonNullable<Input["hooks"]>
type Call = Parameters<Hooks["run"]>[0]

async function workspace(script: boolean) {
  const root = await mkdtemp(join(tmpdir(), "am-setup-hooks-"))
  const dir = join(root, "worktree")
  await mkdir(dir)
  const service = new SetupScriptService(root)
  if (script) await service.createDefaultScript()
  return { root, dir, service, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

function harness(input: {
  service?: SetupScriptService
  exit?: number
  /** The user stops the setup script. */
  stop?: boolean
  present?: boolean
  run?: (call: Call) => Promise<{ blocked: boolean; reason?: string }>
}) {
  const flow: string[] = []
  const posted: AgentManagerOutMessage[] = []
  const output: string[] = []
  const calls: Call[] = []
  const hooks: Hooks | undefined =
    input.present === undefined
      ? undefined
      : {
          present: input.present,
          run: async (call) => {
            flow.push("hooks")
            calls.push(call)
            return input.run ? input.run(call) : { blocked: false }
          },
        }
  const value = {
    service: input.service,
    destination: "vscode",
    branch: "feature",
    worktreeId: "wt_1",
    projectId: "project",
    log: () => {},
    post: (message: AgentManagerOutMessage) => posted.push(message),
    vscode: async () => {
      flow.push("script")
      if (input.stop) throw new Error("Setup script was stopped")
      return input.exit ?? 0
    },
    hooks,
  } as Input
  return { flow, posted, output, calls, input: value, early: async () => void flow.push("early") }
}

const errors = (posted: AgentManagerOutMessage[]) =>
  posted.flatMap((message) =>
    message.type === "agentManager.worktreeSetup" && message.status === "error" ? [message.message] : [],
  )
const progress = (posted: AgentManagerOutMessage[]) =>
  posted.flatMap((message) =>
    message.type === "agentManager.worktreeSetup" && message.status === "creating" ? [message.message] : [],
  )

describe("WorktreeSetup hooks in the Agent Manager lifecycle", () => {
  it("runs the hooks after a succeeding setup script, with the worktree, branch and script outcome", async () => {
    await using ws = await workspace(true)
    const run = harness({ service: ws.service, present: true })
    await runLifecycleSetup(
      run.input,
      { repoPath: ws.root, worktreePath: ws.dir },
      (msg) => run.output.push(msg),
      run.early,
    )
    expect(run.flow).toEqual(["script", "hooks"])
    expect(run.calls).toEqual([{ worktree: ws.dir, branch: "feature", script: "succeeded" }])
    expect(errors(run.posted)).toEqual([])
    // The overlay moves on from the script to the hooks.
    expect(progress(run.posted)).toEqual(["Running setup script...", "Running WorktreeSetup hooks..."])
    expect(run.posted.at(-1)).toMatchObject({ projectId: "project", branch: "feature", worktreeId: "wt_1" })
  })

  it("reports a setup script the user stopped as failed to the hooks", async () => {
    await using ws = await workspace(true)
    const run = harness({ service: ws.service, present: true, stop: true })
    await runLifecycleSetup(run.input, { repoPath: ws.root, worktreePath: ws.dir }, () => {})
    expect(run.calls.map((call) => call.script)).toEqual(["failed"])
    // Stopping is the user's own choice, so it is not shown as a setup error.
    expect(errors(run.posted)).toEqual([])
  })

  it("reports a failed setup script to the hooks", async () => {
    await using ws = await workspace(true)
    const run = harness({ service: ws.service, present: true, exit: 3 })
    await runLifecycleSetup(run.input, { repoPath: ws.root, worktreePath: ws.dir }, () => {})
    expect(run.calls.map((call) => call.script)).toEqual(["failed"])
    expect(errors(run.posted)).toEqual(["Setup script exited with code 3"])
  })

  it("reports no setup script to the hooks", async () => {
    await using ws = await workspace(false)
    const run = harness({ service: ws.service, present: true })
    await runLifecycleSetup(run.input, { repoPath: ws.root, worktreePath: ws.dir }, () => {})
    expect(run.flow).toEqual(["hooks"])
    expect(run.calls.map((call) => call.script)).toEqual(["none"])
    expect(progress(run.posted)).toEqual(["Running WorktreeSetup hooks..."])
  })

  it("marks setup failed when a hook blocks", async () => {
    await using ws = await workspace(false)
    const run = harness({
      service: ws.service,
      present: true,
      run: async () => ({ blocked: true, reason: "no free port" }),
    })
    await runLifecycleSetup(run.input, { repoPath: ws.root, worktreePath: ws.dir }, (msg) => run.output.push(msg))
    expect(errors(run.posted)).toEqual(["WorktreeSetup hook failed: no free port"])
    expect(run.output).toContain("[AgentManager] WorktreeSetup hook blocked: no free port")
    expect(run.posted.at(-1)).toMatchObject({ projectId: "project", branch: "feature", worktreeId: "wt_1" })
  })

  it("does not fail setup when the hooks cannot be reached", async () => {
    await using ws = await workspace(false)
    const run = harness({
      service: ws.service,
      present: true,
      run: async () => {
        throw new Error("backend offline")
      },
    })
    await runLifecycleSetup(run.input, { repoPath: ws.root, worktreePath: ws.dir }, (msg) => run.output.push(msg))
    expect(errors(run.posted)).toEqual([])
    expect(run.output).toContain("[AgentManager] WorktreeSetup hooks could not run: backend offline")
  })

  it("starts the session early only when neither a setup script nor hooks have to run first", async () => {
    await using ws = await workspace(false)
    const waiting = harness({ service: ws.service, present: true })
    await runLifecycleSetup(waiting.input, { repoPath: ws.root, worktreePath: ws.dir }, () => {}, waiting.early)
    expect(waiting.flow).toEqual(["hooks"])

    const quiet = harness({ service: ws.service, present: false })
    await runLifecycleSetup(quiet.input, { repoPath: ws.root, worktreePath: ws.dir }, () => {}, quiet.early)
    expect(quiet.flow).toEqual(["early"])

    const plain = harness({ service: ws.service })
    await runLifecycleSetup(plain.input, { repoPath: ws.root, worktreePath: ws.dir }, () => {}, plain.early)
    expect(plain.flow).toEqual(["early"])
    expect(progress([...quiet.posted, ...plain.posted])).toEqual([])
  })
})

describe("setupHooks", () => {
  function client(input: { hooks?: unknown; config?: () => Promise<unknown> }) {
    const dispatched: unknown[] = []
    const value = {
      config: {
        get: async (args: unknown, options: unknown) => {
          dispatched.push({ config: args, options })
          if (input.config) return input.config()
          return { data: { hooks: input.hooks } }
        },
      },
      kilocode: {
        hooksDispatch: async (args: unknown, options: unknown) => {
          dispatched.push({ dispatch: args, options })
          return { data: { blocked: true, reason: "no free port" } }
        },
      },
    } as unknown as KiloClient
    return { value, dispatched }
  }

  it("is present when the effective config has WorktreeSetup hooks, and dispatches with the origin", async () => {
    const api = client({ hooks: { WorktreeSetup: [{ hooks: [{ type: "command", command: "ports.sh" }] }] } })
    const hooks = await setupHooks(() => api.value, "/repo", "tool")
    expect(hooks.present).toBe(true)
    expect(await hooks.run({ worktree: "/repo/.kilo/worktrees/a", script: "none" })).toEqual({
      blocked: true,
      reason: "no free port",
    })
    expect(api.dispatched).toEqual([
      { config: { directory: "/repo" }, options: { throwOnError: true } },
      {
        dispatch: {
          directory: "/repo",
          hooksDispatchPayload: {
            event: "WorktreeSetup",
            worktree: "/repo/.kilo/worktrees/a",
            origin: "tool",
            script: "none",
          },
        },
        options: { throwOnError: true },
      },
    ])
  })

  it("is absent without WorktreeSetup hooks", async () => {
    expect((await setupHooks(() => client({ hooks: { Stop: [] } }).value, "/repo", "create")).present).toBe(false)
    expect((await setupHooks(() => client({}).value, "/repo", "create")).present).toBe(false)
  })

  it("counts an unreadable config or a missing backend as present, so the session waits", async () => {
    const failing = client({ config: async () => Promise.reject(new Error("offline")) })
    expect((await setupHooks(() => failing.value, "/repo", "create")).present).toBe(true)
    const missing = await setupHooks(
      () => {
        throw new Error("not connected")
      },
      "/repo",
      "create",
    )
    expect(missing.present).toBe(true)
    await expect(missing.run({ worktree: "/repo/.kilo/worktrees/a", script: "none" })).rejects.toThrow("not connected")
  })
})

describe("openSetupScript", () => {
  it("creates the default setup script when missing and opens it", async () => {
    await using ws = await workspace(false)
    const opened: string[] = []
    await openSetupScript(
      ws.service,
      async (file) => void opened.push(file),
      () => {},
    )
    expect(ws.service.hasScript()).toBe(true)
    expect(opened).toEqual([ws.service.resolveScript()?.path ?? ""])
  })

  it("logs instead of throwing when the editor cannot open it", async () => {
    await using ws = await workspace(true)
    const logs: string[] = []
    await openSetupScript(
      ws.service,
      async () => {
        throw new Error("no editor")
      },
      (msg) => logs.push(msg),
    )
    expect(logs).toEqual(["Failed to open setup script: no editor"])
  })
})
