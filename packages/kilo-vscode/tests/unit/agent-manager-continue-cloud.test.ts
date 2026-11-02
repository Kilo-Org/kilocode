import { beforeEach, describe, expect, it } from "bun:test"
import {
  CONTINUATION_ACTIONS,
  CONTINUATION_MAX,
  continuationProgress,
  continuationStage,
  continueInCloud,
  createContinuationController,
  currentOperation,
  fallbackModes,
  resetContinuationAttempts,
  retainKey,
  startContinuation,
  type ContinueCloudHost,
} from "../../src/agent-manager/continue-cloud"

/** Every code the CLI can emit for Continue-in-Cloud (contract A). */
const CLI_CODES = [
  "worktree_dirty",
  "branch_detached",
  "branch_no_upstream",
  "branch_not_pushed",
  "remote_unsupported",
  "session_not_in_worktree",
  "session_busy",
  "session_changed",
  "sync_unavailable",
  "sync_failed",
  "organization_mismatch",
  "insufficient_balance",
  "continuation_incomplete",
  "creation_in_progress",
  "operation_key_reuse_mismatch",
  "rejected",
  "signed_out",
  "auth_unavailable",
  "unavailable",
  "invalid_request",
]

const request = {
  worktreeId: "wt-1",
  directory: "/repo/.kilo/worktrees/wt-1",
  sessionIds: ["ses-a", "ses-b"],
  activeSessionId: "ses-b",
}

interface Harness {
  host: ContinueCloudHost
  keys: string[]
  selections: string[][]
  opened: string[]
  copied: string[]
  errors: string[]
  prompts: string[]
  operations: string[]
  events: string[]
  /** Set the reply the fake CLI returns, or a thrown transport error. */
  reply: { data?: unknown; error?: unknown; thrown?: unknown }
  /** Action returned by the first choice prompt. */
  answer?: string
  /** Make the choice prompt never resolve, modelling an ignored notification. */
  hang?: boolean
}

function harness(): Harness {
  const keys: string[] = []
  const selections: string[][] = []
  const opened: string[] = []
  const copied: string[] = []
  const errors: string[] = []
  const prompts: string[] = []
  const operations: string[] = []
  const events: string[] = []
  const reply: Harness["reply"] = {}
  let answered = false
  const self: Harness = {
    host: undefined as unknown as ContinueCloudHost,
    keys,
    selections,
    opened,
    copied,
    errors,
    prompts,
    operations,
    events,
    reply,
  }
  const client = {
    sessionHost: {
      continueWorkspace: (params: {
        sessionHostContinueWorkspaceInput?: { operationKey?: string; sessionIDs?: string[] }
      }) => {
        const input = params.sessionHostContinueWorkspaceInput
        keys.push(input?.operationKey ?? "")
        selections.push([...(input?.sessionIDs ?? [])])
        if (reply.thrown !== undefined) return Promise.reject(reply.thrown)
        return Promise.resolve({ data: reply.data, error: reply.error })
      },
    },
  }
  self.host = {
    client: () => client as never,
    error: (message) => errors.push(message),
    // Answer at most once so a Retry choice never recurses forever.
    choose: async (_kind, message, actions) => {
      events.push("choose")
      prompts.push(message)
      if (self.hang) return await new Promise<string | undefined>(() => undefined)
      if (self.answer && !answered && actions.includes(self.answer)) {
        answered = true
        return self.answer
      }
      return undefined
    },
    openUrl: (url) => opened.push(url),
    copy: (text) => copied.push(text),
    capture: () => undefined,
    log: () => undefined,
    onOperation: (worktreeId, operationKey) => operations.push(`${worktreeId}:${operationKey}`),
    dispatch: async (worktreeId, _directory, run) => {
      events.push(`dispatch:${worktreeId}:start`)
      await run()
      events.push(`dispatch:${worktreeId}:end`)
    },
  }
  return self
}

describe("Continue in Cloud — key retention", () => {
  beforeEach(() => resetContinuationAttempts())

  it("keeps the key for a balance rejection even though the wire says retryable: false", () => {
    expect(retainKey("insufficient_balance", false)).toBe(true)
  })

  it("keeps the key for a partial creation, a creation in progress, and an ambiguous transport failure", () => {
    expect(retainKey("continuation_incomplete", false)).toBe(true)
    expect(retainKey("creation_in_progress", false)).toBe(true)
    expect(retainKey(undefined, true)).toBe(true)
  })

  it("keeps the key when a reply carries no actionable code (SDK 502/503)", () => {
    expect(retainKey(undefined, false)).toBe(true)
  })

  it("drops the key for a definitive Cloud rejection and an unavailable sync", () => {
    expect(retainKey("rejected", false)).toBe(false)
    expect(retainKey("sync_unavailable", false)).toBe(false)
  })

  it("drops the key for a terminal mismatch and for local preconditions", () => {
    expect(retainKey("operation_key_reuse_mismatch", false)).toBe(false)
    expect(retainKey("worktree_dirty", false)).toBe(false)
    expect(retainKey("session_not_in_worktree", false)).toBe(false)
  })

  it("has an action for every code the CLI can emit", () => {
    const missing = CLI_CODES.filter((code) => !CONTINUATION_ACTIONS[code])
    expect(missing).toEqual([])
  })
})

describe("Continue in Cloud — operation key lifecycle", () => {
  beforeEach(() => resetContinuationAttempts())

  it("reuses the same operation key across retries after an ambiguous failure", async () => {
    const h = harness()
    h.reply.thrown = new Error("socket closed")
    await continueInCloud(h.host, request)
    await continueInCloud(h.host, request)
    expect(h.keys.length).toBe(2)
    expect(h.keys[0]).toBe(h.keys[1])
    expect(h.keys[0]).not.toBe("")
  })

  it("reuses the same key after an SDK 503 reply that carries no code", async () => {
    const h = harness()
    // The CLI returns a 503 as an error object without a `code` field.
    h.reply.error = { message: "Service Unavailable" }
    await continueInCloud(h.host, request)
    h.reply.error = undefined
    h.reply.data = { url: "https://app.kilo.ai/cloud/sessions/abc", sessions: [] }
    await continueInCloud(h.host, request)
    expect(h.keys.length).toBe(2)
    expect(h.keys[0]).toBe(h.keys[1])
    expect(currentOperation("wt-1")).toBeUndefined()
  })

  it("reuses the same operation key after a balance rejection", async () => {
    const h = harness()
    h.reply.error = { code: "insufficient_balance", message: "no balance", retryable: false }
    await continueInCloud(h.host, request)
    await continueInCloud(h.host, request)
    expect(h.keys[0]).toBe(h.keys[1])
  })

  it("starts over with a new key after a terminal mismatch", async () => {
    const h = harness()
    h.reply.error = { code: "operation_key_reuse_mismatch", message: "changed", retryable: false }
    await continueInCloud(h.host, request)
    await continueInCloud(h.host, request)
    expect(h.keys[0]).not.toBe(h.keys[1])
  })

  it("starts over with a new key after a definitive Cloud rejection", async () => {
    const h = harness()
    h.reply.error = { code: "rejected", message: "rejected", retryable: false }
    await continueInCloud(h.host, request)
    await continueInCloud(h.host, request)
    expect(h.keys[0]).not.toBe(h.keys[1])
  })

  it("offers Retry on a retained failure and reuses the key when chosen", async () => {
    const h = harness()
    h.reply.error = { code: "creation_in_progress", message: "still creating", retryable: true }
    h.answer = "Retry"
    await continueInCloud(h.host, request)
    expect(h.keys.length).toBe(2)
    expect(h.keys[0]).toBe(h.keys[1])
  })

  it("does not call the CLI with no sessions", async () => {
    const h = harness()
    await continueInCloud(h.host, { ...request, sessionIds: [] })
    expect(h.keys).toEqual([])
    expect(h.errors.length).toBe(1)
  })

  it("refuses more than the maximum number of sessions", async () => {
    const h = harness()
    const many = Array.from({ length: CONTINUATION_MAX + 1 }, (_, i) => `ses-${i}`)
    await continueInCloud(h.host, { ...request, sessionIds: many, activeSessionId: many[0]! })
    expect(h.keys).toEqual([])
    expect(h.errors.length).toBe(1)
  })

  it("refuses an active session that is not among the copied sessions", async () => {
    const h = harness()
    await continueInCloud(h.host, { ...request, activeSessionId: "ses-missing" })
    expect(h.keys).toEqual([])
    expect(h.errors.length).toBe(1)
  })
})

describe("Continue in Cloud — success actions and mode fallback", () => {
  beforeEach(() => resetContinuationAttempts())

  it("never opens the browser automatically and opens only when chosen", async () => {
    const h = harness()
    h.reply.data = { url: "https://app.kilo.ai/cloud/sessions/abc", sessions: [] }
    await continueInCloud(h.host, request)
    expect(h.opened).toEqual([])

    const second = harness()
    second.answer = "Open"
    second.reply.data = { url: "https://app.kilo.ai/cloud/sessions/def", sessions: [] }
    await continueInCloud(second.host, request)
    expect(second.opened).toEqual(["https://app.kilo.ai/cloud/sessions/def"])
  })

  it("copies the link when Copy Link is chosen", async () => {
    const h = harness()
    h.answer = "Copy Link"
    h.reply.data = { url: "https://app.kilo.ai/cloud/sessions/abc", sessions: [] }
    await continueInCloud(h.host, request)
    expect(h.copied).toEqual(["https://app.kilo.ai/cloud/sessions/abc"])
    expect(h.opened).toEqual([])
  })

  it("names the modes Cloud replaced with a fallback", async () => {
    const sessions = [
      { agent: { mode: "build" }, modeFallback: false },
      { agent: { mode: "code" }, modeFallback: true },
      { agent: { mode: "plan" }, modeFallback: true },
    ]
    expect(fallbackModes(sessions)).toEqual(["code", "plan"])

    const h = harness()
    h.reply.data = { url: "https://app.kilo.ai/cloud/sessions/abc", sessions }
    await continueInCloud(h.host, request)
    expect(h.prompts.at(-1)).toContain("code, plan")
  })
})

describe("Continue in Cloud — keyed stage progress", () => {
  const active = { worktreeId: "wt-1", directory: "/repo/.kilo/worktrees/wt-1", operationKey: "op-1" }

  it("reports the stage only for the operation in flight", () => {
    const event = {
      type: "session.host.continuation",
      properties: { operationKey: "op-1", directory: active.directory, stage: "syncing" },
    }
    expect(continuationStage(event, "op-1")).toBe("syncing")
    expect(continuationProgress(active, event)).toEqual({ worktreeId: "wt-1", stage: "syncing" })
  })

  it("ignores a wrong operation key", () => {
    const event = {
      type: "session.host.continuation",
      properties: { operationKey: "op-2", directory: active.directory, stage: "creating" },
    }
    expect(continuationStage(event, "op-1")).toBeUndefined()
    expect(continuationProgress(active, event)).toBeUndefined()
  })

  it("ignores another worktree's directory", () => {
    const event = {
      type: "session.host.continuation",
      properties: { operationKey: "op-1", directory: "/repo/.kilo/worktrees/wt-2", stage: "creating" },
    }
    expect(continuationProgress(active, event)).toBeUndefined()
  })

  it("ignores an unknown stage and a missing operation key", () => {
    const unknown = {
      type: "session.host.continuation",
      properties: { operationKey: "op-1", directory: active.directory, stage: "nope" },
    }
    expect(continuationProgress(active, unknown)).toBeUndefined()
    expect(continuationProgress({ ...active, operationKey: undefined }, unknown)).toBeUndefined()
  })
})

describe("Continue in Cloud — host-owned selection", () => {
  beforeEach(() => resetContinuationAttempts())

  function panel(sessions: Record<string, string[]>, closed: string[]) {
    const errors: string[] = []
    const h = harness()
    const service = {
      getWorktree: (id: string) => ({ id, path: `/repo/.kilo/worktrees/${id}` }),
      getSessions: (id: string) => (sessions[id] ?? []).map((sid) => ({ id: sid, worktreeId: id })),
      isSessionClosed: (id: string) => closed.includes(id),
    }
    return {
      errors,
      h,
      run: (worktreeId: string) =>
        startContinuation(
          {
            state: service as never,
            activeSessionId: "ses-b",
            projectId: "p1",
            getClient: h.host.client,
            choose: h.host.choose,
            openUrl: h.host.openUrl,
            copy: h.host.copy,
            error: (message) => {
              errors.push(message)
              h.host.error(message)
            },
            capture: h.host.capture,
            log: h.host.log,
            onOperation: h.host.onOperation,
            dispatch: h.host.dispatch,
          },
          worktreeId,
        ),
    }
  }

  it("gathers open sessions from the host and excludes closed ones", async () => {
    const p = panel({ "wt-1": ["ses-a", "ses-b", "ses-c"] }, ["ses-a"])
    p.h.reply.data = { url: "https://app.kilo.ai/cloud/sessions/abc", sessions: [] }
    await p.run("wt-1")
    expect(p.h.keys.length).toBe(1)
    expect(p.h.selections[0]).toEqual(["ses-b", "ses-c"])
  })

  it("reports when no open session remains", async () => {
    const p = panel({ "wt-1": ["ses-a", "ses-b"] }, ["ses-a", "ses-b"])
    await p.run("wt-1")
    expect(p.h.keys).toEqual([])
    expect(p.errors.length).toBe(1)
  })

  it("captures a new host selection under a new key after a terminal drop", async () => {
    const h = harness()
    const sessions: Record<string, string[]> = { "wt-1": ["ses-a", "ses-b"] }
    const service = {
      getWorktree: (id: string) => ({ id, path: `/repo/.kilo/worktrees/${id}` }),
      getSessions: (id: string) => (sessions[id] ?? []).map((sid) => ({ id: sid, worktreeId: id })),
      isSessionClosed: () => false,
    }
    const run = (worktreeId: string) =>
      startContinuation(
        {
          state: service as never,
          activeSessionId: "ses-b",
          projectId: "p1",
          getClient: h.host.client,
          choose: h.host.choose,
          openUrl: h.host.openUrl,
          copy: h.host.copy,
          error: h.host.error,
          capture: h.host.capture,
          log: h.host.log,
          onOperation: h.host.onOperation,
          dispatch: h.host.dispatch,
        },
        worktreeId,
      )

    h.reply.error = { code: "rejected", message: "rejected", retryable: false }
    await run("wt-1")
    sessions["wt-1"] = ["ses-c"]
    h.reply.error = undefined
    h.reply.data = { url: "https://app.kilo.ai/cloud/sessions/abc", sessions: [] }
    await run("wt-1")

    expect(h.keys.length).toBe(2)
    expect(h.keys[0]).not.toBe(h.keys[1])
    expect(h.selections[1]).toEqual(["ses-c"])
  })
})

describe("Continue in Cloud — operation lifecycle", () => {
  it("ends the dispatch scope before the result prompt and lets another worktree start", async () => {
    const h = harness()
    h.hang = true
    h.reply.data = { url: "https://app.kilo.ai/cloud/sessions/abc", sessions: [] }

    // The user never answers the success prompt, so this call never resolves.
    void continueInCloud(h.host, request)
    while (!h.events.includes("dispatch:wt-1:end")) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(h.events).toEqual(["dispatch:wt-1:start", "dispatch:wt-1:end", "choose"])

    // Because the operation already ended, another worktree can dispatch.
    void continueInCloud(h.host, { ...request, worktreeId: "wt-2" })
    while (!h.events.includes("dispatch:wt-2:end")) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(h.events).toContain("dispatch:wt-2:end")
  })

  it("tracks active only while the dispatch runs and ends it at settle", async () => {
    const opens: Array<{ title: string; cancellable: boolean | undefined }> = []
    const controller = createContinuationController({
      error: () => undefined,
      withProgress: async (title, task, opts) => {
        opens.push({ title, cancellable: opts?.cancellable })
        return await task(
          () => false,
          () => undefined,
        )
      },
    })

    expect(controller.active()).toBe(false)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const running = controller.dispatch("wt-1", "/repo/.kilo/worktrees/wt-1", async () => {
      expect(controller.active()).toBe(true)
      await gate
    })
    await Promise.resolve()
    expect(controller.active()).toBe(true)
    release()
    await running
    expect(controller.active()).toBe(false)
    expect(opens).toEqual([{ title: "Continue in Cloud", cancellable: false }])
  })

  it("forwards only the matching key and worktree to the progress reporter", async () => {
    const reports: string[] = []
    const controller = createContinuationController({
      error: () => undefined,
      withProgress: async (_title, task) =>
        await task(
          () => false,
          (message) => reports.push(message),
        ),
    })
    controller.setKey("op-1")
    const event = (operationKey: string, directory: string, stage: string) => ({
      type: "session.host.continuation",
      properties: { operationKey, directory, stage },
    })
    await controller.dispatch("wt-1", "/repo/.kilo/worktrees/wt-1", async () => {
      controller.onEvent(event("op-2", "/repo/.kilo/worktrees/wt-1", "checking"))
      controller.onEvent(event("op-1", "/repo/.kilo/worktrees/wt-2", "checking"))
      controller.onEvent(event("op-1", "/repo/.kilo/worktrees/wt-1", "syncing"))
    })
    expect(reports).toEqual(["Syncing sessions…"])
  })
})

describe("Continue in Cloud — SDK errors", () => {
  beforeEach(() => resetContinuationAttempts())

  for (const [tag, code] of [
    ["UnauthorizedError", "unauthorized"],
    ["ServiceUnavailableError", "unavailable"],
    ["UpstreamError", "invalid_response"],
  ] as const) {
    it(`shows an actionable message for ${tag} and retains the request`, async () => {
      const h = harness()
      h.reply.error = { _tag: tag, message: "Request failed" }
      await continueInCloud(h.host, request)
      await continueInCloud(h.host, { ...request, sessionIds: ["ses-new"], activeSessionId: "ses-new" })
      expect(h.prompts[0]).toContain(CONTINUATION_ACTIONS[code])
      expect(h.keys[0]).toBe(h.keys[1])
      expect(h.selections).toEqual([request.sessionIds, request.sessionIds])
    })
  }
})
