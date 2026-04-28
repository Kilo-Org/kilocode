import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import * as XLSX from "xlsx"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { LSP } from "../../src/lsp"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { Instruction } from "../../src/session/instruction"
import { ReadTool } from "../../src/tool/read"
import { Truncate } from "../../src/tool"
import * as Tool from "../../src/tool/tool"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const root = path.join(import.meta.dir, "..", "..")
const pdf = path.join(root, "node_modules", "pdf-parse", "test", "data", "01-valid.pdf")
const docx = path.join(root, "node_modules", "mammoth", "test", "test-data", "single-paragraph.docx")

const ctx = {
  sessionID: SessionID.make("ses_test-document-read"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

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

const run = (args: Tool.InferParameters<typeof ReadTool>) =>
  Effect.gen(function* () {
    const info = yield* ReadTool
    const tool = yield* info.init()
    return yield* tool.execute(args, ctx)
  })

const exec = (dir: string, args: Tool.InferParameters<typeof ReadTool>) => provideInstance(dir)(run(args))

const put = (filepath: string, content: string | Buffer) =>
  Effect.promise(async () => {
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    await fs.writeFile(filepath, content)
  })

describe("kilocode document read extraction", () => {
  it.live("extracts PDF text locally instead of returning an attachment", () =>
    Effect.gen(function* () {
      const result = yield* exec(root, { filePath: pdf })
      expect(result.output).toContain("Trace-based Just-in-Time Type Specialization")
      expect(result.attachments).toBeUndefined()
    }),
  )

  it.live("extracts DOCX text", () =>
    Effect.gen(function* () {
      const result = yield* exec(root, { filePath: docx })
      expect(result.output).toContain("Walking on imported air")
      expect(result.attachments).toBeUndefined()
    }),
  )

  it.live("extracts notebook markdown and code cells", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "note.ipynb")
      yield* put(
        file,
        JSON.stringify({
          cells: [
            { cell_type: "markdown", source: ["# Title"] },
            { cell_type: "code", source: ["print('kilo')"] },
            { cell_type: "raw", source: ["hidden"] },
          ],
        }),
      )

      const result = yield* exec(dir, { filePath: file })
      expect(result.output).toContain("# Title")
      expect(result.output).toContain("print('kilo')")
      expect(result.output).not.toContain("hidden")
    }),
  )

  it.live("extracts XLSX cell text", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "book.xlsx")
      const book = XLSX.utils.book_new()
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Name", "Score"],
        ["Kilo", 42],
      ])
      XLSX.utils.book_append_sheet(book, sheet, "Results")
      const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
      yield* put(file, bytes)

      const result = yield* exec(dir, { filePath: file })
      expect(result.output).toContain("--- Sheet: Results ---")
      expect(result.output).toContain("Name\tScore")
      expect(result.output).toContain("Kilo\t42")
    }),
  )
})
