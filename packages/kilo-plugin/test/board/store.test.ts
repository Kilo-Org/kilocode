import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionID } from "@opencode/schema/session-id"
import { BoardStore } from "../../src/board/store"
import { fixture, flip, run } from "./support"

const root = SessionID.make("ses_root")

const post = (
  board: ReturnType<typeof fixture>,
  input: Partial<Parameters<typeof BoardStore.post>[1]> & { messageID: string },
) => BoardStore.post(board.runtime, { sessionID: "ses_root", to: "ALL", type: "INFO", body: "note", ...input })

describe("BoardStore", () => {
  test("observes without creating a board and pages the latest messages in time order", async () => {
    const board = fixture()
    const input = { sessionID: "ses_child", directory: board.directory, limit: 2 }
    expect(await run(BoardStore.observe(board.runtime, input))).toEqual({
      ownerSessionID: root,
      revision: 0,
      messages: [],
      hasMore: false,
    })
    expect(board.storage.entries.size).toBe(0)
    const posts = await run(
      Effect.forEach(Array.from({ length: 5 }, (_, index) => index), (index) =>
        post(board, { messageID: `msg_view_${index}`, body: `${index}` }),
      ),
    )
    const latest = await run(BoardStore.observe(board.runtime, input))
    expect(latest).toEqual({
      ownerSessionID: root,
      revision: 5,
      messages: posts.slice(3),
      hasMore: true,
      cursor: posts[3].id,
    })
    const older = await run(BoardStore.observe(board.runtime, { ...input, before: latest.cursor }))
    expect(older.messages).toEqual(posts.slice(1, 3))
    const first = await run(BoardStore.observe(board.runtime, { ...input, before: older.cursor }))
    expect(first.messages).toEqual(posts.slice(0, 1))
    expect(first.hasMore).toBe(false)
    expect(first.cursor).toBeUndefined()
    expect((await flip(BoardStore.observe(board.runtime, { ...input, directory: "/other" }))).message).toBe(
      "Session is not in the routed directory",
    )
    expect((await flip(BoardStore.observe(board.runtime, { ...input, before: "board_missing" }))).message).toContain(
      "Board cursor is not valid",
    )
    expect((await flip(BoardStore.observe(board.runtime, { ...input, sessionID: "ses_missing" }))).kind).toBe(
      "not_found",
    )
  })

  test("resets visible history without breaking old cursors, replies, retries, or new posts", async () => {
    const board = fixture()
    const input = { sessionID: "ses_root", directory: board.directory }
    const args = { sessionID: "ses_child", messageID: "msg_reset", callID: "first", body: "Before reset" }
    const first = await run(post(board, args))
    board.storage.entries.set("board/ses_root/meta", {
      next_seq: 2,
      cleared_seq: 0,
      message_count: 1000,
      message_bytes: 2 * 1024 * 1024,
    })
    expect((await flip(post(board, { ...args, callID: "full" }))).message).toBe("Board message limit reached")
    expect((await flip(BoardStore.reset(board.runtime, { ...input, sessionID: "ses_child", revision: 1 }))).message).toBe(
      "Only the owning session can reset this board",
    )
    expect((await flip(BoardStore.reset(board.runtime, { ...input, directory: "/other", revision: 1 }))).message).toBe(
      "Session is not in the routed directory",
    )
    expect(await run(BoardStore.reset(board.runtime, { ...input, revision: 1 }))).toEqual({
      ownerSessionID: root,
      revision: 1,
      messages: [],
      hasMore: false,
    })
    expect(await run(BoardStore.activity(board.runtime, { sessionID: "ses_root", after: 0 }))).toEqual({
      cursor: 1,
      message: 0,
    })
    expect(await run(BoardStore.read(board.runtime, { sessionID: "ses_root", since: first.id }))).toMatchObject({
      messages: [],
      cursor: first.id,
    })
    expect(await run(post(board, args))).toEqual(first)
    expect(board.storage.entries.get("board/ses_root/meta")).toEqual({
      next_seq: 2,
      cleared_seq: 1,
      message_count: 0,
      message_bytes: 0,
    })
    const next = await run(post(board, { ...args, callID: "after", body: "After reset", reply_to: first.id }))
    expect((await run(BoardStore.read(board.runtime, { sessionID: "ses_root", since: first.id }))).messages).toEqual([
      next,
    ])
    expect(await run(BoardStore.activity(board.runtime, { sessionID: "ses_root", after: 1 }))).toEqual({
      cursor: 2,
      message: 2,
    })
    expect((await run(BoardStore.observe(board.runtime, { ...input, before: first.id }))).messages).toEqual([])
    const conflict = await flip(BoardStore.reset(board.runtime, { ...input, revision: 1 }))
    expect(conflict._tag).toBe("BoardStore.Conflict")
    expect(conflict.message).toBe("The board changed. Refresh it before clearing messages.")
    expect((await run(BoardStore.observe(board.runtime, input))).messages).toEqual([next])
  })

  test("bounds pages by bytes without skipping older messages", async () => {
    const board = fixture()
    const posts = await run(
      Effect.forEach(Array.from({ length: 10 }, (_, index) => index), (index) =>
        post(board, { messageID: `msg_large_${index}`, body: "x".repeat(3500) }),
      ),
    )
    const input = { sessionID: "ses_root", directory: board.directory, limit: 50 }
    const latest = await run(BoardStore.observe(board.runtime, input))
    expect(latest.hasMore).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(latest))).toBeLessThanOrEqual(32 * 1024)
    const older = await run(BoardStore.observe(board.runtime, { ...input, before: latest.cursor }))
    expect([...older.messages, ...latest.messages]).toEqual(posts)
    expect(older.hasMore).toBe(false)
  })

  test("resolves recipients, replies, labels, and the public format", async () => {
    const board = fixture()
    const first = await run(
      post(board, { messageID: "msg_tool", callID: "call_1", to: "ses_child", body: "Use the new schema" }),
    )
    const second = await run(
      post(board, {
        sessionID: "ses_child",
        messageID: "msg_tool_2",
        callID: "call_2",
        to: "main",
        type: "RESULT",
        body: "Confirmed",
        reply_to: first.id,
      }),
    )
    expect(first).toMatchObject({ from: "main", to: "ses_child", type: "INFO", fromLabel: "Root", toLabel: "Child" })
    expect(second).toMatchObject({ from: "ses_child", to: "main", reply_to: first.id, fromLabel: "Child", toLabel: "Root" })
    expect(BoardStore.format(first)).toBe(
      JSON.stringify({
        id: first.id,
        timestamp: first.timestamp,
        from: "main",
        to: "ses_child",
        type: "INFO",
        body: "Use the new schema",
      }),
    )
    expect((await flip(post(board, { messageID: "msg_reply", reply_to: "board_missing" }))).message).toBe(
      "Reply message is not on this board",
    )
  })

  test("refuses posts to the sending session", async () => {
    const board = fixture()
    expect((await flip(post(board, { messageID: "msg_self_main", to: "main" }))).message).toContain(
      "`main` resolves to the board root, which is your own session",
    )
    expect((await flip(post(board, { sessionID: "ses_child", messageID: "msg_self", to: "ses_child" }))).message).toContain(
      "that session is your own",
    )
    expect((await run(BoardStore.read(board.runtime, { sessionID: "ses_root" }))).messages).toEqual([])
  })

  test("refuses recipients outside the board", async () => {
    const board = fixture()
    board.add({ id: "ses_other", title: "Other root" })
    board.add({ id: "ses_foreign", parentID: "ses_root", directory: "/elsewhere" })
    expect((await flip(post(board, { messageID: "msg_other", to: "ses_other" }))).message).toBe(
      "Board recipient is not a participant in this board: ses_other",
    )
    expect((await flip(post(board, { messageID: "msg_foreign", to: "ses_foreign" }))).message).toContain(
      "crosses a project or worktree boundary",
    )
    expect((await flip(post(board, { messageID: "msg_missing", to: "ses_missing" }))).message).toBe(
      "Session not found: ses_missing",
    )
  })

  test("deduplicates trusted retries after title changes and rejects changed arguments", async () => {
    const board = fixture()
    const args = { sessionID: "ses_child", messageID: "msg_retry", callID: "call_retry", type: "HOLD" as const, body: "Pause" }
    const first = await run(post(board, args))
    board.add({ ...board.sessions.get("ses_child")!, title: "Renamed" })
    const retry = await run(post(board, args))
    expect(BoardStore.format(retry)).toBe(BoardStore.format(first))
    expect(retry.fromLabel).toBe("Renamed")
    expect((await run(BoardStore.read(board.runtime, { sessionID: "ses_root" }))).messages).toEqual([retry])
    expect((await flip(post(board, { ...args, body: "Different" }))).message).toBe(
      "The trusted board tool call was retried with different arguments",
    )
  })

  test("does not report direct messages for another participant as activity", async () => {
    const board = fixture()
    const sent = await run(post(board, { sessionID: "ses_child", messageID: "msg_direct", to: "main" }))
    expect(await run(BoardStore.activity(board.runtime, { sessionID: "ses_root", after: 0 }))).toEqual({
      cursor: 1,
      message: 1,
    })
    expect(await run(BoardStore.activity(board.runtime, { sessionID: "ses_sibling", after: 0 }))).toEqual({
      cursor: 1,
      message: 0,
    })
    expect(await run(BoardStore.activity(board.runtime, { sessionID: "ses_child", after: 0 }))).toEqual({
      cursor: 1,
      message: 0,
    })
    expect((await run(BoardStore.read(board.runtime, { sessionID: "ses_sibling" }))).messages).toContainEqual(sent)
    expect(
      await run(BoardStore.activity(board.runtime, { sessionID: "ses_root", after: 0, read: sent.id })),
    ).toEqual({ cursor: 1, message: 0 })
  })

  test("returns cursors on final and empty pages and recovers a stale cursor", async () => {
    const board = fixture()
    const first = await run(post(board, { messageID: "msg_cursor", body: "cursor" }))
    const final = await run(BoardStore.read(board.runtime, { sessionID: "ses_child", limit: 1 }))
    expect(final).toMatchObject({ messages: [first], cursor: first.id, hasMore: false })
    const empty = await run(BoardStore.read(board.runtime, { sessionID: "ses_child", since: first.id, limit: 1 }))
    expect(empty).toMatchObject({ messages: [], cursor: first.id, hasMore: false })
    const stale = await run(BoardStore.read(board.runtime, { sessionID: "ses_child", since: "board_gone" }))
    expect(stale).toMatchObject({ messages: [first], cursor: first.id, recovered: true })
    expect((await flip(BoardStore.read(board.runtime, { sessionID: "ses_child", limit: 51 }))).message).toBe(
      "Board read limit must be between 1 and 50",
    )
  })

  test("isolates roots", async () => {
    const board = fixture()
    board.add({ id: "ses_other", title: "Other" })
    board.add({ id: "ses_other_child", parentID: "ses_other" })
    const mine = await run(post(board, { messageID: "msg_mine" }))
    const theirs = await run(post(board, { sessionID: "ses_other_child", messageID: "msg_theirs", to: "main" }))
    expect((await run(BoardStore.read(board.runtime, { sessionID: "ses_child" }))).messages).toEqual([mine])
    expect((await run(BoardStore.read(board.runtime, { sessionID: "ses_other" }))).messages).toEqual([theirs])
    expect(
      (await run(BoardStore.read(board.runtime, { sessionID: "ses_child", since: theirs.id }))).recovered,
    ).toBe(true)
  })

  test("lists participants root first, then self, active, and newest, with execution states", async () => {
    const board = fixture()
    board.add({ id: "ses_nested", parentID: "ses_child", title: "Nested", agent: "explore" })
    board.states.set("ses_sibling", { state: "running", updated: 50 })
    board.states.set("ses_nested", { state: "completed", updated: 10 })
    const result = await run(BoardStore.read(board.runtime, { sessionID: "ses_child" }))
    expect(result.agent).toBe("ses_child")
    expect(result.observedAt).toBe(100)
    expect(result.participants).toEqual([
      { id: "main", sessionID: "ses_root", label: "Root", state: "unknown" },
      { id: "ses_child", sessionID: "ses_child", label: "Child", state: "unknown", self: true },
      { id: "ses_sibling", sessionID: "ses_sibling", label: "Sibling", state: "running" },
      { id: "ses_nested", sessionID: "ses_nested", label: "Nested", agent: "explore", state: "completed" },
    ])
  })

  test("reports availability at post time", async () => {
    const board = fixture()
    board.states.set("ses_child", { state: "busy" })
    board.states.set("ses_sibling", { state: "completed" })
    expect(await run(BoardStore.availability(board.runtime, { sessionID: "ses_root", to: "ALL" }))).toEqual({
      observedAt: 100,
      total: 2,
      active: 1,
      inactive: 1,
      unknown: 0,
    })
    expect(await run(BoardStore.availability(board.runtime, { sessionID: "ses_child", to: "main" }))).toEqual({
      observedAt: 100,
      total: 1,
      active: 0,
      inactive: 0,
      unknown: 1,
      recipientState: "unknown",
    })
  })

  test("keeps seq order and limits under concurrent posts", async () => {
    const board = fixture()
    const posts = await run(
      Effect.forEach(
        Array.from({ length: 20 }, (_, index) => index),
        (index) => post(board, { sessionID: index % 2 ? "ses_child" : "ses_sibling", messageID: `msg_${index}` }),
        { concurrency: "unbounded" },
      ),
    )
    const meta = board.storage.entries.get("board/ses_root/meta") as { next_seq: number; message_count: number }
    expect(meta.next_seq).toBe(21)
    expect(meta.message_count).toBe(20)
    const read = await run(BoardStore.read(board.runtime, { sessionID: "ses_root", limit: 50 }))
    expect(new Set(read.messages.map((message) => message.id))).toEqual(new Set(posts.map((message) => message.id)))
  })

  test("rejects oversized formatted messages and excerpts by bytes", async () => {
    const board = fixture()
    expect((await flip(post(board, { messageID: "msg_big", body: "\"".repeat(2100) }))).message).toBe(
      "Formatted board message exceeds 4096 bytes",
    )
    expect(BoardStore.excerpt("é".repeat(10), 12)).toBe("[truncated]")
    expect(BoardStore.excerpt("é".repeat(10), 13)).toBe("é[truncated]")
    expect(BoardStore.excerpt("é".repeat(10), 5)).toBe("[trun")
    expect(BoardStore.excerpt("abcdefghijklmnop", 14)).toBe("abc[truncated]")
    expect(BoardStore.excerpt("short")).toBe("short")
  })

  test("fails closed for missing and cyclic parents", async () => {
    const board = fixture()
    board.add({ id: "ses_orphan", parentID: "ses_gone" })
    board.add({ id: "ses_a", parentID: "ses_b" })
    board.add({ id: "ses_b", parentID: "ses_a" })
    expect((await flip(BoardStore.read(board.runtime, { sessionID: "ses_orphan" }))).message).toBe(
      "Session lineage parent is missing: ses_gone",
    )
    expect((await flip(BoardStore.read(board.runtime, { sessionID: "ses_a" }))).message).toBe(
      "Session lineage is cyclic: ses_a",
    )
  })
})
