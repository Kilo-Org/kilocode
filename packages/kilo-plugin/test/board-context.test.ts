import { describe, expect, test } from "bun:test"
import { Message, ToolMessage, ToolResultPart } from "@opencode/ai/effect"
import { Effect } from "effect"
import { BoardContext } from "../src/board/context"
import { BoardNotice } from "../src/board/notice"
import { BoardStore } from "../src/board/store"
import { fixture, run } from "./board/support"

const result = (id: string, value: unknown, resultType?: "text" | "json" | "content" | "error") =>
  ToolResultPart.make({ id, name: "read", result: value, ...(resultType ? { resultType } : {}) })

describe("shared board notifications", () => {
  test("formats only fixed notices, never metadata content", () => {
    expect(BoardNotice.notice(3)).toBe(BoardNotice.text)
    expect(BoardNotice.notice("unavailable")).toBe(BoardNotice.unavailable)
    for (const marker of [0, -1, 1.5, "peer text", undefined, { body: "x" }]) expect(BoardNotice.notice(marker)).toBeUndefined()
  })

  test("records the marker in metadata and leaves the stored content unchanged", () => {
    expect(BoardNotice.attach({ content: "out", metadata: { a: 1 } }, 2)).toEqual({
      content: "out",
      metadata: { a: 1, [BoardNotice.key]: 2 },
    })
    expect(BoardNotice.attach({ content: "out" }, 0)).toEqual({ content: "out" })
  })

  test("appends the notice to flagged tool results of a model request only", () => {
    const messages: Message[] = [
      Message.user("hi"),
      Message.make({ role: "assistant", content: [{ type: "tool-call", id: "call_a", name: "read", input: {} }] }),
      Message.make({
        role: "tool",
        content: [
          result("call_a", "file body", "text"),
          result("call_b", "other", "text"),
          result("call_c", [{ type: "text", text: "x" }], "content"),
          result("call_d", { ok: true }, "json"),
          result("call_e", "boom", "error"),
        ],
      }),
    ]
    const original = messages[2]
    const assistant = messages[1]
    BoardNotice.apply(
      messages,
      new Map<string, BoardNotice.Marker>([
        ["call_a", 4],
        ["call_c", "unavailable"],
        ["call_d", 1],
        ["call_e", 1],
      ]),
    )
    const tool = messages[2] as ToolMessage
    expect(tool).toBeInstanceOf(ToolMessage)
    expect(tool.content.map((part) => part.result)).toEqual([
      { type: "text", value: `file body\n\n${BoardNotice.text}` },
      { type: "text", value: "other" },
      { type: "content", value: [{ type: "text", text: "x" }, { type: "text", text: BoardNotice.unavailable }] },
      { type: "text", value: `{"ok":true}\n\n${BoardNotice.text}` },
      { type: "error", value: "boom" },
    ])
    expect((original as ToolMessage).content[0].result).toEqual({ type: "text", value: "file body" })
    expect(messages[1]).toBe(assistant)
  })

  test("coalesces activity without exposing peer text", async () => {
    const board = fixture()
    const notifier = BoardContext.notifier(board.runtime)
    const notify = (sessionID: string) => run(notifier.notify({ sessionID, tool: "grep", result: { content: "ok" } }))
    await run(
      Effect.forEach(["one", "two", "three"], (body, index) =>
        BoardStore.post(board.runtime, { sessionID: "ses_child", messageID: `msg_${index}`, to: "ALL", type: "INFO", body }),
      ),
    )
    expect(await notify("ses_root")).toBe(3)
    expect(await notify("ses_root")).toBeUndefined()
    // The sender itself is not notified about its own posts.
    expect(await notify("ses_child")).toBeUndefined()
  })

  test("reports a failed check once, then recovers", async () => {
    const board = fixture()
    const notifier = BoardContext.notifier(board.runtime)
    const notify = (sessionID: string) => run(notifier.notify({ sessionID, tool: "grep", result: { content: "ok" } }))
    board.add({ id: "ses_orphan", parentID: "ses_gone" })
    expect(await notify("ses_orphan")).toBe("unavailable")
    expect(await notify("ses_orphan")).toBeUndefined()
    board.add({ id: "ses_orphan", parentID: "ses_root" })
    expect(await notify("ses_orphan")).toBeUndefined()
    board.add({ id: "ses_orphan", parentID: "ses_gone" })
    expect(await notify("ses_orphan")).toBe("unavailable")
  })

  test("a successful board_read consumes what it returned, later activity is noticed", async () => {
    const board = fixture()
    const notifier = BoardContext.notifier(board.runtime)
    const first = await run(
      BoardStore.post(board.runtime, { sessionID: "ses_root", messageID: "msg_a", to: "ses_child", type: "INFO", body: "a" }),
    )
    expect(
      await run(
        notifier.notify({
          sessionID: "ses_child",
          tool: "board_read",
          result: { content: "read", metadata: { truncated: false, cursor: first.id } },
        }),
      ),
    ).toBeUndefined()
    await run(
      BoardStore.post(board.runtime, { sessionID: "ses_root", messageID: "msg_b", to: "ses_child", type: "INFO", body: "b" }),
    )
    expect(await run(notifier.notify({ sessionID: "ses_child", tool: "grep", result: { content: "x" } }))).toBe(2)
  })
})
