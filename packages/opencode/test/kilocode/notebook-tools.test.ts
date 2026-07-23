import { describe, expect, test } from "bun:test"
import { Agent } from "@/agent/agent"
import { Notebook } from "@/kilocode/notebook/service"
import * as KiloAgent from "@/kilocode/agent"
import { NotebookEditTool, NotebookExecuteTool, NotebookReadTool } from "@/kilocode/tool/notebook-host"
import { MessageID, SessionID } from "@/session/schema"
import * as Tool from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { Truncate } from "@/tool/truncate"
import { Effect, Exit, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

const calls: Notebook.Input[] = []
const notebook = Layer.mock(Notebook.Service, {
  request: (input) => {
    calls.push(input)
    if (input.operation === "read")
      return Effect.succeed({
        operation: "read" as const,
        path: input.path,
        requestPath: input.path,
        revision: "content:read",
        cells: [{ index: 0, kind: "code" as const, language: "python", source: "x".repeat(200_000) }],
      })
    if (input.operation === "edit")
      return Effect.succeed({
        operation: "edit" as const,
        path: input.path,
        requestPath: input.path,
        revision: input.edit.action === "create" ? "content:create" : "content:edit",
        index: input.index,
        action: input.edit.action,
      })
    return Effect.succeed({
      operation: "execute" as const,
      path: input.path,
      requestPath: input.path,
      revision: "content:execute",
      index: input.index,
      status: "success" as const,
      outputs: [],
    })
  },
})
const it = testEffect(Layer.mergeAll(notebook, Agent.defaultLayer, Truncate.defaultLayer))

function context(asks: Parameters<Tool.Context["ask"]>[0][]): Tool.Context {
  return {
    sessionID: SessionID.make("ses_notebook_tools"),
    messageID: MessageID.make("msg_notebook_tools"),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: (input) => Effect.sync(() => asks.push(input)),
  }
}

describe("native notebook tools", () => {
  it.instance(
    "uses dedicated permissions and bounded structured output",
    () =>
      Effect.gen(function* () {
        calls.length = 0
        const asks: Parameters<Tool.Context["ask"]>[0][] = []
        const read = yield* NotebookReadTool.pipe(Effect.flatMap(Tool.init))
        const edit = yield* NotebookEditTool.pipe(Effect.flatMap(Tool.init))
        const execute = yield* NotebookExecuteTool.pipe(Effect.flatMap(Tool.init))
        const ctx = context(asks)

        const readResult = yield* read.execute({ path: "analysis.ipynb", include_outputs: true }, ctx)
        const editResult = yield* edit.execute(
          {
            path: "analysis.ipynb",
            expected_revision: "content:read",
            index: 0,
            action: "replace",
            kind: "code",
            language: "python",
            source: "print(42)",
          },
          ctx,
        )
        const executeResult = yield* execute.execute(
          { path: "/workspace/analysis.ipynb", expected_revision: "content:edit", index: 0 },
          ctx,
        )

        expect(asks.map((item) => item.permission)).toEqual([
          "notebook_read",
          "notebook_edit",
          "external_directory",
          "notebook_execute",
        ])
        expect(asks.slice(0, 2).map((item) => item.patterns[0])).toEqual(["analysis.ipynb", "analysis.ipynb"])
        expect(asks[3]?.patterns[0]?.replaceAll("\\", "/")).toMatch(/workspace\/analysis\.ipynb$/)
        expect(calls.map((item) => item.operation)).toEqual(["read", "edit", "execute"])
        expect(calls[1]).toMatchObject({ expectedRevision: "content:read" })
        expect(calls[2]).toMatchObject({ expectedRevision: "content:edit" })
        expect(readResult.output.length).toBeLessThanOrEqual(20_000)
        const rendered = JSON.parse(readResult.output)
        expect(rendered).toMatchObject({ truncated: true, omittedCharacters: expect.any(Number) })
        expect(rendered.preview).toContain('"revision"')
        expect(rendered.preview).not.toContain("requestPath")
        expect(editResult.metadata.revision).toBe("content:edit")
        expect(executeResult.metadata.index).toBe(0)
      }),
    { git: true },
  )

  it.instance(
    "exposes notebook_edit without a top-level schema union",
    () =>
      Effect.gen(function* () {
        const edit = yield* NotebookEditTool.pipe(Effect.flatMap(Tool.init))
        const schema = ToolJsonSchema.fromTool(edit)
        expect(schema.type).toBe("object")
        expect(schema.anyOf).toBeUndefined()
        expect(schema.oneOf).toBeUndefined()
        expect(schema.allOf).toBeUndefined()
      }),
    { git: true },
  )

  it.instance(
    "rejects insert without kind and source before asking for permission",
    () =>
      Effect.gen(function* () {
        const edit = yield* NotebookEditTool.pipe(Effect.flatMap(Tool.init))
        const asks: Parameters<Tool.Context["ask"]>[0][] = []
        const ctx = context(asks)
        const exit = yield* edit
          .execute({ path: "analysis.ipynb", expected_revision: "content:read", index: 0, action: "insert" }, ctx)
          .pipe(Effect.exit)
        expect(exit._tag).toBe("Failure")
        expect(asks).toEqual([])
      }),
    { git: true },
  )

  it.instance(
    "creates a new notebook through notebook_edit without a revision or cell fields",
    () =>
      Effect.gen(function* () {
        calls.length = 0
        const edit = yield* NotebookEditTool.pipe(Effect.flatMap(Tool.init))
        const asks: Parameters<Tool.Context["ask"]>[0][] = []
        const ctx = context(asks)
        const result = yield* edit.execute({ path: "fresh.ipynb", action: "create" }, ctx)

        expect(asks.map((item) => item.permission)).toEqual(["notebook_edit"])
        expect(calls).toEqual([
          expect.objectContaining({
            operation: "edit",
            sessionID: ctx.sessionID,
            path: expect.stringMatching(/fresh\.ipynb$/),
            index: 0,
            edit: { action: "create" },
          }),
        ])
        expect(result.title).toContain("created notebook")
        expect(result.metadata).toMatchObject({
          path: expect.stringMatching(/fresh\.ipynb$/),
          revision: "content:create",
          index: 0,
        })
      }),
    { git: true },
  )

  it.instance(
    "does not send ignored notebooks to the host",
    () =>
      Effect.gen(function* () {
        calls.length = 0
        const test = yield* TestInstance
        const read = yield* NotebookReadTool.pipe(Effect.flatMap(Tool.init))
        const asks: Parameters<Tool.Context["ask"]>[0][] = []
        const filepath = path.join(test.directory, "secret.ipynb")
        yield* Effect.promise(() =>
          Promise.all([
            fs.writeFile(filepath, "KILO_11637_NOTEBOOK_SECRET", "utf-8"),
            fs.writeFile(path.join(test.directory, ".kilocodeignore"), "secret.ipynb\n", "utf-8"),
          ]),
        )

        const exit = yield* read.execute({ path: filepath }, context(asks)).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(asks).toEqual([])
        expect(calls).toEqual([])
      }),
    { git: true },
  )
})

test("uses dedicated VS Code notebook permission defaults only when enabled", () => {
  const prev = process.env.KILO_CLIENT
  try {
    process.env.KILO_CLIENT = "vscode"
    const disabled = KiloAgent.prepare({}).defaultsPatch
    expect(disabled.some((rule) => rule.permission.startsWith("notebook_"))).toBe(false)

    const rules = KiloAgent.prepare({ experimental: { native_notebook_tools: true } }).defaultsPatch
    expect(rules.findLast((rule) => rule.permission === "notebook_read")?.action).toBe("ask")
    expect(rules.findLast((rule) => rule.permission === "notebook_edit")?.action).toBe("ask")
    expect(rules.findLast((rule) => rule.permission === "notebook_execute")?.action).toBe("ask")
  } finally {
    if (prev === undefined) delete process.env.KILO_CLIENT
    if (prev !== undefined) process.env.KILO_CLIENT = prev
  }
})
