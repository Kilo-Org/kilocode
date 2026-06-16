import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "../../src/lsp/lsp"
import { Instruction } from "../../src/session/instruction"
import { MessageID, SessionID } from "../../src/session/schema"
import { ReadTool } from "../../src/tool/read"
import * as Tool from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-notebook"),
  messageID: MessageID.make("msg_test-notebook"),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const run = Effect.fn("NotebookReadTest.run")(function* (dir: string, args: Tool.InferParameters<typeof ReadTool>) {
  return yield* provideInstance(dir)(
    Effect.gen(function* () {
      const info = yield* ReadTool
      const tool = yield* Tool.init(info)
      return yield* tool.execute(args, ctx)
    }),
  )
})

const put = Effect.fn("NotebookReadTest.put")(function* (filepath: string, content: string | Uint8Array) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(filepath, content)
})

const notebook = JSON.stringify({
  metadata: { secret: "ignore-notebook-metadata" },
  cells: [
    {
      cell_type: "markdown",
      metadata: { private: "ignore-cell-metadata" },
      source: ["# Analysis\n", "Useful introduction"],
    },
    {
      cell_type: "raw",
      source: ["ignore raw cell"],
    },
    {
      cell_type: "code",
      execution_count: 7,
      metadata: {},
      source: ["value = 42\n", "print(value)"],
      outputs: [{ output_type: "stream", text: ["ignore-output-payload"] }],
    },
  ],
})

describe("kilocode notebook reads", () => {
  it.live("extracts markdown and code cells without notebook payloads", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "analysis.ipynb")
      yield* put(filepath, notebook)

      const result = yield* run(dir, { filePath: filepath })

      expect(result.output).toContain("<markdown_cell>")
      expect(result.output).toContain("# Analysis")
      expect(result.output).toContain("<code_cell>")
      expect(result.output).toContain("value = 42")
      expect(result.output.indexOf("# Analysis")).toBeLessThan(result.output.indexOf("value = 42"))
      expect(result.output).not.toContain("ignore-output-payload")
      expect(result.output).not.toContain("ignore-notebook-metadata")
      expect(result.output).not.toContain("ignore-cell-metadata")
      expect(result.output).not.toContain("ignore raw cell")
    }),
  )

  it.live("skips invalid cells without exposing raw notebook payloads", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "partial.ipynb")
      const content = JSON.stringify({
        cells: [
          null,
          { cell_type: "code", source: null, outputs: ["INVALID_OUTPUT_SHOULD_NOT_APPEAR"] },
          { cell_type: "markdown", source: ["Readable cell"], metadata: { marker: "CELL_METADATA_SHOULD_NOT_APPEAR" } },
        ],
      })
      yield* put(filepath, content)

      const result = yield* run(dir, { filePath: filepath })

      expect(result.output).toContain("Readable cell")
      expect(result.output).not.toContain("INVALID_OUTPUT_SHOULD_NOT_APPEAR")
      expect(result.output).not.toContain("CELL_METADATA_SHOULD_NOT_APPEAR")
    }),
  )

  it.live("reports valid notebooks with no readable cells without exposing payloads", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "empty-content.ipynb")
      const content = JSON.stringify({
        metadata: { marker: "NOTEBOOK_METADATA_SHOULD_NOT_APPEAR" },
        cells: [
          null,
          { cell_type: "raw", source: ["RAW_CONTENT_SHOULD_NOT_APPEAR"] },
          { cell_type: "code", source: null, outputs: ["INVALID_OUTPUT_SHOULD_NOT_APPEAR"] },
        ],
      })
      yield* put(filepath, content)

      const result = yield* run(dir, { filePath: filepath })

      expect(result.output).toContain("Notebook contains no markdown or code cell content")
      expect(result.output).not.toContain("NOTEBOOK_METADATA_SHOULD_NOT_APPEAR")
      expect(result.output).not.toContain("RAW_CONTENT_SHOULD_NOT_APPEAR")
      expect(result.output).not.toContain("INVALID_OUTPUT_SHOULD_NOT_APPEAR")
    }),
  )

  it.live("applies read pagination to extracted cell text", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "paged.ipynb")
      yield* put(filepath, notebook)

      const result = yield* run(dir, { filePath: filepath, offset: 2, limit: 2 })

      expect(result.output).toContain("2: # Analysis")
      expect(result.output).toContain("3: Useful introduction")
      expect(result.output).not.toContain("value = 42")
      expect(result.metadata.preview).toBe("# Analysis\nUseful introduction")
      expect(result.metadata.truncated).toBe(true)
    }),
  )

  it.live("falls back to raw text for malformed notebooks", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "broken.ipynb")
      const content = '{"cells":[{"cell_type":"markdown","source":["unfinished"]}'
      yield* put(filepath, content)

      const result = yield* run(dir, { filePath: filepath })

      expect(result.output).toContain(content)
      expect(result.output).not.toContain("<markdown_cell>")
    }),
  )

  it.live("keeps ordinary text reads unchanged", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "notes.txt")
      yield* put(filepath, "plain text")

      const result = yield* run(dir, { filePath: filepath })

      expect(result.output).toContain("1: plain text")
      expect(result.output).not.toContain("<markdown_cell>")
    }),
  )

  it.live("keeps PDF files as native attachments", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const filepath = path.join(dir, "document.pdf")
      yield* put(filepath, "%PDF-1.4\nminimal content")

      const result = yield* run(dir, { filePath: filepath })

      expect(result.output).toBe("PDF read successfully")
      expect(result.attachments?.[0].mime).toBe("application/pdf")
      expect(result.metadata.truncated).toBe(false)
    }),
  )
})
