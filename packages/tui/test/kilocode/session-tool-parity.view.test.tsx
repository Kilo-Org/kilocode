import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import {
  applyPatchLabel,
  applyPatchValue,
  formatCompletedSubagentDetail,
  formatSubagentRetry,
  parseApplyPatchEntries,
  parsePatchMoves,
  subagentDetail,
  subagentToolLabel,
} from "../../src/routes/session"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"

const model = { providerID: "test", id: "test" }
const liveChild = "ses_child_live"
const doneChild = "ses_child_done"
const retryChild = "ses_child_retry"

function toolPart(
  id: string,
  name: string,
  state: SessionMessageAssistantTool["state"],
): SessionMessageAssistantTool {
  return { type: "tool", id, name, state, time: { created: 1, completed: 2 } }
}

const parentMessages: SessionMessageInfo[] = [
  { type: "user", id: "msg_user", text: "Check parity", time: { created: 1 } },
  {
    type: "assistant",
    id: "msg_assistant",
    agent: "build",
    model,
    finish: "tool-calls",
    content: [
      toolPart("tool_question", "question", {
        status: "error",
        input: { questions: [{ header: "File", question: "Which file?" }] },
        error: { type: "aborted", message: "The user dismissed this question" },
      }),
      toolPart("tool_patch", "patch", {
        status: "completed",
        input: {
          patchText:
            "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** End Patch",
        },
        content: [{ type: "text", text: "Success" }],
        metadata: {
          files: [
            {
              file: "src/new.ts",
              patch: "@@ -1 +1 @@\n-old\n+new",
              additions: 1,
              deletions: 1,
              status: "modified",
              moved: true,
            },
          ],
        },
      }),
      toolPart("tool_live", "task", {
        status: "running",
        input: { description: "Inspect parser", subagent_type: "general" },
        metadata: { sessionID: liveChild },
      }),
      toolPart("tool_done", "task", {
        status: "completed",
        input: { description: "Summarize parser", subagent_type: "general" },
        content: [{ type: "text", text: "" }],
        metadata: { sessionID: doneChild },
      }),
      toolPart("tool_retry", "task", {
        status: "running",
        input: { description: "Wait for parser", subagent_type: "general" },
        metadata: { sessionID: retryChild },
      }),
    ],
    time: { created: 2, completed: 3 },
  },
]

const liveMessages: SessionMessageInfo[] = [
  { type: "user", id: "live_user", text: "Inspect it", time: { created: 1_000 } },
  {
    type: "assistant",
    id: "live_assistant",
    agent: "general",
    model,
    finish: "tool-calls",
    content: [
      toolPart("live_tool", "read", {
        status: "running",
        input: { filePath: "src/parser.ts" },
        metadata: {},
      }),
    ],
    time: { created: 1_500 },
  },
]

const doneMessages: SessionMessageInfo[] = [
  { type: "user", id: "done_user", text: "Summarize it", time: { created: 1_000 } },
  {
    type: "assistant",
    id: "done_assistant",
    agent: "general",
    model,
    finish: "stop",
    content: [
      toolPart("done_tool_1", "read", {
        status: "completed",
        input: { filePath: "src/parser.ts" },
        content: [{ type: "text", text: "" }],
      }),
      toolPart("done_tool_2", "grep", {
        status: "completed",
        input: { pattern: "parse" },
        content: [{ type: "text", text: "" }],
      }),
    ],
    time: { created: 2_000, completed: 6_000 },
  },
]

const retryMessages: SessionMessageInfo[] = [
  { type: "user", id: "retry_user", text: "Wait", time: { created: 1_000 } },
  {
    type: "assistant",
    id: "retry_assistant",
    agent: "general",
    model,
    finish: "error",
    content: [],
    retry: { attempt: 2, at: Date.now() + 60_000, error: { type: "api", message: "rate limited" } },
    time: { created: 2_000 },
  },
]

const sessions = [
  {
    id: "ses_parity",
    title: "Tool parity",
    projectID: "proj_test",
    location: { directory },
    agent: "build",
    model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 10 },
  },
  ...[liveChild, doneChild, retryChild].map((id) => ({
    id,
    title: "Child",
    projectID: "proj_test",
    parentID: "ses_parity",
    location: { directory },
    agent: "general",
    model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 10 },
  })),
]

const childMessages: Record<string, SessionMessageInfo[]> = {
  [liveChild]: liveMessages,
  [doneChild]: doneMessages,
  [retryChild]: retryMessages,
}

test("shows dismissed questions, moved patches, and the live subagent line", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 120, height: 50, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()

  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: sessions, cursor: {} })
    if (url.pathname === "/api/session/active")
      return json({ data: { [liveChild]: { type: "running" }, [retryChild]: { type: "running" } } })
    const session = sessions.find((item) => url.pathname === `/api/session/${item.id}`)
    if (session) return json({ data: session })
    const messages = parentMessagesMatch(url.pathname) ?? childMessagesMatch(url.pathname)
    if (messages) return json({ data: messages.toReversed(), cursor: {} })
    if (/^\/api\/session\/[^/]+\/inbox$/.test(url.pathname)) return json({ data: [] })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })

  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: "ses_parity" },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )

  try {
    const wait = { maxPasses: 200 }
    await setup.waitForFrame(
      (frame) =>
        frame.includes("1 dismissed") &&
        frame.includes("src/new.ts") &&
        frame.includes("Inspect parser") &&
        frame.includes("Summarize parser") &&
        frame.includes("rate limited"),
      wait,
    )
    await setup.waitForVisualIdle()

    const lines = setup.captureCharFrame().split("\n")
    const find = (text: string) => lines.find((line) => line.includes(text)) ?? ""

    expect(find("1 dismissed")).toContain("1 dismissed")
    expect(find("src/new.ts")).toContain("src/old.ts → src/new.ts")
    expect(find("Inspect parser")).toContain("General Subagent — Inspect parser")
    expect(find("src/parser.ts")).toContain("↳ Read [filePath=src/parser.ts]")
    expect(find("Summarize parser")).toContain("General Subagent — Summarize parser")
    expect(lines.some((line) => line.includes("2 toolcalls · 5.0s"))).toBeTrue()
    expect(lines.some((line) => line.includes("Retrying (attempt 2) · rate limited"))).toBeTrue()

    const dismissedRow = lines.findIndex((line) => line.includes("1 dismissed"))
    await setup.mockMouse.click(6, dismissedRow)
    await setup.waitForFrame((frame) => frame.includes("# Questions (dismissed)") && frame.includes("Dismissed"), wait)
    await setup.waitForVisualIdle()
    expect(setup.captureCharFrame()).toContain("# Questions (dismissed)")
    expect(setup.captureCharFrame()).toContain("Dismissed")
    expect(setup.captureCharFrame()).not.toContain("The user dismissed this question")
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
}, 30_000)

test("parsePatchMoves pairs the source and target of each rename", () => {
  expect(
    parsePatchMoves(
      [
        "*** Begin Patch",
        "*** Update File: src/old.ts",
        "*** Move to: src/new.ts",
        "@@",
        "-old",
        "+new",
        "*** Add File: src/added.ts",
        "*** End Patch",
      ].join("\n"),
    ),
  ).toEqual([{ path: "src/old.ts", movePath: "src/new.ts" }])
  expect(parsePatchMoves(undefined)).toEqual([])
})

test("parseApplyPatchEntries pairs a real move after a self-move", () => {
  const files = [
    { file: "same.txt", patch: "diff", additions: 1, deletions: 1, status: "modified" },
    { file: "moved.txt", patch: "diff", additions: 1, deletions: 1, status: "modified", moved: true },
  ]
  const patchText = [
    "*** Begin Patch",
    "*** Update File: same.txt",
    "*** Move to: ./same.txt",
    "@@",
    "-before",
    "+after",
    "*** Update File: old.txt",
    "*** Move to: moved.txt",
    "@@",
    "-a",
    "+b",
    "*** End Patch",
  ].join("\n")
  const entries = parseApplyPatchEntries(files, patchText)
  expect(entries.map((file) => [file.relativePath, file.moved, file.movedFrom])).toEqual([
    ["same.txt", false, undefined],
    ["moved.txt", true, "old.txt"],
  ])
})

test("patch labels a moved file with both paths", () => {
  const format = (value?: string) => value ?? ""
  const moved = { type: "update", relativePath: "src/new.ts", moved: true, movedFrom: "src/old.ts" }
  expect(applyPatchLabel(moved)).toBe("# Moved")
  expect(applyPatchValue(moved, format)).toBe("src/old.ts → src/new.ts")
  expect(applyPatchLabel({ type: "update", relativePath: "src/new.ts" })).toBe("← Patched")
  expect(applyPatchValue({ type: "update", relativePath: "src/new.ts" }, format)).toBe("src/new.ts")
  expect(applyPatchLabel({ type: "delete", relativePath: "src/old.ts" })).toBe("# Deleted")
})

test("subagentDetail derives the current tool, tool count, retry, and duration", () => {
  const live = subagentDetail(liveMessages)
  expect(live.tools).toHaveLength(1)
  expect(live.retry).toBeUndefined()
  expect(live.current && subagentToolLabel(live.current)).toBe("Read [filePath=src/parser.ts]")

  const done = subagentDetail(doneMessages)
  expect(done.tools).toHaveLength(2)
  expect(done.duration).toBe(5_000)
  expect(formatCompletedSubagentDetail(done.tools.length, "5.0s")).toBe("2 toolcalls · 5.0s")
  expect(formatCompletedSubagentDetail(0, "5.0s")).toBe("5.0s")

  const retry = subagentDetail(retryMessages)
  expect(retry.retry?.attempt).toBe(2)
  expect(retry.retry?.error.message).toBe("rate limited")
  expect(formatSubagentRetry(2, "\u001b[31mrate limited\u001b[0m")).toBe("Retrying (attempt 2) · rate limited")
})

test("subagentDetail treats a streaming tool as current and omits an unknown duration", () => {
  const streaming = subagentDetail([
    {
      type: "assistant",
      id: "streaming_assistant",
      agent: "general",
      model,
      finish: "tool-calls",
      content: [toolPart("streaming_tool", "write", { status: "streaming", input: '{"path":"a.ts"' })],
      time: { created: 2_000 },
    },
  ])
  expect(streaming.current?.state.status).toBe("streaming")
  expect(streaming.current && subagentToolLabel(streaming.current)).toBe("Write")
  expect(streaming.duration).toBeUndefined()
  expect(subagentDetail([doneMessages[1]!]).duration).toBeUndefined()
})

test("subagentToolLabel keeps large tool inputs out of the row", () => {
  const part = toolPart("write_tool", "write", {
    status: "running",
    input: { path: "src/a.ts", content: "x".repeat(5_000) },
    metadata: {},
  })
  expect(subagentToolLabel(part)).toBe("Write [path=src/a.ts]")
})

function parentMessagesMatch(pathname: string) {
  return pathname === "/api/session/ses_parity/message" ? parentMessages : undefined
}

function childMessagesMatch(pathname: string) {
  const match = pathname.match(/^\/api\/session\/([^/]+)\/message$/)
  return match ? childMessages[match[1]] : undefined
}