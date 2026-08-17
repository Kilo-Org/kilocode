import { mkdtempSync } from "node:fs"
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

  test("lists and consumes pending envelopes in order", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kilo-foundation-pending-"))
    const messenger = new FileBackedSessionMessenger(root)
    const id = await messenger.createSession("s1")
    await messenger.sendQueued(id, "first", "/repo")
    await messenger.sendQueued(id, "second", "/repo")
    const listed = await messenger.listPending(id)
    expect(listed.map((item) => item.message)).toEqual(["first", "second"])
    const consumed = await messenger.consumePending(id, 1)
    expect(consumed.map((item) => item.message)).toEqual(["first"])
    expect((await messenger.listPending(id)).map((item) => item.message)).toEqual(["second"])
  })
})
