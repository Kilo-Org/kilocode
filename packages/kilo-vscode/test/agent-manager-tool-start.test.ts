import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { SessionID } from "@opencode/schema/session-id"
import { parseToolRequest, startFromTool, type ToolDeps, type ToolRequest } from "../src/agent-manager/tool-start"
import type { CreateWorktreeResult } from "../src/agent-manager/WorktreeManager"
import { handleToolEvent } from "../src/agent-manager/tool-project"
import { createSessionInWorktree } from "../src/agent-manager/provider-session"
import { AgentManagerProvider } from "../src/agent-manager/AgentManagerProvider"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { Host, PanelContext } from "../src/agent-manager/host"

const window = vscode.window as unknown as Record<string, unknown>
window.createTerminal ??= () => ({ show: () => undefined, dispose: () => undefined, exitStatus: undefined })
window.createOutputChannel ??= () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined })

const platform = Object.getOwnPropertyDescriptor(process, "platform")

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform)
})

function session(id: string): SessionInfo {
  return {
    id: SessionID.make(id),
    projectID: "prj-test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title: id,
    location: { directory: "/repo" },
  }
}

function result(path: string): CreateWorktreeResult {
  return { path, branch: "kilo/test", parentBranch: "main", startPointSource: "fallback" } as CreateWorktreeResult
}

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  const calls: unknown[] = []
  const panel = {
    waitForReady: mock(async () => calls.push("waitForReady")),
  }
  return {
    getClient: () =>
      ({
        session: {
          create: mock(async () => session("ses-local")),
          prompt: mock(async () => undefined),
        },
      }) as unknown as OpenCodeClient,
    getRoot: () => "/repo",
    getState: () => ({ addSession: mock(() => calls.push("addSession")) }) as never,
    getPanel: () => panel as never,
    openPanel: mock(() => {
      calls.push("openPanel")
    }),
    waitReady: mock(async () => {
      calls.push("waitReady")
    }),
    createWorktree: mock(async () => ({
      worktree: { id: "wt-1" } as never,
      result: result("/repo/.kilo/worktrees/wt-1"),
    })),
    cleanupWorktree: mock(async () => {
      calls.push("cleanupWorktree")
    }),
    hasScript: () => true,
    setup: mock(async () => {
      calls.push("setup")
    }),
    createSessionInWorktree: mock(async () => session("ses-wt")),
    sessionMetadata: mock(async () => ({ kilocode: { platform: "agent-manager" } })),
    registerWorktreeSession: mock(() => {
      calls.push("registerWorktreeSession")
    }),
    notifyReady: mock(() => {
      calls.push("notifyReady")
    }),
    push: mock(() => {
      calls.push("push")
    }),
    post: mock((msg: unknown) => calls.push(msg)),
    log: mock(() => {}),
    error: mock(() => {}),
    ...overrides,
  }
}

describe("agent manager tool start", () => {
  it.each([false, true])("gates the worktree prompt on setup script presence (%s)", async (script) => {
    const flow: string[] = []
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const prompted = Promise.withResolvers<void>()
    const client = {
      session: {
        prompt: async () => {
          flow.push("prompt")
          prompted.resolve()
        },
      },
    }
    const host = deps({
      getClient: () => client as never,
      hasScript: () => script,
      sessionMetadata: async () => {
        flow.push("boot")
        return {}
      },
      setup: async (_dir, _branch, _id, early) => {
        flow.push("env")
        await early?.()
        entered.resolve()
        await gate.promise
        flow.push("setup:end")
      },
      createSessionInWorktree: async () => {
        flow.push("create")
        return session("ses-wt")
      },
    })
    const pending = startFromTool(host, {
      requestID: "gate",
      mode: "worktree",
      tasks: [{ prompt: "Fix it" }],
    })
    await entered.promise
    if (!script) await prompted.promise
    expect(flow.includes("prompt")).toBe(!script)
    gate.resolve()
    await pending
    expect(flow).toEqual(
      script ? ["env", "setup:end", "boot", "create", "prompt"] : ["env", "boot", "create", "prompt", "setup:end"],
    )
  })

  for (const mode of ["local", "worktree"] as const) {
    for (const source of [undefined, "ses_source"]) {
      it(`attributes initial ${mode} prompts only with a source (${source ?? "ordinary"})`, async () => {
        const client = deps().getClient()
        const c = deps({ getClient: () => client })
        const req = parseToolRequest({
          requestID: `am-${mode}-${source}`,
          sessionID: source,
          mode,
          versions: true,
          tasks: [{ prompt: " First " }, { prompt: "Second" }, { name: "Prepared" }],
        })!
        await startFromTool(c, req)
        expect(client.session.prompt).toHaveBeenCalledTimes(2)
        for (const text of ["First", "Second"]) {
          expect(client.session.prompt).toHaveBeenCalledWith({
            sessionID: mode === "local" ? "ses-local" : "ses-wt",
            text: source ? `${text}\n\n<!-- kilo-agent-manager source=${source} -->` : text,
          })
        }
      })
    }
  }

  for (const mode of ["local", "worktree"] as const) {
    it(`preserves caller attribution through project routing for ${mode}`, async () => {
      const client = deps().getClient()
      const c = deps({ getClient: () => client })
      const done = Promise.withResolvers<void>()
      const owner = { id: "project" }
      handleToolEvent(
        {
          data: {
            requestID: `am-routed-${mode}`,
            sessionID: "ses_caller",
            mode,
            tasks: [{ prompt: "Initial delivery" }],
          },
        },
        "/repo",
        { byDirectory: () => owner },
        {
          run: async (project, fn) => {
            expect(project).toBe(owner)
            return fn()
          },
        },
        async (req) => {
          try {
            await startFromTool(c, req)
            done.resolve()
          } catch (err) {
            done.reject(err)
          }
        },
      )
      await done.promise
      expect(client.session.prompt).toHaveBeenCalledWith({
        sessionID: mode === "local" ? "ses-local" : "ses-wt",
        text: "Initial delivery\n\n<!-- kilo-agent-manager source=ses_caller -->",
      })
    })
  }

  it("parses explicit targets without changing null or omitted behavior", () => {
    const input = { mode: "local", tasks: [{ prompt: "Fix" }] }
    expect(parseToolRequest(input)?.worktreeID).toBeUndefined()
    expect(parseToolRequest({ ...input, worktreeID: null })?.worktreeID).toBeUndefined()
    expect(parseToolRequest({ ...input, worktreeID: "wt-target" })?.worktreeID).toBe("wt-target")
    for (const fields of [
      { worktreeID: "" },
      { worktreeID: " " },
      { worktreeID: 42 },
      { worktreeID: "wt-target", mode: "worktree" },
      { worktreeID: "wt-target", versions: true },
      { worktreeID: "wt-target", tasks: [{ prompt: "Fix", branchName: "" }] },
      { worktreeID: "wt-target", tasks: [{ prompt: "Fix", baseBranch: "main" }] },
    ])
      expect(parseToolRequest({ ...input, ...fields })).toBeUndefined()
  })

  it("keeps a worktree base branch from the start event", () => {
    expect(parseToolRequest({ mode: "worktree", tasks: [{ name: "Base", baseBranch: " main " }] })?.tasks).toEqual([
      { name: "Base", baseBranch: " main " },
    ])
    expect(parseToolRequest({ mode: "worktree", tasks: [{ name: "Base", baseBranch: "  " }] })?.tasks).toEqual([
      { name: "Base" },
    ])
  })

  it("creates the worktree from the requested base branch", async () => {
    const client = {
      session: {
        create: mock(async () => session("ses-local")),
        prompt: mock(async () => undefined),
      },
    }
    const c = deps({ getClient: () => client as never })
    await startFromTool(c, {
      requestID: "am-base",
      mode: "worktree",
      tasks: [{ name: "Release fix", baseBranch: " release/1.0 " }],
    })
    expect(c.createWorktree).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: "release/1.0" }))

    const omitted = deps({ getClient: () => client as never })
    await startFromTool(omitted, { requestID: "am-default", mode: "worktree", tasks: [{ name: "Default" }] })
    expect(omitted.createWorktree).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: undefined }))
  })

  it("targets a non-caller worktree without creating or cleaning it", async () => {
    const wt = { id: "wt-target", path: "/repo/target" }
    const ready = { value: false }
    const state = {
      findWorktreeByPath: (dir: string) => (dir === "/repo/caller" ? { id: "wt-caller", path: dir } : undefined),
      getWorktree: mock((id: string) => {
        expect(ready.value).toBe(true)
        return id === wt.id ? wt : undefined
      }),
      addSession: mock(() => {}),
    }
    const client = {
      session: {
        create: mock(async () => session("ses-target")),
        prompt: mock(async () => undefined),
      },
    }
    const c = deps({
      getClient: () => client as never,
      getState: () => state as never,
      waitReady: mock(async () => {
        ready.value = true
      }),
    })
    await startFromTool(c, {
      requestID: "am-target",
      mode: "local",
      directory: "/repo/caller",
      worktreeID: wt.id,
      tasks: [{ prompt: "Fix", model: { providerID: "test", modelID: "model" }, variant: "high" }],
    })
    expect(c.sessionMetadata).toHaveBeenCalledWith(client, wt.path)
    expect(client.session.create).toHaveBeenCalledWith({
      location: { directory: wt.path },
      metadata: { kilocode: { platform: "agent-manager" } },
      model: { id: "model", providerID: "test", variant: "high" },
    })
    expect(state.addSession).toHaveBeenCalledWith("ses-target", wt.id)
    expect(c.registerWorktreeSession).toHaveBeenCalledWith("ses-target", wt.path)
    expect(c.post).toHaveBeenCalledWith({
      type: "agentManager.sessionAdded",
      sessionId: "ses-target",
      worktreeId: wt.id,
    })
    expect(client.session.prompt).toHaveBeenCalledWith({ sessionID: "ses-target", text: "Fix" })
    expect(c.createWorktree).not.toHaveBeenCalled()
    expect(c.setup).not.toHaveBeenCalled()
    expect(c.cleanupWorktree).not.toHaveBeenCalled()
    expect(c.error).not.toHaveBeenCalled()
  })

  it("rejects unknown or foreign IDs without falling back to the caller", async () => {
    const create = mock(async () => session("ses-local"))
    const c = deps({
      getClient: () => ({ session: { create } }) as never,
      getState: () => ({ getWorktree: () => undefined }) as never,
    })
    await startFromTool(c, {
      requestID: "am-unknown",
      mode: "local",
      directory: "/repo",
      worktreeID: "wt-foreign",
      tasks: [{ name: "Prepared" }],
    })
    expect(create).not.toHaveBeenCalled()
    expect(c.createWorktree).not.toHaveBeenCalled()
    expect(c.cleanupWorktree).not.toHaveBeenCalled()
    expect(c.post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: expect.stringContaining("wt-foreign") }),
    )
  })

  it("parses tool start events defensively", () => {
    const parsed = parseToolRequest({
      mode: "local",
      tasks: [
        {
          prompt: "one",
          model: { providerID: " test ", modelID: " reasoning/model " },
          variant: " high ",
        },
      ],
    })
    expect(parsed?.requestID.startsWith("am-")).toBe(true)
    expect(parsed?.sessionID).toBeUndefined()
    expect(parsed?.directory).toBeUndefined()
    expect(parsed?.mode).toBe("local")
    expect(parsed?.versions).toBeUndefined()
    expect(parsed?.tasks).toEqual([
      {
        prompt: "one",
        model: { providerID: "test", modelID: "reasoning/model" },
        variant: "high",
      },
    ])
    expect(
      parseToolRequest({
        mode: "local",
        tasks: [{ prompt: "one", model: { providerID: "", modelID: "model" }, variant: "high" }],
      }),
    ).toBeUndefined()
    expect(parseToolRequest({ mode: "local", tasks: [{ prompt: "one", variant: "high" }] })).toBeUndefined()
    expect(
      parseToolRequest({
        mode: "local",
        tasks: [{ name: "Prepared session", model: { providerID: "test", modelID: "model" } }],
      }),
    ).toBeUndefined()
    expect(parseToolRequest({ mode: "bad", tasks: [{ prompt: "one" }] })).toBeUndefined()
    expect(parseToolRequest({ mode: "local", tasks: [] })).toBeUndefined()
    expect(parseToolRequest({ mode: "local", tasks: [{}] })).toBeUndefined()
  })

  it("starts local sessions and sends the initial prompt", async () => {
    const client = {
      session: {
        create: mock(async () => session("ses-local")),
        prompt: mock(async () => undefined),
      },
    }
    const c = deps({ getClient: () => client as never })
    const req: ToolRequest = {
      requestID: "am-1",
      mode: "local",
      tasks: [
        {
          prompt: "Do work",
          model: { providerID: "test", modelID: "reasoning/model" },
          variant: "high",
        },
      ],
    }

    await startFromTool(c, req)

    expect(c.openPanel).toHaveBeenCalledWith(true)
    const panel = c.getPanel()
    expect(panel?.waitForReady).toHaveBeenCalled()
    expect(client.session.create).toHaveBeenCalledWith({
      location: { directory: "/repo" },
      metadata: { kilocode: { platform: "agent-manager" } },
      model: { id: "reasoning/model", providerID: "test", variant: "high" },
    })
    expect(client.session.prompt).toHaveBeenCalledWith({ sessionID: "ses-local", text: "Do work" })
  })

  it("starts local sessions when Windows drive-letter casing differs", async () => {
    setPlatform("win32")
    const client = {
      session: {
        create: mock(async () => session("ses-local")),
        prompt: mock(async () => undefined),
      },
    }
    const state = {
      addSession: mock(() => {}),
      findWorktreeByPath: mock(() => undefined),
    }
    const c = deps({
      getClient: () => client as never,
      getRoot: () => "c:\\Users\\dev\\repo",
      getState: () => state as never,
    })

    await startFromTool(c, {
      requestID: "am-windows-dir",
      mode: "local",
      directory: "C:\\Users\\dev\\repo",
      tasks: [{ prompt: "Do work" }],
    })

    expect(client.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ location: { directory: "c:\\Users\\dev\\repo" } }),
    )
    expect(client.session.prompt).toHaveBeenCalledWith({
      sessionID: "ses-local",
      text: "Do work",
    })
    expect(state.addSession).toHaveBeenCalledWith("ses-local", null)
    expect(state.findWorktreeByPath).not.toHaveBeenCalled()
    expect(c.error).not.toHaveBeenCalled()
  })

  it("starts worktree sessions through existing hooks", async () => {
    const client = {
      session: {
        create: mock(async () => session("ses-local")),
        prompt: mock(async () => undefined),
      },
    }
    const c = deps({ getClient: () => client as never })
    await startFromTool(c, {
      requestID: "am-2",
      sessionID: "ses-parent",
      mode: "worktree",
      tasks: [
        {
          prompt: "Fix",
          branchName: "fix/One_two.3",
          model: { providerID: "test", modelID: "reasoning/model" },
          variant: "low",
        },
      ],
    })

    expect(c.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ branchName: "fix/One_two.3", name: "fix/One_two.3", label: "one two 3" }),
    )
    expect(c.setup).toHaveBeenCalled()
    expect(c.createSessionInWorktree).toHaveBeenCalledWith(
      "/repo/.kilo/worktrees/wt-1",
      "kilo/test",
      "wt-1",
      { sessionID: "ses-parent" },
      expect.any(Object),
      expect.any(Object),
      { providerID: "test", modelID: "reasoning/model", variant: "low" },
      undefined,
    )
    expect(c.registerWorktreeSession).toHaveBeenCalledWith("ses-wt", "/repo/.kilo/worktrees/wt-1")
    expect(c.notifyReady).toHaveBeenCalled()
    expect(client.session.prompt).toHaveBeenCalledWith({
      sessionID: "ses-wt",
      text: "Fix\n\n<!-- kilo-agent-manager source=ses-parent -->",
    })
  })

  it("deduplicates repeated delivery of the same exact request", async () => {
    const requests = new Set<string>()
    const c = deps({
      claimRequest: mock((id: string) => {
        if (requests.has(id)) return false
        requests.add(id)
        return true
      }),
    })
    const req: ToolRequest = {
      requestID: "am-duplicate",
      mode: "worktree",
      tasks: [
        {
          branchName: "echo-hello-world",
          name: "Echo hello world",
          prompt: 'Use the bash tool to run: echo "hello world". Report back the output.',
        },
      ],
    }

    await startFromTool(c, req)
    await startFromTool(c, req)

    expect(c.createWorktree).toHaveBeenCalledTimes(1)
    expect(c.createSessionInWorktree).toHaveBeenCalledTimes(1)
  })

  it("tags tool-triggered multi-version progress with the owning project", async () => {
    const posts: Array<{ type: string; projectId?: string; status?: string }> = []
    const c = deps({
      getProjectId: () => "prj-owner",
      post: mock((message: unknown) => posts.push(message as never)),
    })

    await startFromTool(c, {
      requestID: "am-progress",
      mode: "worktree",
      versions: true,
      tasks: [{ prompt: "first" }, { prompt: "second" }],
    })

    const progress = posts.filter((message) => message.type === "agentManager.multiVersionProgress")
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((message) => message.projectId === "prj-owner")).toBe(true)
  })

  it("starts each task from separate tool calls even when their branch seeds match", async () => {
    const requests = new Set<string>()
    const c = deps({
      claimRequest: mock((id: string) => {
        if (requests.has(id)) return false
        requests.add(id)
        return true
      }),
    })
    const req: ToolRequest = {
      requestID: "am-first",
      mode: "worktree",
      tasks: [
        {
          branchName: "echo-hello-world",
          name: "Echo hello world",
          prompt: 'Use the bash tool to run: echo "hello world". Report back the output.',
        },
      ],
    }

    await startFromTool(c, req)
    await startFromTool(c, { ...req, requestID: "am-second" })

    expect(c.createWorktree).toHaveBeenCalledTimes(2)
    expect(c.createSessionInWorktree).toHaveBeenCalledTimes(2)
    expect(c.createWorktree).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ branchName: "echo-hello-world", name: "echo-hello-world" }),
    )
  })

  it("deduplicates concurrent delivery of the same request", async () => {
    const requests = new Set<string>()
    const pending = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const c = deps({
      claimRequest: mock((id: string) => {
        if (requests.has(id)) return false
        requests.add(id)
        return true
      }),
      createWorktree: mock(async () => {
        pending.resolve()
        await resume.promise
        return { worktree: { id: "wt-1" } as never, result: result("/repo/.kilo/worktrees/wt-1") }
      }),
    })
    const req: ToolRequest = {
      requestID: "am-concurrent",
      mode: "worktree",
      tasks: [{ prompt: "Fix", branchName: "fix/concurrent" }],
    }

    const first = startFromTool(c, req)
    await pending.promise
    await startFromTool(c, req)
    resume.resolve()
    await first

    expect(c.createWorktree).toHaveBeenCalledTimes(1)
  })

  it("only applies version suffixes when versions is true", async () => {
    const normal = deps()
    await startFromTool(normal, {
      requestID: "am-normal",
      mode: "worktree",
      tasks: [
        { prompt: "Fix one", branchName: "fix/one" },
        { prompt: "Fix two", branchName: "fix/two" },
      ],
    })
    expect(normal.createWorktree).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ branchName: "fix/two", label: "two" }),
    )

    const grouped = deps()
    await startFromTool(grouped, {
      requestID: "am-versions",
      mode: "worktree",
      versions: true,
      tasks: [
        { prompt: "Try one", branchName: "try/work" },
        { prompt: "Try two", branchName: "try/work" },
      ],
    })
    expect(grouped.createWorktree).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ branchName: "try/work_v2", label: "try work v2" }),
    )
  })

  it("passes invalid explicit names to worktree validation and keeps card labels short", async () => {
    const c = deps()
    await startFromTool(c, {
      requestID: "am-name",
      mode: "worktree",
      tasks: [
        {
          prompt: "Fix command permissions persistence regression",
          name: "Fix command permissions persistence regression that is too long",
          branchName: "fix command permissions @#$ persistence",
        },
      ],
    })

    expect(c.createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        branchName: "fix command permissions @#$ persistence",
        label: "command permissions",
      }),
    )
  })

  it("still sanitizes display names used as automatic branch seeds", async () => {
    const c = deps()
    await startFromTool(c, {
      requestID: "am-seed",
      mode: "worktree",
      tasks: [{ name: "My Feature" }],
    })
    expect(c.createWorktree).toHaveBeenCalledWith(expect.objectContaining({ branchName: "my-feature" }))
  })

  it("parses the agent field and drops it when blank or non-string", () => {
    expect(parseToolRequest({ mode: "local", tasks: [{ prompt: "Fix", agent: "candidate" }] })?.tasks).toEqual([
      { prompt: "Fix", agent: "candidate" },
    ])
    expect(parseToolRequest({ mode: "local", tasks: [{ prompt: "Fix", agent: "  " }] })?.tasks).toEqual([
      { prompt: "Fix" },
    ])
    expect(parseToolRequest({ mode: "local", tasks: [{ prompt: "Fix", agent: "  candidate  " }] })?.tasks).toEqual([
      { prompt: "Fix", agent: "candidate" },
    ])
    expect(parseToolRequest({ mode: "local", tasks: [{ prompt: "Fix", agent: 42 }] })?.tasks).toEqual([
      { prompt: "Fix" },
    ])
    expect(parseToolRequest({ mode: "local", tasks: [{ name: "Prepared", agent: "candidate" }] })?.tasks).toEqual([
      { name: "Prepared", agent: "candidate" },
    ])
  })

  it("forwards the task agent to session.create for local sessions", async () => {
    const client = {
      session: {
        create: mock(async () => session("ses-local")),
        prompt: mock(async () => undefined),
      },
    }
    const c = deps({ getClient: () => client as never })

    await startFromTool(c, {
      requestID: "am-local-agent",
      mode: "local",
      tasks: [{ name: "Prepared", agent: "candidate" }],
    })

    expect(client.session.create).toHaveBeenCalledWith(expect.objectContaining({ agent: "candidate" }))
  })

  it("omits agent from session.create for local sessions when not specified", async () => {
    const client = {
      session: {
        create: mock(async () => session("ses-local")),
        prompt: mock(async () => undefined),
      },
    }
    const c = deps({ getClient: () => client as never })

    await startFromTool(c, { requestID: "am-local-no-agent", mode: "local", tasks: [{ name: "Prepared" }] })

    expect(client.session.create).toHaveBeenCalledWith(expect.not.objectContaining({ agent: expect.anything() }))
  })

  it("forwards the task agent to createSessionInWorktree for worktree sessions", async () => {
    const c = deps()
    await startFromTool(c, {
      requestID: "am-worktree-agent",
      mode: "worktree",
      tasks: [{ prompt: "Fix", branchName: "fix/one", agent: "candidate" }],
    })

    expect(c.createSessionInWorktree).toHaveBeenCalledWith(
      "/repo/.kilo/worktrees/wt-1",
      "kilo/test",
      "wt-1",
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      undefined,
      "candidate",
    )
  })

  it("rejects local sessions for unknown worktree directories", async () => {
    const client = {
      session: {
        create: mock(async () => session("ses-local")),
        prompt: mock(async () => undefined),
      },
    }
    const c = deps({
      getClient: () => client as never,
      getState: () => ({ addSession: mock(), findWorktreeByPath: mock(() => undefined) }) as never,
    })

    await startFromTool(c, {
      requestID: "am-dir",
      mode: "local",
      directory: "/repo/other",
      tasks: [{ prompt: "Do work" }],
    })

    expect(client.session.create).not.toHaveBeenCalled()
    expect(c.error).toHaveBeenCalled()
  })
})

describe("agent manager worktree session creation", () => {
  it("applies the resolved model, variant, and agent to session.create", async () => {
    const create = mock(async () => session("ses-wt"))
    const client = {
      mcp: { list: mock(async () => []) },
      session: { create },
    } as unknown as OpenCodeClient
    const posts: unknown[] = []

    const created = await createSessionInWorktree(
      {
        connection: { client: async () => client } as never,
        postToWebview: (message) => posts.push(message),
        log: () => {},
      },
      "/repo/.kilo/worktrees/wt-1",
      "kilo/test",
      "wt-1",
      undefined,
      { providerID: "test", modelID: "reasoning/model", variant: "high" },
      "candidate",
    )

    expect(created?.id).toBe("ses-wt")
    expect(create).toHaveBeenCalledWith({
      location: { directory: "/repo/.kilo/worktrees/wt-1" },
      metadata: { kilocode: { platform: "agent-manager" } },
      agent: "candidate",
      model: { id: "reasoning/model", providerID: "test", variant: "high" },
    })
    expect(posts).toContainEqual(expect.objectContaining({ type: "agentManager.worktreeSetup", status: "starting" }))
  })
})

function fakePanel(): PanelContext {
  return {
    active: true,
    visible: true,
    postMessage: () => undefined,
    waitForReady: async () => undefined,
    waitForActive: async () => undefined,
    reveal: () => undefined,
    onDidChangeVisibility: () => ({ dispose: () => undefined }),
    onDidDispose: () => ({ dispose: () => undefined }),
    dispose: () => undefined,
  }
}

describe("agent manager provider tool routing", () => {
  it("passes the tool model, variant, and agent through startToolRequest to session.create", async () => {
    const create = mock(async () => session("ses-wt"))
    const client = {
      config: { get: mock(async () => ({})) },
      agent: { list: mock(async () => []) },
      mcp: { list: mock(async () => []) },
      session: { create, prompt: mock(async () => undefined) },
    } as unknown as OpenCodeClient
    const connection = {
      client: async () => client,
      current: () => client,
      state: () => "connected",
      onState: () => () => undefined,
      onEvent: () => () => undefined,
      server: () => undefined,
      view: () => undefined,
      started: () => undefined,
      stopped: () => undefined,
      dispose: () => undefined,
    } as unknown as AgentManagerConnection
    const output = { appendLine: () => undefined, show: () => undefined, dispose: () => undefined }
    const hostBase = {
      createOutput: () => output,
      readProjects: () => undefined,
      writeProjects: async () => undefined,
      autoBranchNaming: () => ({ enabled: false, prefix: "" }),
      extensionKeybindings: () => [],
      onDidChangeKeybindings: () => ({ dispose: () => undefined }),
      dirtyFiles: () => [],
      isTrusted: () => true,
      openDocument: async () => undefined,
      showError: () => undefined,
      notify: () => undefined,
      openFile: () => undefined,
      refreshGit: () => undefined,
      dispose: () => undefined,
      workspacePath: () => undefined,
      onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
    }
    const host = new Proxy(hostBase, {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target]
        return () => ({ dispose: () => undefined })
      },
    }) as unknown as Host
    const panel = fakePanel()
    const provider = new AgentManagerProvider(host, connection, {
      open: () => panel,
      restore: () => panel,
    } as never)

    provider.getRoot = () => "/repo"
    provider.getStateManager = () => ({ addSession: mock(() => {}) }) as never
    provider.createWorktreeOnDisk = async () => ({
      worktree: { id: "wt-1" } as never,
      result: result("/repo/.kilo/worktrees/wt-1"),
    })
    provider.runSetupScriptForWorktree = async () => undefined
    provider.getSetupScriptService = () => undefined
    provider.pushState = () => undefined
    provider.postToWebview = () => undefined
    provider.registerWorktreeSession = () => undefined
    provider.notifyWorktreeReady = () => undefined

    try {
      await provider.startToolRequest({
        requestID: "am-provider",
        mode: "worktree",
        tasks: [
          {
            prompt: "Fix",
            branchName: "fix/one",
            model: { providerID: "test", modelID: "reasoning/model" },
            variant: "high",
            agent: "candidate",
          },
        ],
      })
    } finally {
      await provider.dispose()
    }

    expect(create).toHaveBeenCalledWith({
      location: { directory: "/repo/.kilo/worktrees/wt-1" },
      metadata: { kilocode: { platform: "agent-manager" } },
      agent: "candidate",
      model: { id: "reasoning/model", providerID: "test", variant: "high" },
    })
  })
})
