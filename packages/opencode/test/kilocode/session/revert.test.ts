// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Bus } from "../../../src/bus"
import { Identifier } from "../../../src/id/id"
import { Instance } from "../../../src/project/instance"
import { Session } from "../../../src/session"
import { MessageV2 } from "../../../src/session/message-v2"
import { SessionPrompt } from "../../../src/session/prompt"
import { SessionRevert } from "../../../src/session/revert"
import { Log } from "../../../src/util/log"
import { tmpdir } from "../../fixture/fixture"

Log.init({ print: false })

const model = {
  providerID: "opencode",
  modelID: "kimi-k2.5-free",
}

function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve(value: T): void }
  result.promise = new Promise((resolve) => {
    result.resolve = resolve
  })
  return result
}

function submit(sid: string, text: string, id = Identifier.ascending("message")) {
  return SessionPrompt.prompt({
    sessionID: sid,
    messageID: id,
    model,
    noReply: true,
    parts: [{ type: "text", text }],
  })
}

async function reply(root: string, sid: string, parent: string, text: string) {
  const msg: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    sessionID: sid,
    parentID: parent,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: model.modelID,
    providerID: model.providerID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  await Session.updateMessage(msg)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID: sid,
    messageID: msg.id,
    type: "text",
    text,
  })
  return msg
}

describe("session revert resubmit", () => {
  test("removes the reverted range before adding a new prompt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const keep = await submit(session.id, "keep")
        const kept = await reply(tmp.path, session.id, keep.info.id, "kept reply")
        const stale = await submit(session.id, "old prompt")
        const dropped = await reply(tmp.path, session.id, stale.info.id, "stale reply")

        await SessionRevert.revert({ sessionID: session.id, messageID: stale.info.id })

        const fresh = await submit(session.id, "new prompt")
        const msgs = await Session.messages({ sessionID: session.id })
        expect(msgs.map((msg) => msg.info.id)).toEqual([keep.info.id, kept.id, fresh.info.id])
        expect(msgs.some((msg) => msg.info.id === stale.info.id)).toBe(false)
        expect(msgs.some((msg) => msg.info.id === dropped.id)).toBe(false)
        expect((await Session.get(session.id)).revert).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })

  test("recreates a resubmission that requests the same id exactly once", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const id = Identifier.ascending("message")
        await submit(session.id, "original", id)
        await SessionRevert.revert({ sessionID: session.id, messageID: id })

        const fresh = await submit(session.id, "edited", id)

        const msgs = await Session.messages({ sessionID: session.id })
        const match = msgs.filter((msg) => msg.info.id === fresh.info.id)
        expect(fresh.info.id).toBe(id)
        expect(match).toHaveLength(1)
        expect(match[0].parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual(["edited"])

        await Session.remove(session.id)
      },
    })
  })

  test("finishes revert events before recreating the user message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const id = Identifier.ascending("message")
        await submit(session.id, "original", id)
        await SessionRevert.revert({ sessionID: session.id, messageID: id })

        const gate = deferred<void>()
        const started = deferred<void>()
        const events: string[] = []
        const removed: string[] = []
        const clear = Bus.subscribe(MessageV2.Event.PartRemoved, async (event) => {
          if (event.properties.sessionID !== session.id) return
          events.push("part-removing")
          started.resolve()
          await gate.promise
          events.push("part-removed")
        })
        const track = Bus.subscribe(MessageV2.Event.Removed, (event) => {
          if (event.properties.sessionID !== session.id) return
          removed.push(event.properties.messageID)
        })
        const cleared = Bus.subscribe(Session.Event.Updated, (event) => {
          if (event.properties.info.id !== session.id || event.properties.info.revert) return
          events.push("revert-cleared")
        })
        const create = Bus.subscribe(MessageV2.Event.Updated, (event) => {
          if (event.properties.info.sessionID !== session.id) return
          events.push("message-created")
        })

        const run = submit(session.id, "edited", id)
        await started.promise
        await Bun.sleep(20)
        const pending = [...events]
        gate.resolve()
        const fresh = await run
        clear()
        track()
        cleared()
        create()

        expect(pending).toEqual(["part-removing"])
        expect(events).toEqual(["part-removing", "part-removed", "revert-cleared", "message-created"])
        expect(removed).not.toContain(fresh.info.id)
        expect((await Session.get(session.id)).revert).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })

  test("adds prompts without a revert and preserves existing messages", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const first = await submit(session.id, "first")
        const removed: string[] = []
        const unsub = Bus.subscribe(MessageV2.Event.Removed, (event) => {
          if (event.properties.sessionID === session.id) removed.push(event.properties.messageID)
        })

        const second = await submit(session.id, "second")
        unsub()

        const msgs = await Session.messages({ sessionID: session.id })
        expect(msgs.map((msg) => msg.info.id)).toEqual([first.info.id, second.info.id])
        expect(removed).toEqual([])

        await Session.remove(session.id)
      },
    })
  })
})
