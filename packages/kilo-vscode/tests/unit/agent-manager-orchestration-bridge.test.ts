import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { AgentManagerRequest, Session } from "@kilocode/sdk/v2/client"
import { AgentManagerOrchestrationBridge } from "../../src/agent-manager/orchestration-bridge"
import { createOrchestrationBridge } from "../../src/agent-manager/orchestration-setup"
import { ProjectContexts } from "../../src/agent-manager/project/contexts"
import { ProjectScope } from "../../src/agent-manager/project/scope"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"

async function waitFor(check: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !check(); index++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
  }
}

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
    fs.rmSync(root, { recursive: true, force: true })
  })

  function harness(
    overrides?: Partial<Parameters<(typeof AgentManagerOrchestrationBridge.prototype)["constructor"]>[1]>,
  ) {
    const replies: unknown[] = []
    const rejections: unknown[] = []
    const lists = new Map<string, AgentManagerRequest[]>()
    const statsCalls: number[] = []
    const handlers: {
      event?: (event: SSEPayload, directory?: string) => void
      state?: (state: "connecting" | "connected" | "disconnected" | "error") => void
    } = {}
    const status = { failList: "", failReply: false }
    const managed = new Set(["ses_target"])
    const promptAsync = mock(async () => ({ data: undefined }))
    const close = mock(async () => undefined)
    const push = mock(() => undefined)
    const questionReply = mock(async () => ({ data: true }))
    const client = {
      session: {
        get: mock(async ({ sessionID, directory }: { sessionID?: string; directory?: string }) => ({
          data: { id: sessionID ?? "ses_target", directory: directory ?? dir, title: "Target" } as Session,
        })),
        status: mock(async () => ({ data: {} })),
        promptAsync,
      },
      permission: {
        list: mock(async () => ({ data: [] })),
      },
      question: {
        list: mock(async () => ({ data: [] })),
        reply: questionReply,
      },
      kilocode: {
        agentManager: {
          list: mock(async ({ directory }: { directory?: string }) => {
            if (directory === status.failList) throw new Error("offline")
            return { data: lists.get(directory ?? "") ?? [] }
          }),
          reply: mock(async (input: unknown) => {
            replies.push(input)
            return status.failReply ? { error: "offline" } : { data: true }
          }),
          reject: mock(async (input: unknown) => {
            rejections.push(input)
            return { data: true }
          }),
        },
      },
    }
    const providers = new Set<() => string[]>()
    const connection = {
      onEvent: (listener: typeof handlers.event) => {
        handlers.event = listener
        return () => {
          handlers.event = undefined
        }
      },
      onStateChange: (listener: typeof handlers.state) => {
        handlers.state = listener
        return () => {
          handlers.state = undefined
        }
      },
      registerDirectoryProvider: (provider: () => string[]) => {
        providers.add(provider)
        return () => providers.delete(provider)
      },
      getKnownDirectories: () => [...new Set([...providers].flatMap((provider) => provider()))],
      getClient: () => client,
    }
    const bridge = new AgentManagerOrchestrationBridge(connection as never, {
      root: (dir) => (overrides?.root ? overrides.root(dir) : root),
      ready: async (dir) => (overrides?.ready ? overrides.ready(dir) : state),
      state: (dir) => (overrides?.state ? overrides.state(dir) : state),
      stats: async (dir) => {
        statsCalls.push(1)
        return overrides?.stats ? overrides.stats(dir) : { worktrees: [] }
      },
      prs: (dir) => (overrides?.prs ? overrides.prs(dir) : new Map()),
      push: (dir) => (overrides?.push ? overrides.push(dir) : push()),
      resolve: (id, dir) => overrides?.resolve?.(id, dir),
      managed: (id, dir) => (overrides?.managed ? overrides.managed(id, dir) : managed.has(id)),
      close: async (id, dir) => (overrides?.close ? overrides.close(id, dir) : close(id, dir)),
      log: () => undefined,
    })
    const request = (value: AgentManagerRequest, directory = root) =>
      handlers.event?.(
        { id: `event-${value.id}`, type: "kilocode.agent_manager.requested", properties: value } as SSEPayload,
        directory,
      )
    return {
      bridge,
      client,
      close,
      connection,
      handlers,
      lists,
      managed,
      promptAsync,
      push,
      questionReply,
      rejections,
      replies,
      request,
      statsCalls,
      status,
    }
  }

  const request: AgentManagerRequest = {
    id: "amr_prompt",
    sessionID: "ses_caller",
    operation: "prompt",
    targetSessionID: "ses_target",
    prompt: "Continue",
  }

  it("deduplicates prompt delivery and retries only the failed acknowledgement", async () => {
    const test = harness()
    test.status.failReply = true

    test.request(request)
    await waitFor(() => test.replies.length === 1)
    test.status.failReply = false
    test.request(request)
    await waitFor(() => test.replies.length === 2)

    expect(test.promptAsync).toHaveBeenCalledTimes(1)
    expect(test.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "ses_target",
        directory: dir,
        messageID: "msg_agent_manager_amr_prompt",
        parts: [{ type: "text", text: "Continue" }],
      }),
      { throwOnError: true },
    )
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

  it("stops a managed session through the same close operation as the UI", async () => {
    const test = harness()
    test.status.failReply = true
    const stop: AgentManagerRequest = {
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
    const live = { id: "ses_live", worktreeId: wt.id, createdAt: "" }
    const section = state.addSection("Review", null)
    const contexts = new ProjectContexts({
      workspaceRoot: () => root,
      registry: { list: () => [], get: () => undefined },
      enabled: () => false,
      deps: { log: () => undefined, state: () => state },
    })
    const ctx = contexts.active()!
    ctx.stateManager()
    ctx.upsertSession({
      ...live,
      parentID: null,
      title: "Live",
      updatedAt: "",
      revert: null,
      summary: null,
    })
    const routes = new Map<string, string>()
    const test = harness()
    test.bridge.dispose()
    const close = mock(async (id: string) => {
      expect(routes.get(id)).toBe(dir)
      routes.delete(id)
    })
    const bridge = createOrchestrationBridge({
      connectionService: test.connection as never,
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
      routeSession: (id, path) => void routes.set(id, path),
      closeSession: close,
      postSessionClosed: () => undefined,
      log: () => undefined,
    })
    const send = (request: AgentManagerRequest) => test.request(request, ctx.root)

    send({
      id: "amr_live_prompt",
      sessionID: "ses_caller",
      operation: "prompt",
      targetSessionID: live.id,
      prompt: "Continue",
    })
    await waitFor(() => test.replies.length === 1)
    expect(test.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: live.id, directory: dir }), {
      throwOnError: true,
    })
    ;(test.client.question.list as ReturnType<typeof mock>).mockImplementation(async () => ({
      data: [
        {
          id: "que_live",
          sessionID: live.id,
          questions: [{ header: "Approve", question: "Proceed?", options: [{ label: "Yes", description: "go" }] }],
        },
      ],
    }))
    send({
      id: "amr_live_answer",
      sessionID: "ses_caller",
      operation: "answer",
      targetSessionID: live.id,
      answers: [["Yes"]],
    })
    await waitFor(() => test.replies.length === 2)
    expect(test.questionReply).toHaveBeenCalledWith(
      { requestID: "que_live", answers: [["Yes"]], directory: dir },
      { throwOnError: true },
    )

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

    ctx.upsertSession({
      ...live,
      parentID: null,
      title: "Live",
      updatedAt: "",
      revert: null,
      summary: null,
    })
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
      enabled: () => false,
      deps: { log: () => undefined, state: () => restored },
    })
    const ctx = contexts.active()!
    ctx.stateManager()
    ctx.upsertSession({
      id: "ses_stopped",
      worktreeId: wt.id,
      parentID: null,
      title: "Stopped",
      createdAt: "",
      updatedAt: "",
      revert: null,
      summary: null,
    })
    const test = harness()
    test.bridge.dispose()
    const bridge = createOrchestrationBridge({
      connectionService: test.connection as never,
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
      routeSession: () => undefined,
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
    expect(test.promptAsync).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it("answers a managed session's pending question through the backend reply route", async () => {
    const test = harness()
    ;(test.client.question.list as ReturnType<typeof mock>).mockImplementation(async () => ({
      data: [
        {
          id: "que_1",
          sessionID: "ses_target",
          questions: [{ header: "Approve", question: "Proceed?", options: [{ label: "Yes", description: "go" }] }],
        },
      ],
    }))

    test.request({
      id: "amr_answer",
      sessionID: "ses_caller",
      operation: "answer",
      targetSessionID: "ses_target",
      answers: [["Yes"]],
    })
    await waitFor(() => test.replies.length === 1)

    expect(test.questionReply).toHaveBeenCalledTimes(1)
    expect(test.questionReply).toHaveBeenCalledWith(
      { requestID: "que_1", answers: [["Yes"]], directory: dir },
      { throwOnError: true },
    )
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

    expect(test.questionReply).not.toHaveBeenCalled()
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

    expect(test.promptAsync).not.toHaveBeenCalled()
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

    expect(test.promptAsync).toHaveBeenCalledTimes(1)
    expect(test.rejections).toEqual([])
    test.bridge.dispose()
  })

  it("recovers pending requests for the root and managed worktree directories", async () => {
    const test = harness()
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.promptAsync.mock.calls.length === 1)

    expect(test.client.kilocode.agentManager.list).toHaveBeenCalledWith({ directory: root })
    expect(test.client.kilocode.agentManager.list).toHaveBeenCalledWith({ directory: dir })
    expect(test.promptAsync).toHaveBeenCalledTimes(1)
    expect(test.replies[0]).toEqual({
      requestID: "amr_prompt",
      directory: dir,
      result: { operation: "prompt", sessionID: "ses_target", delivered: true },
    })
    test.bridge.dispose()
  })

  it("continues recovery when another managed directory fails", async () => {
    const test = harness()
    test.status.failList = root
    test.lists.set(dir, [request])

    test.handlers.state?.("connected")
    await waitFor(() => test.promptAsync.mock.calls.length === 1)

    expect(test.client.kilocode.agentManager.list).toHaveBeenCalledWith({ directory: root })
    expect(test.client.kilocode.agentManager.list).toHaveBeenCalledWith({ directory: dir })
    expect(test.promptAsync).toHaveBeenCalledTimes(1)
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
    expect(test.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: live.id, directory: worktree }),
      { throwOnError: true },
    )
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
    fs.rmSync(secondary, { recursive: true, force: true })
  })

  it("handles requests for secondary project directories in multi-project mode", async () => {
    const secondaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "am-orchestration-secondary-"))
    fs.mkdirSync(path.join(secondaryRoot, ".kilo"), { recursive: true })
    const secondaryState = new WorktreeStateManager(secondaryRoot, () => undefined)
    secondaryState.addSession("ses_secondary", null)

    const test = harness({
      root: (d) => (d === secondaryRoot ? secondaryRoot : root),
      ready: async (d) => (d === secondaryRoot ? secondaryState : state),
      state: (d) => (d === secondaryRoot ? secondaryState : state),
    })

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

    expect(test.promptAsync).toHaveBeenCalledTimes(1)
    expect(test.replies[0]).toEqual({
      requestID: "amr_secondary",
      directory: secondaryRoot,
      result: { operation: "prompt", sessionID: "ses_secondary", delivered: true },
    })
    test.bridge.dispose()
    await secondaryState.flush()
    fs.rmSync(secondaryRoot, { recursive: true, force: true })
  })
})
