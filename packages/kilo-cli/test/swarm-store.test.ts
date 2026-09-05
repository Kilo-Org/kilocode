import { expect, test } from "bun:test"
import { Effect } from "effect"
import * as Store from "../src/swarm-store"

function storage() {
  const values = new Map<string, unknown>()
  return {
    get: (key: string) => Effect.succeed(values.get(key)),
    set: (key: string, value: unknown) => Effect.sync(() => void values.set(key, value)),
  }
}

const post = (store: ReturnType<typeof storage>, root: string, callID: string, body: string, to = "ALL") =>
  Effect.runPromise(
    Store.post(store, root, {
      callID,
      messageID: `msg-${callID}`,
      from: "child",
      to,
      type: "INFO",
      body,
    }),
  )

test("keeps board history root-scoped, paginated, and idempotent", async () => {
  const store = storage()
  const first = await post(store, "root-a", "call-a", "first")
  await post(store, "root-a", "call-b", "second")
  const again = await post(store, "root-a", "call-a", "first")
  await post(store, "root-b", "call-a", "other")
  expect(again).toEqual(first)
  const firstPage = await Effect.runPromise(Store.read(store, "root-a", { limit: 1 }))
  expect(firstPage.messages).toHaveLength(1)
  expect(firstPage.hasMore).toBe(true)
  const secondPage = await Effect.runPromise(Store.read(store, "root-a", { since: firstPage.cursor, limit: 1 }))
  expect(secondPage.messages.map((message) => message.body)).toEqual(["second"])
  expect((await Effect.runPromise(Store.read(store, "root-b", {}))).messages.map((message) => message.body)).toEqual([
    "other",
  ])
})

test("rejects cross-board cursors, invalid retries, and replies outside its root", async () => {
  const store = storage()
  await post(store, "root-a", "call-a", "first")
  await expect(Effect.runPromise(Store.read(store, "root-b", { since: "board_missing" }))).rejects.toThrow("cursor")
  await expect(post(store, "root-a", "call-a", "changed")).rejects.toThrow("retried")
  await expect(
    Effect.runPromise(
      Store.post(store, "root-b", {
        callID: "call-b",
        messageID: "msg-b",
        from: "child",
        to: "ALL",
        type: "INFO",
        body: "reply",
        replyTo: "board_missing",
      }),
    ),
  ).rejects.toThrow("Reply")
})

test("rejects malformed persisted state and invalid page limits without replacing the record", async () => {
  const values = new Map<string, unknown>([["board:root-a", { version: 1, root: "root-a", messages: [{}] }]])
  const store = {
    get: (key: string) => Effect.succeed(values.get(key)),
    set: (key: string, value: unknown) => Effect.sync(() => void values.set(key, value)),
  }
  await expect(Effect.runPromise(Store.read(store, "root-a", {}))).rejects.toThrow("malformed")
  expect(values.get("board:root-a")).toEqual({ version: 1, root: "root-a", messages: [{}] })
  await expect(Effect.runPromise(Store.read(storage(), "root-a", { limit: 0 }))).rejects.toThrow("between 1 and 50")
  await expect(Effect.runPromise(Store.read(storage(), "root-a", { limit: 51 }))).rejects.toThrow("between 1 and 50")
})
