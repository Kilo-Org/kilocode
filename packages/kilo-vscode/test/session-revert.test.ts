import { describe, expect, it } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import type { SessionMessageAssistant, SessionMessageIdle, SessionMessageInfo, SessionMessageUser } from "@opencode/client"
import { build } from "esbuild"
import { createSolidPlugin } from "../script/solid-cache"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import { DiffSourceCatalog } from "../src/diff/sources/catalog"
import { browserPrompt } from "../src/shared/browser-feedback"
import { injectedMetadata } from "../src/shared/injected-prompt"
import { REVERT_ERROR_CODE } from "../src/shared/revert-error"
import { dict as appEn } from "../webview-ui/src/i18n/en"
import { composeReviewPrompt, mergePromptMetadata } from "../webview-ui/src/v2/review-drafts"
import {
  createRevertQueue,
  nextRedoMessageID,
  redoTarget,
  restoredDraft,
  revertedCount,
  revertedUserMessages,
  visibleMessages,
} from "../webview-ui/src/v2/revert"
import { transcriptRows } from "../webview-ui/src/v2/transcript"

const root = path.resolve(import.meta.dir, "..")
const webview = path.join(root, "webview-ui")

const user = (id: string, text = id, extra: Partial<SessionMessageUser> = {}): SessionMessageUser => ({
  id,
  type: "user",
  text,
  time: { created: 1 },
  ...extra,
})

const assistant = (id: string): SessionMessageAssistant => ({
  id,
  type: "assistant",
  agent: "code",
  model: { providerID: "kilo", id: "m" },
  content: [{ type: "text", text: "ok" }],
  finish: "stop",
  time: { created: 2, completed: 3 },
})

const idle = (id: string, error?: boolean): SessionMessageIdle => ({
  id,
  type: "idle",
  outcome: error ? "failed" : "succeeded",
  time: { created: 4 },
  ...(error
    ? {
        error: {
          type: "unknown",
          message: "Provider failed",
        },
      }
    : {}),
})

describe("createRevertQueue", () => {
  it("runs one mutation per session at a time and leaves other sessions free", async () => {
    const queue = createRevertQueue()
    const gate = Promise.withResolvers<string>()
    const applied: string[] = []
    const first = queue.run("ses_a", () => gate.promise, (value) => applied.push(value))
    expect(queue.busy("ses_a")).toBe(true)
    expect(queue.run("ses_a", async () => "second", (value) => applied.push(value))).toBeUndefined()
    expect(queue.busy("ses_b")).toBe(false)
    await queue.run("ses_b", async () => "other", (value) => applied.push(value))
    expect(applied).toEqual(["other"])

    let waited = false
    const send = queue.settled("ses_a").then(() => (waited = true))
    await Promise.resolve()
    expect(waited).toBe(false)
    gate.resolve("first")
    await first
    await send
    expect(applied).toEqual(["other", "first"])
    expect(queue.busy("ses_a")).toBe(false)
  })

  it("drops the restored draft when the session sent while the mutation ran", async () => {
    const queue = createRevertQueue()
    const gate = Promise.withResolvers<string>()
    const applied: string[] = []
    const task = queue.run("ses_a", () => gate.promise, (value) => applied.push(value))
    queue.sent("ses_b")
    queue.sent("ses_a")
    gate.resolve("draft")
    await task
    expect(applied).toEqual([])
    await queue.run("ses_a", async () => "next", (value) => applied.push(value))
    expect(applied).toEqual(["next"])
  })

  it("settles a failed mutation for waiting sends and frees the session", async () => {
    const queue = createRevertQueue()
    const task = queue.run("ses_a", () => Promise.reject(new Error("locked")), () => {})
    await expect(queue.settled("ses_a")).resolves.toBeUndefined()
    await expect(task).rejects.toThrow("locked")
    expect(queue.busy("ses_a")).toBe(false)
  })
})

describe("redoTarget", () => {
  const messages = [user("msg_1"), assistant("msg_2"), user("msg_3"), assistant("msg_4")]

  it("steps to the next user message when the transcript is loaded", () => {
    expect(redoTarget(messages, { messageID: "msg_1" })).toEqual({ next: "msg_3" })
  })

  it("is Redo All only when the loaded transcript has nothing after the boundary", () => {
    expect(redoTarget(messages, { messageID: "msg_3" })).toBe("all")
  })

  it("does nothing while the first page is still loading", () => {
    expect(redoTarget([], { messageID: "msg_3" })).toBeUndefined()
    expect(redoTarget(messages, undefined)).toBeUndefined()
  })
})

describe("revert boundary helpers", () => {
  it("hides messages at or after the staged boundary and tracks redo targets", () => {
    const messages: SessionMessageInfo[] = [
      user("msg_1", "first"),
      assistant("msg_2"),
      idle("msg_3"),
      user("msg_4", "second"),
      assistant("msg_5"),
      idle("msg_6"),
      user("msg_7", "third"),
      assistant("msg_8"),
      idle("msg_9"),
    ]

    expect(visibleMessages(messages, { messageID: "msg_4" }).map((m) => m.id)).toEqual(["msg_1", "msg_2", "msg_3"])
    expect(revertedUserMessages(messages, { messageID: "msg_4" }).map((m) => m.id)).toEqual(["msg_4", "msg_7"])
    expect(revertedCount(messages, { messageID: "msg_4" })).toBe(2)
    expect(nextRedoMessageID(messages, { messageID: "msg_4" })).toBe("msg_7")
    expect(nextRedoMessageID(messages, { messageID: "msg_7" })).toBeUndefined()
  })

  it("falls back to id ordering when the boundary is on an unloaded earlier page", () => {
    const page: SessionMessageInfo[] = [user("msg_5", "second"), assistant("msg_6")]
    expect(visibleMessages(page, { messageID: "msg_2" })).toEqual([])
    expect(revertedCount(page, { messageID: "msg_2" })).toBe(2)
    expect(nextRedoMessageID(page, { messageID: "msg_2" })).toBe("msg_5")
  })
})

describe("restoredDraft", () => {
  it("restores inline and server-stored image attachments alongside file, selection, and terminal chips", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71])
    const selectionPayload = btoa("const x = 1")
    const terminalPayload = btoa("FAIL math.test.ts")
    const message: Parameters<typeof restoredDraft>[0] = {
      text: "Fix this\n\n<!-- kilo-agent-manager source=ses_other -->",
      files: [
        {
          data: btoa("inline-img"),
          mime: "image/png",
          source: { type: "inline" },
          name: "shot.png",
        },
        {
          uri: `media:${"a".repeat(64)}`,
          mime: "image/jpeg",
          source: { type: "inline" },
          name: "stored.jpg",
        },
        {
          data: "",
          mime: "text/plain",
          source: { type: "uri", uri: "file:///repo/src/a%20b.ts" },
          name: "a b.ts",
          description: "src/a b.ts",
        },
        {
          data: selectionPayload,
          mime: "text/plain",
          source: { type: "uri", uri: "file:///repo/src/math.ts" },
          name: "math.ts:3-9",
          description: "src/math.ts, lines 3-9",
        },
        {
          data: terminalPayload,
          mime: "text/plain",
          source: { type: "inline" },
          name: "Terminal output",
          description: "Terminal output",
        },
        {
          data: "",
          mime: "text/plain",
          source: { type: "uri", uri: "file:///repo/README.md" },
          name: "README.md",
          mention: { start: 0, end: 10, text: "@README.md" },
        },
      ],
    }

    const draft = await restoredDraft(message, async () => pngBytes)
    expect(draft.text).toBe("Fix this")
    expect(draft.items.map((item) => [item.kind, item.name])).toEqual([
      ["image", "shot.png"],
      ["image", "stored.jpg"],
      ["file", "a b.ts"],
      ["selection", "math.ts:3-9"],
      ["terminal", "Terminal output"],
    ])
    expect(draft.items[3]).toMatchObject({
      kind: "selection",
      source: "file:///repo/src/math.ts",
      path: "src/math.ts",
      line: 3,
    })
  })

  it("restores review comments and browser references without their formatted prefixes", async () => {
    const comments = [
      {
        id: "c1",
        file: "src/math.ts",
        side: "additions" as const,
        line: 4,
        comment: "Check overflow",
        selectedText: "return a + b",
      },
    ]
    const references = [{ id: "b1", sessionId: "ses_1", selector: "#save", text: "Save" }]
    const browser = browserPrompt("Please update this", references)
    const composed = composeReviewPrompt(comments, browser.text, false)
    const message = user("msg_2", composed.text, {
      metadata: mergePromptMetadata(browser.metadata as Record<string, never>, composed.metadata),
    })

    const draft = await restoredDraft(message)
    expect(draft.text).toBe("Please update this")
    expect(draft.comments).toEqual(comments)
    expect(draft.browsers).toEqual(references)
  })

  it("restores the slash command for injected command prompts and clears non-command injected prompts", async () => {
    const slash = await restoredDraft(
      user("msg_3", "Expanded review instructions\n\nMore lines", {
        metadata: injectedMetadata("/review branch"),
      }),
    )
    expect(slash.text).toBe("/review branch")

    const action = await restoredDraft(
      user("msg_4", "Update worktree from base", {
        metadata: injectedMetadata("Update from base"),
      }),
    )
    expect(action.text).toBe("")
  })
})

describe("transcriptRows answered flag", () => {
  it("marks user rows answered once an assistant step or terminal idle exists, and false while unanswered", () => {
    const rows = transcriptRows([
      user("msg_1", "turn 1"),
      assistant("msg_2"),
      idle("msg_3"),
      user("msg_4", "failed before step"),
      idle("msg_5", true),
      user("msg_6", "just sent"),
    ])
    const users = rows.flatMap((row) => (row.type === "user" ? [[row.message.id, row.answered] as const] : []))
    expect(users).toEqual([
      ["msg_1", true],
      ["msg_4", true],
      ["msg_6", false],
    ])
  })
})

describe("DiffSourceCatalog session scope with staged revert", () => {
  it("limits session diffs to turns before the revert boundary and returns [] when the first turn is reverted", async () => {
    const calls: Array<{ sessionID: string; from?: string; to?: string }> = []
    let revertBoundary: string | undefined = "msg_4"
    const connection = {
      client: async () => ({
        session: {
          get: async () => ({ id: "s1", revert: revertBoundary ? { messageID: revertBoundary } : undefined }),
          diff: async (input: { sessionID: string; from?: string; to?: string }) => {
            calls.push(input)
            return []
          },
        },
        message: {
          list: async (input: { order?: "asc" | "desc" }) => ({
            data:
              input.order === "asc"
                ? [{ id: "msg_1", type: "user" }]
                : [
                    { id: "msg_7", type: "user" },
                    { id: "msg_4", type: "user" },
                    { id: "msg_2", type: "user" },
                    { id: "msg_1", type: "user" },
                  ],
            cursor: {},
          }),
        },
        config: {
          get: async () => [],
        },
      }),
    } as unknown as AgentManagerConnection

    const catalog = new DiffSourceCatalog(connection)
    const source = catalog.build("session:s1", { workspaceRoot: "/repo", sessionId: "s1" })
    await source.fetch()
    expect(calls).toEqual([{ sessionID: "s1", from: "msg_1", to: "msg_2" }])

    revertBoundary = "msg_1"
    const empty = await source.fetch()
    expect(empty.diffs).toEqual([])
    expect(calls).toHaveLength(1)
    catalog.dispose()
  })

  it("walks the transcript once for a staged boundary across repeated fetches", async () => {
    let paged = 0
    const connection = {
      client: async () => ({
        session: {
          get: async () => ({ id: "s1", revert: { messageID: "msg_5" } }),
          diff: async () => [],
        },
        message: {
          list: async (input: { order?: "asc" | "desc"; limit?: number }) => {
            if ((input.limit ?? 0) === 200) paged++
            return {
              data:
                input.order === "asc"
                  ? [{ id: "msg_1", type: "user" }]
                  : [
                      { id: "msg_9", type: "user" },
                      { id: "msg_5", type: "user" },
                      { id: "msg_1", type: "user" },
                    ],
              cursor: {},
            }
          },
        },
        config: { get: async () => [] },
      }),
    } as unknown as AgentManagerConnection

    const catalog = new DiffSourceCatalog(connection)
    const source = catalog.build("session:s1", { workspaceRoot: "/repo", sessionId: "s1" })
    await source.fetch()
    await source.fetch()
    await source.fetch()
    expect(paged).toBe(1)
    catalog.dispose()
  })

  it("ends at the user message before a reverted queued prompt in transcript order", async () => {
    const calls: Array<{ sessionID: string; from?: string; to?: string }> = []
    const connection = {
      client: async () => ({
        session: {
          get: async () => ({ id: "s1", revert: { messageID: "msg_5" } }),
          diff: async (input: { sessionID: string; from?: string; to?: string }) => {
            calls.push(input)
            return []
          },
        },
        message: {
          // msg_5 was queued before msg_8 was sent, and delivered after it.
          list: async (input: { order?: "asc" | "desc" }) => ({
            data:
              input.order === "asc"
                ? [{ id: "msg_1", type: "user" }]
                : [
                    { id: "msg_9", type: "user" },
                    { id: "msg_5", type: "user" },
                    { id: "msg_8", type: "user" },
                    { id: "msg_1", type: "user" },
                  ],
            cursor: {},
          }),
        },
        config: { get: async () => [] },
      }),
    } as unknown as AgentManagerConnection

    const catalog = new DiffSourceCatalog(connection)
    await catalog.build("session:s1", { workspaceRoot: "/repo", sessionId: "s1" }).fetch()
    expect(calls).toEqual([{ sessionID: "s1", from: "msg_1", to: "msg_8" }])
    catalog.dispose()
  })
})

describe("RevertBanner and UserMessage revert rendering", () => {
  it("keeps the shared revert error key in the dictionary", () => {
    expect(Object.keys(appEn)).toContain(REVERT_ERROR_CODE)
  })

  it("renders revert buttons, redo controls, file diffs, and workspace notices", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const result = await build({
      entryPoints: [path.join(root, "test/fixtures/revert-banner-render.tsx")],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      platform: "node",
      logLevel: "silent",
      loader: { ".css": "empty", ".svg": "text" },
      plugins: [
        {
          name: "solid-dedupe",
          setup(ctx) {
            ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
          },
        },
        {
          name: "worker-url",
          setup(ctx) {
            ctx.onResolve({ filter: /\?worker(&url)?$/ }, (args) => ({ path: args.path, namespace: "worker-url" }))
            ctx.onLoad({ filter: /.*/, namespace: "worker-url" }, () => ({ contents: "export default ''" }))
          },
        },
        createSolidPlugin({ root }),
      ],
      target: "es2022",
      write: false,
    })
    const file = path.join(root, `.revert-banner-render-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)
    try {
      const child = Bun.spawnSync([process.execPath, file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
      expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
    } finally {
      unlinkSync(file)
    }
  })
})
