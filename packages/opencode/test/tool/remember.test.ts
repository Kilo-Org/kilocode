// kilocode_change - new file
import { afterEach, describe, expect, mock, test } from "bun:test"
import { Memory } from "../../src/kilocode/memory"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { RememberTool } from "../../src/tool/remember"
import type { Tool } from "../../src/tool/tool"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const ask = mock(async () => {})

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask,
}

afterEach(async () => {
  ask.mockClear()
  await resetDatabase()
})

describe("tool.remember", () => {
  test("add stores memory and asks for permission", async () => {
    await using tmp = await tmpdir({ git: true })

    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RememberTool.init()
        return tool.execute({ mode: "add", key: "build", content: "Run bun test from packages/opencode" }, ctx)
      },
    })

    const items = await Instance.provide({
      directory: tmp.path,
      fn: async () => Memory.list(),
    })

    expect(result.title).toBe("Remembered: build")
    expect(items.map((item) => item.key)).toContain("build")
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]?.[0]).toMatchObject({ permission: "remember", metadata: { mode: "add", key: "build" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Memory.remove({ key: "build" })
      },
    })
  })


  test("add surfaces permission rejection", async () => {
    await using tmp = await tmpdir({ git: true })
    const ask = mock(async () => {
      throw new Error("denied")
    })

    const err = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RememberTool.init()
        return tool
          .execute(
            { mode: "add", key: "build", content: "Run bun test from packages/opencode" },
            { ...ctx, ask },
          )
          .catch((error) => error as Error)
      },
    })

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain("denied")
  })

  test("list shows stored memory and forget removes it", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Memory.set({ key: "build", content: "Run bun test from packages/opencode" })
      },
    })

    const listed = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RememberTool.init()
        return tool.execute({ mode: "list" }, ctx)
      },
    })

    expect(listed.output).toContain("build: Run bun test from packages/opencode")
    expect(ask).toHaveBeenCalledTimes(0)

    const forgotten = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await RememberTool.init()
        return tool.execute({ mode: "forget", key: "build" }, ctx)
      },
    })

    const items = await Instance.provide({
      directory: tmp.path,
      fn: async () => Memory.list(),
    })

    expect(forgotten.title).toBe("Forgot: build")
    expect(items).toEqual([])
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls[0]?.[0]).toMatchObject({ permission: "remember", metadata: { mode: "forget", key: "build" } })
  })
})
