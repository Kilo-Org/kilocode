// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import path from "path"
import { GlobTool } from "../../src/tool/glob"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("tool.glob", () => {
  const ctx = {
    sessionID: SessionID.make("test"),
    messageID: MessageID.make("test"),
    callID: "",
    agent: "code",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }

  test("supports absolute glob patterns outside the project", async () => {
    await using outer = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "one.md"), "one")
        await Bun.write(path.join(dir, "two.md"), "two")
        await Bun.write(path.join(dir, "three.txt"), "three")
      },
    })
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const glob = await GlobTool.init()
        const result = await glob.execute(
          {
            pattern: path.join(outer.path, "*.md"),
          },
          ctx,
        )
        expect(result.output).toContain(path.join(outer.path, "one.md"))
        expect(result.output).toContain(path.join(outer.path, "two.md"))
        expect(result.output).not.toContain(path.join(outer.path, "three.txt"))
      },
    })
  })
})
