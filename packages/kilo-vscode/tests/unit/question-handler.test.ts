import { describe, expect, it, spyOn } from "bun:test"
import type { QuestionRequest } from "@kilocode/sdk/v2/client"
import {
  fetchAndSendPendingQuestions,
  handleQuestionReject,
  handleQuestionReply,
  type QuestionContext,
} from "../../src/kilo-provider/handlers/question"

function pending(id: string, sessionID: string): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [
      {
        header: "Continue",
        question: "What next?",
        options: [{ label: "Continue", description: "Keep going" }],
      },
    ],
    blocking: false,
    tool: undefined,
  }
}

function ctx(
  opts: {
    tracked?: string[]
    dirs?: Map<string, string>
    extra?: string[]
    pending?: Record<string, QuestionRequest[]>
    errors?: { list?: Record<string, unknown>; reply?: unknown; reject?: unknown }
    changeOnList?: string
    removeOnList?: string
  } = {},
) {
  const messages: unknown[] = []
  const queries: string[] = []
  const replies: unknown[] = []
  const rejects: unknown[] = []
  const questionDirs = new Map<string, string>()
  const dirs = opts.dirs ?? new Map<string, string>()
  let revision = 0
  let changed = false
  const removed = new Set<string>()
  const client = {
    question: {
      list: async (args: { directory?: string }) => {
        const dir = args.directory ?? ""
        queries.push(dir)
        if (opts.changeOnList === dir && !changed) {
          changed = true
          revision += 1
        }
        const error = opts.errors?.list?.[dir]
        if (error) return { data: undefined, error }
        const data = opts.pending?.[dir] ?? []
        if (opts.removeOnList !== dir) return { data }
        if (removed.has(dir)) return { data: [] }
        removed.add(dir)
        revision += 1
        return { data }
      },
      reply: async (args: unknown) => {
        replies.push(args)
        if (opts.errors?.reply) throw opts.errors.reply
        return { data: true }
      },
      reject: async (args: unknown) => {
        rejects.push(args)
        if (opts.errors?.reject) throw opts.errors.reject
        return { data: true }
      },
    },
  } as unknown as QuestionContext["client"]
  const fake: QuestionContext = {
    client,
    currentSessionId: "ses-root",
    trackedSessionIds: new Set(opts.tracked ?? ["ses-root"]),
    sessionDirectories: dirs,
    extraDirectories: () => opts.extra ?? [],
    postMessage: (msg) => messages.push(msg),
    getWorkspaceDirectory: (sessionID) => dirs.get(sessionID ?? "") ?? "/workspace",
    recordQuestionDirectory: (id, dir) => questionDirs.set(id, dir),
    getQuestionDirectory: (id) => questionDirs.get(id),
    clearQuestionDirectory: (id) => {
      questionDirs.delete(id)
      revision += 1
    },
    getQuestionRevision: () => revision,
    pruneQuestionDirectories: (active, scanned) => {
      const size = questionDirs.size
      for (const [id, dir] of questionDirs) {
        if (active.has(id) || !scanned.has(dir)) continue
        questionDirs.delete(id)
      }
      if (questionDirs.size !== size) revision += 1
    },
  }
  return { fake, messages, queries, replies, rejects, questionDirs }
}

describe("question handlers", () => {
  it("routes replies through the recorded request directory", async () => {
    const { fake, replies, questionDirs } = ctx({
      tracked: ["ses-worktree"],
      dirs: new Map([["ses-worktree", "/workspace/.kilo/worktrees/current"]]),
    })
    questionDirs.set("req-1", "/workspace/.kilo/worktrees/origin")

    const ok = await handleQuestionReply(fake, "req-1", [["Continue"]], "ses-worktree")

    expect(ok).toBe(true)
    expect(replies).toEqual([
      {
        requestID: "req-1",
        answers: [["Continue"]],
        directory: "/workspace/.kilo/worktrees/origin",
      },
    ])
    expect(questionDirs.has("req-1")).toBe(false)
  })

  it("routes rejects through the recorded request directory", async () => {
    const { fake, rejects, questionDirs } = ctx({
      tracked: ["ses-worktree"],
      dirs: new Map([["ses-worktree", "/workspace/.kilo/worktrees/current"]]),
    })
    questionDirs.set("req-2", "/workspace/.kilo/worktrees/origin")

    const ok = await handleQuestionReject(fake, "req-2", "ses-worktree")

    expect(ok).toBe(true)
    expect(rejects).toEqual([{ requestID: "req-2", directory: "/workspace/.kilo/worktrees/origin" }])
    expect(questionDirs.has("req-2")).toBe(false)
  })

  it("falls back to the question session directory when no request route is known", async () => {
    const { fake, replies } = ctx({
      tracked: ["ses-worktree"],
      dirs: new Map([["ses-worktree", "/workspace/.kilo/worktrees/current"]]),
    })

    const ok = await handleQuestionReply(fake, "req-3", [["Continue"]], "ses-worktree")

    expect(ok).toBe(true)
    expect(replies).toEqual([
      {
        requestID: "req-3",
        answers: [["Continue"]],
        directory: "/workspace/.kilo/worktrees/current",
      },
    ])
  })

  it("removes a stale question when the backend reports it missing", async () => {
    const error = new Error("Question request not found", {
      cause: { status: 404, body: { name: "NotFoundError" } },
    })
    const { fake, messages, questionDirs } = ctx({ errors: { reply: error } })
    questionDirs.set("req-stale", "/workspace/.kilo/worktrees/origin")

    const ok = await handleQuestionReply(fake, "req-stale", [["Continue"]], "ses-root")

    expect(ok).toBe(false)
    expect(questionDirs.has("req-stale")).toBe(false)
    expect(messages).toContainEqual({ type: "questionResolved", requestID: "req-stale" })
  })

  it("keeps fallback-directory 404s retryable while recovering the request route", async () => {
    const error = new Error("Question request not found", {
      cause: { status: 404, body: { name: "NotFoundError" } },
    })
    const dir = "/workspace/.kilo/worktrees/origin"
    const { fake, messages, questionDirs } = ctx({
      tracked: ["ses-root"],
      extra: [dir],
      pending: { [dir]: [pending("req-misrouted", "ses-root")] },
      errors: { reply: error },
    })
    const spy = spyOn(console, "error").mockImplementation(() => {})

    const ok = await handleQuestionReply(fake, "req-misrouted", [["Continue"]], "ses-root")
    spy.mockRestore()

    expect(ok).toBe(false)
    expect(messages).not.toContainEqual({ type: "questionResolved", requestID: "req-misrouted" })
    expect(messages).toContainEqual({ type: "questionError", requestID: "req-misrouted" })
    expect(questionDirs.get("req-misrouted")).toBe(dir)
  })

  it("removes a fallback question when recovery confirms it is stale", async () => {
    const error = new Error("Question request not found", {
      cause: { status: 404, body: { _tag: "NotFound" } },
    })
    const { fake, messages } = ctx({ errors: { reject: error } })

    const ok = await handleQuestionReject(fake, "req-stale", "ses-root")

    expect(ok).toBe(false)
    expect(messages).toContainEqual({ type: "questionResolved", requestID: "req-stale" })
    expect(messages).not.toContainEqual({ type: "questionError", requestID: "req-stale" })
  })

  it("keeps fallback questions retryable when recovery is incomplete", async () => {
    const error = new Error("Question request not found", {
      cause: { status: 404, body: { _tag: "NotFound" } },
    })
    const dir = "/workspace/.kilo/worktrees/failing"
    const { fake, messages } = ctx({
      extra: [dir],
      errors: { list: { [dir]: new Error("temporary failure") }, reply: error },
    })
    const spy = spyOn(console, "error").mockImplementation(() => {})

    const ok = await handleQuestionReply(fake, "req-unknown", [["Continue"]], "ses-root")
    spy.mockRestore()

    expect(ok).toBe(false)
    expect(messages).toContainEqual({ type: "questionError", requestID: "req-unknown" })
    expect(messages).not.toContainEqual({ type: "questionResolved", requestID: "req-unknown" })
  })

  it("keeps non-404 failures retryable", async () => {
    const error = new Error("Internal server error", {
      cause: { status: 500, body: { name: "InternalServerError" } },
    })
    const { fake, messages, questionDirs } = ctx({ errors: { reject: error } })
    const spy = spyOn(console, "error").mockImplementation(() => {})
    questionDirs.set("req-error", "/workspace/.kilo/worktrees/origin")

    const ok = await handleQuestionReject(fake, "req-error", "ses-root")
    spy.mockRestore()

    expect(ok).toBe(false)
    expect(questionDirs.get("req-error")).toBe("/workspace/.kilo/worktrees/origin")
    expect(messages).toContainEqual({ type: "questionError", requestID: "req-error" })
  })
})

describe("question recovery", () => {
  it("records the directory that owns each recovered question", async () => {
    const dir = "/workspace/.kilo/worktrees/late"
    const { fake, queries, messages, questionDirs } = ctx({
      tracked: ["ses-worktree"],
      extra: [dir],
      pending: { [dir]: [pending("req-1", "ses-worktree")] },
    })

    await fetchAndSendPendingQuestions(fake)

    expect(queries).toEqual(["/workspace", dir])
    expect(questionDirs.get("req-1")).toBe(dir)
    expect(messages).toContainEqual({
      type: "questionRequest",
      question: pending("req-1", "ses-worktree"),
    })
  })

  it("deduplicates recovered questions across directories", async () => {
    const item = pending("req-1", "ses-worktree")
    const dir = "/workspace/.kilo/worktrees/feature"
    const { fake, messages } = ctx({
      tracked: ["ses-worktree"],
      dirs: new Map([["ses-worktree", dir]]),
      pending: { "/workspace": [item], [dir]: [item] },
    })

    await fetchAndSendPendingQuestions(fake)

    expect(messages).toHaveLength(1)
  })

  it("retries a recovery snapshot invalidated by a newer question event", async () => {
    const item = pending("req-missed", "ses-root")
    const { fake, messages, queries, questionDirs } = ctx({
      pending: { "/workspace": [item] },
      changeOnList: "/workspace",
    })

    await fetchAndSendPendingQuestions(fake)

    expect(queries).toEqual(["/workspace", "/workspace"])
    expect(messages).toContainEqual({ type: "questionRequest", question: item })
    expect(questionDirs.get("req-missed")).toBe("/workspace")
  })

  it("does not repost a question resolved during recovery", async () => {
    const item = pending("req-resolved", "ses-root")
    const { fake, messages, queries } = ctx({
      pending: { "/workspace": [item] },
      removeOnList: "/workspace",
    })

    await fetchAndSendPendingQuestions(fake)

    expect(queries).toEqual(["/workspace", "/workspace"])
    expect(messages).toEqual([])
  })

  it("prunes scanned routes while preserving routes from failed directories", async () => {
    const dir = "/workspace/.kilo/worktrees/failing"
    const error = new Error("temporary failure")
    const { fake, questionDirs } = ctx({
      tracked: ["ses-worktree"],
      dirs: new Map([["ses-worktree", dir]]),
      errors: { list: { [dir]: error } },
    })
    const spy = spyOn(console, "error").mockImplementation(() => {})
    questionDirs.set("workspace-stale", "/workspace")
    questionDirs.set("worktree-pending", dir)

    await fetchAndSendPendingQuestions(fake)
    spy.mockRestore()

    expect(questionDirs.has("workspace-stale")).toBe(false)
    expect(questionDirs.get("worktree-pending")).toBe(dir)
  })
})
