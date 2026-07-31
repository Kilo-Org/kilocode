//
// Ensure the edit tool always includes `filediff` in its
// permission-ask metadata. Without `filediff`, the VS Code extension's
// PermissionDock cannot render the inline diff preview.

import { afterAll, afterEach, describe, test, expect } from "bun:test"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { EditTool } from "../../src/tool/edit"
import { provideTestInstance } from "../fixture/fixture"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { LSP } from "../../src/lsp/lsp"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Truncate } from "../../src/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    LSP.defaultLayer,
    FSUtil.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    EventV2Bridge.defaultLayer,
  ),
)

afterAll(async () => {
  await runtime.dispose()
})

afterEach(async () => {
  await disposeAllInstances()
})

const resolve = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* EditTool
      return yield* info.init()
    }),
  )

function capture() {
  const requests: Array<{ permission: string; metadata: Record<string, any> }> = []
  const ctx = {
    sessionID: SessionID.make("ses_test-edit-filediff"),
    messageID: MessageID.make("msg_test-edit-filediff"),
    callID: "",
    agent: "code",
    abort: AbortSignal.any([]),
    messages: [] as any[],
    metadata: () => Effect.void,
    ask: (req: any) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  return { requests, ctx }
}

describe("edit tool permission filediff metadata", () => {
  describe("new file creation (empty oldString)", () => {
    test("ctx.ask() includes filediff in metadata", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "new.txt")

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const edit = await resolve()
          const { requests, ctx } = capture()

          await Effect.runPromise(
            edit.execute(
              {
                filePath: filepath,
                oldString: "",
                newString: "hello world\nline two\n",
              },
              ctx,
            ),
          )

          const req = requests.find((r) => r.permission === "edit")
          expect(req).toBeDefined()
          expect(req!.metadata.filediff).toBeDefined()
          expect(req!.metadata.filediff.file).toBe(filepath)
          expect(req!.metadata.filediff.additions).toBeGreaterThan(0)
          expect(req!.metadata.filediff.patch).toContain("+hello world")
        },
      })
    })
  })

  describe("existing file edit (non-empty oldString)", () => {
    test("ctx.ask() includes filediff in metadata", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await Bun.write(filepath, "line one\nline two\nline three\n")

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const edit = await resolve()
          const { requests, ctx } = capture()

          await Effect.runPromise(
            edit.execute(
              {
                filePath: filepath,
                oldString: "line two",
                newString: "replaced line",
              },
              ctx,
            ),
          )

          const req = requests.find((r) => r.permission === "edit")
          expect(req).toBeDefined()
          expect(req!.metadata.filediff).toBeDefined()
          expect(req!.metadata.filediff.file).toBe(filepath)
          expect(req!.metadata.filediff.additions).toBeGreaterThan(0)
          expect(req!.metadata.filediff.deletions).toBeGreaterThan(0)
          expect(req!.metadata.filediff.patch).toContain("+replaced line")
          expect(req!.metadata.filediff.patch).toContain("-line two")
        },
      })
    })

    test("filediff.patch contains valid unified diff", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "diff-check.txt")
      await Bun.write(filepath, "alpha\nbeta\ngamma\n")

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const edit = await resolve()
          const { requests, ctx } = capture()

          await Effect.runPromise(
            edit.execute(
              {
                filePath: filepath,
                oldString: "beta",
                newString: "BETA",
              },
              ctx,
            ),
          )

          const req = requests.find((r) => r.permission === "edit")
          expect(req!.metadata.filediff.patch).toContain("---")
          expect(req!.metadata.filediff.patch).toContain("+++")
          expect(req!.metadata.filediff.patch).toContain("@@")
        },
      })
    })
  })

  describe("result metadata also includes filediff", () => {
    test("new file result includes filediff", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "result-new.txt")

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const edit = await resolve()
          const { ctx } = capture()

          const result = await Effect.runPromise(
            edit.execute(
              {
                filePath: filepath,
                oldString: "",
                newString: "content\n",
              },
              ctx,
            ),
          )

          expect(result.metadata.filediff).toBeDefined()
          expect(result.metadata.filediff.file).toBe(filepath)
        },
      })
    })

    test("existing file result includes filediff", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "result-edit.txt")
      await Bun.write(filepath, "before\n")

      await provideTestInstance({
        directory: tmp.path,
        fn: async () => {
          const edit = await resolve()
          const { ctx } = capture()

          const result = await Effect.runPromise(
            edit.execute(
              {
                filePath: filepath,
                oldString: "before",
                newString: "after",
              },
              ctx,
            ),
          )

          expect(result.metadata.filediff).toBeDefined()
          expect(result.metadata.filediff.file).toBe(filepath)
          expect(result.metadata.filediff.additions).toBeGreaterThan(0)
          expect(result.metadata.filediff.deletions).toBeGreaterThan(0)
        },
      })
    })
  })
})
