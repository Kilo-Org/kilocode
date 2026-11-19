import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client"
import { SessionID } from "@opencode/schema/session-id"
import { AgentManagerOrchestrationBridge } from "../src/agent-manager/orchestration-bridge"
import { createOrchestrationBridge } from "../src/agent-manager/orchestration-setup"
import type { AgentManagerConnection, ConnectionState } from "../src/agent-manager/connection"
import { ProjectContexts } from "../src/agent-manager/project/contexts"
import { ProjectScope } from "../src/agent-manager/project/scope"
import { WorktreeStateManager, type ManagedSession } from "../src/agent-manager/WorktreeStateManager"
import type { LocalStats, WorktreeStats } from "../src/agent-manager/GitStatsPoller"
import type { PRStatus } from "../src/agent-manager/types"

async function waitFor(check: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !check(); index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

function info(id: string, directory: string, title?: string): SessionInfo {
  return {
    id: SessionID.make(id),
    projectID: "prj-test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title,
    location: { directory },
  }
}

function empty(directory: string) {
  return { location: { directory }, data: [] }
}

type Overrides = Partial<{
  root: (directory?: string) => string | undefined
  ready: (directory?: string) => Promise<WorktreeStateManager | undefined>
  state: (directory?: string) => WorktreeStateManager | undefined
  stats: (directory?: string) => Promise<{ worktrees: WorktreeStats[]; local?: LocalStats }>
  prs: (directory?: string) => Map<string, PRStatus>
  push: (directory?: string) => void
  resolve: (sessionID: string, directory?: string) => ManagedSession | undefined
  managed: (sessionID: string, directory?: string) => boolean
  close: (sessionID: string, directory?: string) => Promise<void>
}>

describe("AgentManagerOrchestrationBridge", () => {
  let root: string
  let dir: string
  let state: WorktreeStateManager

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-orchestration-bridge-"))
    dir = path.join(root, "worktree")
    fs.mkdirSync(path.join(root, ".kilo"), { recursive: true })
    fs.mkdirSync(dir)
    state = new WorktreeStateManager(root, () => undefined)
    const worktree = state.addWorktree({ branch: "fix/bridge", path: dir, parentBranch: "main" })
    state.addSession("ses_target", worktree.id)
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  function harness(overrides?: Overrides) {
    const replies: unknown[] = []
    const rejections: unknown[] = []
    const lists = new Map<string, unknown[]>()
    const statsCalls: number[] = []
    const handlers: {
      event?: (event: OpenCodeEvent) => void
      state?: (state: ConnectionState) => void
    } = {}
    const status = { failList: "", failReply: false, failClient: false }
    const managed = new Set(["ses_caller", "ses_target"])
    const delivered = mock(async (_input: { metadata?: unknown }) => undefined)
    const locations = new Map([
      ["ses_target", dir],
      ["ses_caller", root],
    ])
    const close = mock(async (_sessionID: string, _directory?: string) => undefined)
    const push = mock(() => undefined)
    const formReply = mock(async () => undefined)
    const rpc = {
      list: mock(async (_input: unknown, options: { location: { directory: string } }) => {
        if (options.location.directory === status.failList) throw new Error("offline")
        return lists.get(options.location.directory) ?? []
      }),
      reply: mock(async (input: unknown, options: { location: { directory: string } }) => {
        replies.push({ ...(input as Record<string, unknown>), directory: options.location.directory })
        if (status.failReply) throw new Error("offline")
      }),
      reject: mock(async (input: unknown, options: { location: { directory: string } }) => {
        rejections.push({ ...(input as Record<string, unknown>), directory: options.location.directory })
      }),
    }
    const client = {
      session: {
        get: mock(async ({ sessionID }: { sessionID: string }) =>
          info(sessionID, locations.get(sessionID) ?? dir, "Target"),
        ),
        active: mock(async () => ({})),
        context: mock(async (): Promise<Array<{ type: string; metadata?: unknown }>> => []),
        prompt: delivered,
        form: { reply: formReply },
      },
      permission: {
        request: {
          list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)),
        },
      },
      form: {
        list: mock(async ({ location }: { location: { directory: string } }) => empty(location.directory)),
      },
      rpc: mock(() => rpc),
    }
    const connection = {
      onEvent: (listener: typeof handlers.event) => {
        handlers.event = listener
        return () => {
          handlers.event = undefined
        }
      },
      onState: (listener: typeof handlers.state) => {
        handlers.state = listener
        return () => {
          handlers.state = undefined
        }
      },
      current: () => (status.failClient ? undefined : client),
      client: async () => {
        status.failClient = false
        return client
      },
    } as unknown as AgentManagerConnection
    const bridge = new AgentManagerOrchestrationBridge(connection, {
      root: (origin) => (overrides?.root ? overrides.root(origin) : root),
      ready: async (origin) => (overrides?.ready ? overrides.ready(origin) : state),
      state: (origin) => (overrides?.state ? overrides.state(origin) : state),
      stats: async (origin) => {
        statsCalls.push(1)
        return overrides?.stats ? overrides.stats(origin) : { worktrees: [] }
      },
      prs: (origin) => (overrides?.prs ? overrides.prs(origin) : new Map()),
      push: (origin) => (overrides?.push ? overrides.push(origin) : push()),
      resolve: (id, origin) => overrides?.resolve?.(id, origin),
      managed: (id, origin) => (overrides?.managed ? overrides.managed(id, origin) : managed.has(id)),
      close: async (id, origin) => (overrides?.close ? overrides.close(id, origin) : close(id, origin)),
      log: () => undefined,
    })
    let sequence = 0
    const request = (value: unknown, directory = root) =>
      handlers.event?.({
        id: `event-${++sequence}`,
        type: "rpc.kilocode.agent-manager.requested",
        location: { directory },
        data: value,
      } as unknown as OpenCodeEvent)
    return {
      bridge,
      client,
      close,
      connection,
      handlers,
      lists,
      managed,
      delivered,
      push,
      formReply,
      rejections,
      replies,
      request,
      rpc,
      statsCalls,
      status,
    }
  }

  const request = {
    id: "amr_prompt",
    sessionID: "ses_caller",
    operation: "prompt",
    targetSessionID: "ses_target",
    prompt: "Continue",
  }

  it("deduplicates busy-session prompt submission and retries only the failed acknowledgement", async () => {
    const test = harness()
    test.status.failReply = true

    test.request(request)
    await waitFor(() => test.replies.length === 1)
    test.status.failReply = false
    test.request(request)
    await waitFor(() => test.replies.length === 2)

    expect(test.rejections).toEqual([])
    expect(test.delivered).toHaveBeenCalledTimes(1)
    expect(test.delivered).toHaveBeenCalledWith({
      sessionID: "ses_target",
      text: expect.stringContaining("[Agent Manager peer request]\nRequest ID: amr_prompt\nFrom session: ses_caller"),
      metadata: {
        agentManager: {
          kind: "request",
          requestID: "amr_prompt",
          sourceSessionID: "ses_caller",
          sourceDirectory: root,
          targetSessionID: "ses_target",
          prompt: "Continue",
        },
      },
    })
    expect(test.replies).toEqual([
      {
        requestID: "amr_prompt",
        directory: root,
        result: { operation: "prompt", sessionID: "ses_target", delivered: true },
      },
      {
        requestID: "amr_prompt",
        directory: root,
        result: { operation: "prompt", sessionID: "ses_target", delivered: true },
      },
    ])
    test.bridge.dispose()
  })

  it("routes a peer reply to the original session and rejects the wrong recipient", async () => {
    const test = harness()
    test.request(request)
    await waitFor(() => test.replies.length === 1)

    test.request({
      id: "amr_reply",
      sessionID: "ses_target",
      operation: "prompt",
      targetSessionID: "ses_caller",
      prompt: "The change is complete.",
      replyTo: "amr_prompt",
    })
    await waitFor(() => test.replies.length === 2)

    expect(test.delivered).toHaveBeenCalledTimes(2)
    expect(test.delivered).toHaveBeenLastCalledWith({
      sessionID: "ses_caller",
      text: expect.stringContaining("[Agent Manager peer reply]"),
    })
    expect(test.replies[1]).toEqual({
      requestID: "amr_reply",
      directory: root,
      result: { operation: "prompt", sessionID: "ses_caller", delivered: true },
    })

    test.request({
      id: "amr_wrong_reply",
      sessionID: "ses_other",
      operation: "prompt",
      targetSessionID: "ses_caller",
      prompt: "This must not be delivered.",
      replyTo: "amr_prompt",
    })
    await waitFor(() => test.rejections.length === 1)

    expect(test.rejections[0]).toMatchObject({ error: { code: "unknown_session" } })
    expect(test.delivered).toHaveBeenCalledTimes(2)
    test.bridge.dispose()
  })

  it("recovers a reply route from the persisted peer request", async () => {
    const test = harness()
    test.request(request)
    await waitFor(() => test.replies.length === 1)

    const body = test.delivered.mock.calls[0]?.[0]
    if (!body) throw new Error("expected the peer request prompt")
    test.client.session.context.mockResolvedValue([{ type: "user", metadata: body.metadata }])
    ;(test.bridge as unknown as { replyRoutes: Map<string, unknown> }).replyRoutes.clear()

    test.request({
      id: "amr_recovered_reply",
      sessionID: "ses_target",
      operation: "prompt",
      targetSessionID: "ses_caller",
      prompt: "The recovered route works.",
      replyTo: "amr_prompt",
    })
    await waitFor(() => test.replies.length === 2)

    expect(test.client.session.context).toHaveBeenCalledWith({ sessionID: "ses_target" })
    expect(test.delivered).toHaveBeenCalledTimes(2)
    expect(test.replies[1]).toEqual({
      requestID: "amr_recovered_reply",
      directory: root,
      result: { operation: "prompt", sessionID: "ses_caller", delivered: true },
    })
    test.bridge.dispose()
  })

  it("rejects a reply after the original session is closed", async () => {
    const test = harness()
    test.request({ ...request, id: "amr_closed" })
    await waitFor(() => test.replies.length === 1)
    test.managed.delete("ses_caller")

    test.request({
      id: "amr_closed_reply",
      sessionID: "ses_target",
      operation: "prompt",
      targetSessionID: "ses_caller",
      prompt: "This must not be delivered.",
      replyTo: "amr_closed",
    })
    await waitFor(() => test.rejections.length === 1)

    expect(test.rejections[0]).toMatchObject({
      error: { code: "unknown_session", message: "The original Agent Manager sender is no longer available" },
    })
    expect(test.delivered).toHaveBeenCalledTimes(1)
    test.bridge.dispose()
  })

  it("adds source-session attribution to prompts sent by another agent", async () => {
    const test = harness()
    test.request({ ...request, id: "amr_attributed", sourceSessionID: "ses_caller" })
    await waitFor(() => test.delivered.mock.calls.length === 1)

    expect(test.delivered).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Continue\n\n<!-- kilo-agent-manager source=ses_caller -->"),
      }),
    )
    test.bridge.dispose()
  })

  it("stops a managed session through the same close operation as the UI", async () => {
    const test = harness()
    test.status.failReply = true
    const stop = {
      id: "amr_stop",
      sessionID: "ses_caller",
      operation: "stop",
      targetSessionID: "ses_target",
    }

    test.request(stop)
    await waitFor(() => test.replies.length === 1)
    test.status.failReply = false
    test.request(stop)
    await waitFor(() => test.replies.length === 2)

    expect(test.close).toHaveBeenCalledTimes(1)
    expect(test.close).toHaveBeenCalledWith("ses_target", root)
    expect(test.replies).toEqual([
      {
        requestID: "amr_stop",
        directory: root,
        result: { operation: "stop", sessionID: "ses_target", stopped: true },
      },
      {
        requestID: "amr_stop",
        directory: root,
        result: { operation: "stop", sessionID: "ses_target", stopped: true },
      },
    ])
    test.bridge.dispose()
  })

  it("moves its own worktree into a section and then ungroups it", async () => {
    const test = harness()
    const section = state.addSection("Review", null)

    test.request(
      {
        id: "amr_move",
        sessionID: "ses_target",
        operation: "move",
        targetSessionID: "ses_target",
        sectionID: section.id,
      },
      dir,
    )
    await waitFor(() => test.replies.length === 1)

    const worktreeID = state.getSession("ses_target")!.worktreeId!
    expect(state.getWorktree(worktreeID)?.sectionId).toBe(section.id)
    expect(test.push).toHaveBeenCalledTimes(1)
    expect(test.replies[0]).toEqual({
      requestID: "amr_move",
      directory: dir,
      result: { operation: "move", sessionID: "ses_target", sectionID: section.id, moved: true },
    })

    test.request(
      {
        id: "amr_ungroup",
        sessionID: "ses_target",
        operation: "move",
        targetSessionID: "ses_target",
        sectionID: null,
      },
      dir,
    )
    await waitFor(() => test.replies.length === 2)

    expect(state.getWorktree(worktreeID)?.sectionId).toBeUndefined()
    expect(test.replies[1]).toEqual({
      requestID: "amr_ungroup",
      directory: dir,
      result: { operation: "move", sessionID: "ses_target", sectionID: null, moved: true },
    })
    test.bridge.dispose()
  })

  it("returns an overview with cached git stats", async () => {
    const test = harness()
    test.request({
      id: "amr_overview",
      sessionID: "ses_caller",
      operation: "overview",
    })
    await waitFor(() => test.replies.length === 1)

    expect(test.statsCalls).toEqual([1])
    expect(test.replies[0]).toEqual({
      requestID: "amr_overview",
      directory: root,
      result: {
        operation: "overview",
        overview: expect.objectContaining({
          ungrouped: [expect.objectContaining({ id: expect.any(String) })],
          sections: [],
        }),
      },
    })
    test.bridge.dispose()
  })

  it("stops a live panel session before it is persisted", async () => {
    const test = harness()
    test.managed.add("ses_live")

    test.request({
      id: "amr_stop_live",
      sessionID: "ses_caller",
      operation: "stop",
      targetSessionID: "ses_live",
    })
    await waitFor(() => test.replies.length === 1)

    expect(state.getSession("ses_live")).toBeUndefined()
    expect(test.close).toHaveBeenCalledWith("ses_live", root)
    expect(test.replies[0]).toEqual({
      requestID: "amr_stop_live",
      directory: root,
      result: { operation: "stop", sessionID: "ses_live", stopped: true },
    })
    test.bridge.dispose()
  })

  it("routes prompt, answer, move, and stop for a live-only managed worktree session", async () => {
    const wt = state.getWorktrees()[0]!
    const live = { ...info("ses_live", dir, "Live"), worktreeId: wt.id }
    const section = state.addSection("Review", null)
    const contexts = new ProjectContexts({
      workspaceRoot: () => root,
      registry: { list: () => [], get: () => undefined },
      deps: { log: () => undefined, state: () => state },
    })
    const ctx = contexts.active()!
    ctx.stateManager()
    ctx.upsertSession(live)
    const test = harness()
    test.bridge.dispose()
    const close = mock(async (id: string) => {
      expect(id).toBe(live.id)
    })
    const bridge = createOrchestrationBridge({
      connection: test.connection,
      contexts,
      projectScope: new ProjectScope(),
      getRoot: () => ctx.root,
      getState: () => state,
      getStateReady: () => Promise.resolve(),
      initStateReady: () => Promise.resolve(),
      getStats: async () => ({ worktrees: [] }),
      getPrs: () => new Map(),
      pushState: () => undefined,
      hasPanelSession: () => false,
      closeSession: close,
      postSessionClosed: () => undefined,
      log: () => undefined,
    })
    const send = (value: unknown) => test.request(value, ctx.root)

    send({
      id: "amr_live_prompt",
      sessionID: "ses_caller",
      operation: "prompt",
      targetSessionID: live.id,
      prompt: "Continue",
    })
    await waitFor(() => test.replies.length === 1)
    expect(test.delivered).toHaveBeenCalledWith(expect.objectContaining({ sessionID: live.id }))
    ;(test.client.form.list as ReturnType<typeof mock>).mockImplementation(
      async ({ location }: { location: { directory: string } }) => ({
        location,
        data: [
          {
            id: "que_live",
            sessionID: live.id,
            title: "Questions",
            metadata: { kind: "question" },
            fields: [
              {
                key: "q0",
                type: "string",
                title: "Approve",
                description: "Proceed?",
                options: [{ value: "Yes", label: "Yes", description: "go" }],
              },
            ],
          },
        ],
      }),
    )
    send({
      id: "amr_live_answer",
      sessionID: "ses_caller",
      operation: "answer",
      targetSessionID: live.id,
      answers: [["Yes"]],
    })
    await waitFor(() => test.replies.length === 2)
    expect(test.formReply).toHaveBeenCalledWith({
      sessionID: live.id,
      formID: "que_live",
      answer: { q0: "Yes" },
    })

    send({
      id: "amr_live_move",
      sessionID: "ses_caller",
      operation: "move",
      targetSessionID: live.id,
      sectionID: section.id,
    })
    await waitFor(() => test.replies.length === 3)
    expect(state.getWorktree(wt.id)?.sectionId).toBe(section.id)

    send({
      id: "amr_live_stop",
      sessionID: "ses_caller",
      operation: "stop",
      targetSessionID: live.id,
    })
    await waitFor(() => test.replies.length === 4)
    expect(close).toHaveBeenCalledWith(live.id)
    expect(ctx.hasLiveSession(live.id)).toBe(false)
    expect(state.getSession(live.id)).toBeUndefined()

    ctx.upsertSession(live)
    send({
      id: "amr_live_closed",
      sessionID: "ses_caller",
      operation: "prompt",
      targetSessionID: live.id,
      prompt: "Do not reopen",
    })
    await waitFor(() => test.rejections.length === 1)
    expect(test.rejections[0]).toMatchObject({ error: { code: "unknown_session" } })
    bridge.dispose()
  })

  it("rejects a stopped live-only session after its project state is restored", async () => {
    const wt = state.getWorktrees()[0]!
    state.closeSession("ses_stopped", wt.id)
    await state.flush()
    const restored = new WorktreeStateManager(root, () => undefined)
    await restored.load()
    const contexts = new ProjectContexts({
      workspaceRoot: () => root,
      registry: { list: () => [], get: () => undefined },
      deps: { log: () => undefined, state: () => restored },
    })
    const ctx = contexts.active()!
    ctx.stateManager()
    ctx.upsertSession({ ...info("ses_stopped", dir, "Stopped"), worktreeId: wt.id })
    const test = harness()
    test.bridge.dispose()
    const bridge = createOrchestrationBridge({
      connection: test.connection,
      contexts,
      projectScope: new ProjectScope(),
      getRoot: () => ctx.root,
      getState: () => restored,
      getStateReady: () => Promise.resolve(),
      initStateReady: () => Promise.resolve(),
      getStats: async () => ({ worktrees: [] }),
      getPrs: () => new Map(),
      pushState: () => undefined,
      hasPanelSession: () => false,
      closeSession: async () => undefined,
      postSessionClosed: () => undefined,
      log: () => undefined,
    })

    test.request(
      {
        id: "amr_restored_stopped",
        sessionID: "ses_caller",
        operation: "prompt",
        targetSessionID: "ses_stopped",
        prompt: "Do not reopen",
      },
      ctx.root,
    )
    await waitFor(() => test.rejections.length === 1)
    expect(test.rejections[0]).toMatchObject({ error: { code: "unknown_session" } })
    expect(test.delivered).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it("answers a managed session's pending question through the backend reply route", async () => {
    const test = harness()
    ;(test.client.form.list as ReturnType<typeof mock>).mockImplementation(
      async ({ location }: { location: { directory: string } }) => ({
        location,
        data: [
          {
            id: "que_1",
            sessionID: "ses_target",
            title: "Questions",
            metadata: { kind: "question" },
            fields: [
              {
                key: "q0",
                type: "string",
                title: "Approve",
                description: "Proceed?",
                options: [{ value: "Yes", label: "Yes", description: "go" }],
              },
            ],
          },
        ],
      }),
    )

    test.request({
      id: "amr_answer",
      sessionID: "ses_caller",
      operation: "answer",
      targetSessionID: "ses_target",
      answers: [["Yes"]],
    })
    await waitFor(() => test.replies.length === 1)

    expect(test.formReply).toHaveBeenCalledTimes(1)
    expect(test.formReply).toHaveBeenCalledWith({
      sessionID: "ses_target",
      formID: "que_1",
      answer: { q0: "Yes" },
    })
    expect(test.replies[0]).toEqual({
      requestID: "amr_answer",
      directory: root,
      result: { operation: "answer", sessionID: "ses_target", questionID: "que_1", resolved: true },
    })
    test.bridge.dispose()
  })

  it("rejects an answer when the target has no pending question", async () => {
    const test = harness()

    test.request({
      id: "amr_answer_none",
      sessionID: "ses_caller",
      operation: "answer",
      targetSessionID: "ses_target",
      questionID: "que_gone",
      answers: [["Yes"]],
    })
    await waitFor(() => test.rejections.length === 1)

    expect(test.formReply).not.toHaveBeenCalled()
    expect(test.rejections[0]).toEqual({
      requestID: "amr_answer_none",
      directory: root,
      error: { code: "unavailable_session", message: expect.stringContaining("no pending question") },
    })
    test.bridge.dispose()
  })

  it("rejects stopping a session not managed by the current workspace", async () => {
    const test = harness()
    test.request({
      id: "amr_stop_unknown",
      sessionID: "ses_caller",
      operation: "stop",
      targetSessionID: "ses_unknown",
    })
    await waitFor(() => test.rejections.length === 1)

    expect(test.close).not.toHaveBeenCalled()
    expect(test.rejections).toEqual([
      {
        requestID: "amr_stop_unknown",
        directory: root,
        error: {
          code: "unknown_session",
          message: "The session is not managed by this Agent Manager workspace",
        },
      },
    ])
    test.bridge.dispose()
  })

  it("rejects request origins outside the current Agent Manager workspace", async () => {
    const test = harness()

    test.request(request, "/outside")
    await waitFor(() => test.rejections.length === 1)

    expect(test.delivered).not.toHaveBeenCalled()
    expect(test.rejections).toEqual([
      {
        requestID: "amr_prompt",
        directory: "/outside",
        error: {
          code: "cross_workspace",
          message: "Agent Manager request directory does not belong to this workspace",
        },
      },
    ])
    test.bridge.dispose()
  })

  it("accepts a canonical alias of the current workspace directory", async () => {
    const test = harness()

    test.request(request, fs.realpathSync(root))
    await waitFor(() => test.replies.length === 1)

    expect(test.delivered).toHaveBeenCalledTimes(1)
    expect(test.rejections).toEqual([])
    test.bridge.dispose()
  })

  it("recovers pending requests for the root and worktrees with running sessions", async () => {
    const test = harness()
    test.client.session.active.mockImplementation(async () => ({ ses_target: { type: "running" } }))
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.delivered.mock.calls.length === 1)

    expect(test.rpc.list).toHaveBeenCalledWith({}, { location: { directory: root } })
    expect(test.rpc.list).toHaveBeenCalledWith({}, { location: { directory: dir } })
    expect(test.delivered).toHaveBeenCalledTimes(1)
    expect(test.replies[0]).toEqual({
      requestID: "amr_prompt",
      directory: dir,
      result: { operation: "prompt", sessionID: "ses_target", delivered: true },
    })
    test.bridge.dispose()
  })

  it("does not ask a worktree without a running session", async () => {
    const test = harness()
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.rpc.list.mock.calls.length === 1)
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    expect(test.rpc.list.mock.calls).toEqual([[{}, { location: { directory: root } }]])
    expect(test.delivered).not.toHaveBeenCalled()
    test.bridge.dispose()
  })

  it("asks every managed directory when the running sessions are unknown", async () => {
    const test = harness()
    test.client.session.active.mockImplementation(async () => {
      throw new Error("offline")
    })
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.delivered.mock.calls.length === 1)

    expect(test.rpc.list).toHaveBeenCalledWith({}, { location: { directory: root } })
    expect(test.rpc.list).toHaveBeenCalledWith({}, { location: { directory: dir } })
    test.bridge.dispose()
  })

  it("asks every managed directory when a running session's directory is unknown", async () => {
    const test = harness()
    test.client.session.active.mockImplementation(async () => ({ ses_target: { type: "running" } }))
    test.client.session.get.mockImplementation(async () => {
      throw new Error("offline")
    })
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.rpc.list.mock.calls.length === 2)

    expect(test.rpc.list).toHaveBeenCalledWith({}, { location: { directory: root } })
    expect(test.rpc.list).toHaveBeenCalledWith({}, { location: { directory: dir } })
    test.bridge.dispose()
  })

  it("continues recovery when another managed directory fails", async () => {
    const test = harness()
    test.client.session.active.mockImplementation(async () => ({ ses_target: { type: "running" } }))
    test.status.failList = root
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.delivered.mock.calls.length === 1)

    expect(test.rpc.list).toHaveBeenCalledWith({}, { location: { directory: root } })
    expect(test.rpc.list).toHaveBeenCalledWith({}, { location: { directory: dir } })
    expect(test.delivered).toHaveBeenCalledTimes(1)
    test.bridge.dispose()
  })

  it("recovers after the client goes away during state initialization", async () => {
    let drop = true
    const test = harness({
      ready: async () => {
        if (drop) {
          drop = false
          test.status.failClient = true
        }
        return state
      },
    })
    test.client.session.active.mockImplementation(async () => ({ ses_target: { type: "running" } }))
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.delivered.mock.calls.length === 1)

    expect(test.delivered).toHaveBeenCalledTimes(1)
    expect(test.replies[0]).toEqual({
      requestID: "amr_prompt",
      directory: dir,
      result: { operation: "prompt", sessionID: "ses_target", delivered: true },
    })
    test.bridge.dispose()
  })

  it("keeps live-only secondary worktree sessions scoped to their owning project", async () => {
    const secondary = fs.mkdtempSync(path.join(os.tmpdir(), "am-orchestration-secondary-live-"))
    const worktree = path.join(secondary, "worktree")
    fs.mkdirSync(path.join(secondary, ".kilo"), { recursive: true })
    fs.mkdirSync(worktree)
    const other = new WorktreeStateManager(secondary, () => undefined)
    const wt = other.addWorktree({ branch: "fix/secondary-live", path: worktree, parentBranch: "main" })
    const live = { id: "ses_secondary_live", worktreeId: wt.id, createdAt: "" }
    const test = harness({
      root: (origin) => (origin === secondary ? secondary : root),
      ready: async (origin) => (origin === secondary ? other : state),
      state: (origin) => (origin === secondary ? other : state),
      resolve: (id, origin) => (id === live.id && origin === secondary ? live : undefined),
    })
    test.client.session.get.mockImplementation(async ({ sessionID }: { sessionID: string }) =>
      info(sessionID, worktree),
    )

    test.request(
      {
        id: "amr_secondary_live",
        sessionID: "ses_caller",
        operation: "prompt",
        targetSessionID: live.id,
        prompt: "Continue",
      },
      secondary,
    )
    await waitFor(() => test.replies.length === 1)
    expect(test.delivered).toHaveBeenCalledWith(expect.objectContaining({ sessionID: live.id }))
    expect(other.getSession(live.id)).toBeUndefined()

    test.request({
      id: "amr_secondary_foreign",
      sessionID: "ses_caller",
      operation: "prompt",
      targetSessionID: live.id,
      prompt: "Cross project",
    })
    await waitFor(() => test.rejections.length === 1)
    expect(test.rejections[0]).toMatchObject({ error: { code: "unknown_session" } })

    test.bridge.dispose()
    await other.flush()
    fs.rmSync(secondary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  it("handles requests for secondary project directories in multi-project mode", async () => {
    const secondaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "am-orchestration-secondary-"))
    fs.mkdirSync(path.join(secondaryRoot, ".kilo"), { recursive: true })
    const secondaryState = new WorktreeStateManager(secondaryRoot, () => undefined)
    secondaryState.addSession("ses_secondary", null)

    const test = harness({
      root: (origin) => (origin === secondaryRoot ? secondaryRoot : root),
      ready: async (origin) => (origin === secondaryRoot ? secondaryState : state),
      state: (origin) => (origin === secondaryRoot ? secondaryState : state),
    })
    test.client.session.get.mockImplementation(async ({ sessionID }: { sessionID: string }) =>
      info(sessionID, secondaryRoot),
    )

    test.request(
      {
        id: "amr_secondary",
        sessionID: "ses_caller",
        operation: "prompt",
        targetSessionID: "ses_secondary",
        prompt: "Hello from secondary",
      },
      secondaryRoot,
    )
    await waitFor(() => test.replies.length === 1)

    expect(test.delivered).toHaveBeenCalledTimes(1)
    expect(test.replies[0]).toEqual({
      requestID: "amr_secondary",
      directory: secondaryRoot,
      result: { operation: "prompt", sessionID: "ses_secondary", delivered: true },
    })
    test.bridge.dispose()
    await secondaryState.flush()
    fs.rmSync(secondaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })
})
