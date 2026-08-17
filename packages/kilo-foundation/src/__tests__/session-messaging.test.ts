import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { FileBackedSessionMessenger } from "../session-messaging"

describe("file-backed session messenger", () => {
  test("creates a session and persists a message without polling", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-foundation-inbox-"))
    const messenger = new FileBackedSessionMessenger(root)
    const id = await messenger.createSession("child-1")
    await messenger.sendMessage(id, "hello")
    const probe = await messenger.probe()
    expect(probe.reachable).toBe(true)
    expect(probe.sessionCount).toBe(1)
    expect(await messenger.listSessions()).toEqual([id])
  })

  test("lists and consumes pending envelopes in createdAt order", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-foundation-pending-"))
    let now = 1_700_000_000_000
    const messenger = new FileBackedSessionMessenger(root, { now: () => now++ })
    const id = await messenger.createSession("s1")
    await messenger.sendQueued(id, "first", "/repo")
    await messenger.sendQueued(id, "second", "/repo")
    const listed = await messenger.listPending(id)
    expect(listed.map((item) => item.message)).toEqual(["first", "second"])
    const consumed = await messenger.consumePending(id, 1)
    expect(consumed.map((item) => item.message)).toEqual(["first"])
    expect((await messenger.listPending(id)).map((item) => item.message)).toEqual(["second"])
  })

  test("does not unlink unreadable envelopes and keeps remaining files after a consume", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-foundation-corrupt-"))
    let now = 1_700_000_000_000
    const messenger = new FileBackedSessionMessenger(root, { now: () => now++ })
    const id = await messenger.createSession("s1")
    await messenger.sendQueued(id, "keep", "/repo")
    writeFileSync(path.join(root, id, "0-corrupt.json"), "{not-json", "utf8")
    const listed = await messenger.listPending(id)
    expect(listed.map((item) => item.message)).toEqual(["keep"])
    const consumed = await messenger.consumePending(id, 1)
    expect(consumed.map((item) => item.message)).toEqual(["keep"])
    expect(await messenger.listPending(id)).toEqual([])
  })

  test("persists extra fields on queued envelopes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-foundation-extra-"))
    const messenger = new FileBackedSessionMessenger(root, { now: () => 1_700_000_000_000 })
    const id = await messenger.createSession("s1")
    await messenger.sendQueued(id, "later", "/repo", { messageID: "msg_1", noReply: true })
    const pending = await messenger.listPending(id)
    expect(pending[0]?.extra).toEqual({ messageID: "msg_1", noReply: true })
  })
})
