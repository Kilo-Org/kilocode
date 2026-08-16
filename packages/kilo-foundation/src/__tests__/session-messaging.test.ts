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
})
