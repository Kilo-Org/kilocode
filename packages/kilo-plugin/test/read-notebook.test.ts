import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { Environment } from "@opencode/core/environment/index"
import { AbsolutePath } from "@opencode/core/schema"
import { ReadTool } from "@opencode/core/tool/plugin/read"
import { hostEnvironmentLayer } from "../../core/test/fixture/environment"
import { withTempDir } from "../../core/test/fixture/tmpdir"
import { testEffect } from "../../core/test/lib/effect"
import { read } from "../src/read"

const it = testEffect(hostEnvironmentLayer)

const run = (file: string, page: { limit?: number; offset?: number } = {}) =>
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const value = yield* read(environment.files, AbsolutePath.make(file), path.basename(file), page)
    return {
      value,
      output: ReadTool.toModelContent(path.basename(file), undefined, value),
      text: value.type === "text-page" ? value : undefined,
    }
  })

const put = (file: string, content: string) => Effect.promise(() => Bun.write(file, content))

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

const text = (value: { text: { content: string } | undefined }) => {
  if (!value.text) throw new Error("expected a text page")
  return value.text.content
}

describe("kilo notebook reads", () => {
  it.live("extracts markdown and code cells without notebook payloads", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "analysis.ipynb")
        yield* put(filepath, notebook)

        const result = yield* run(filepath)
        const content = text(result)

        expect(content).toContain("<markdown_cell>")
        expect(content).toContain("# Analysis")
        expect(content).toContain("<code_cell>")
        expect(content).toContain("value = 42")
        expect(content.indexOf("# Analysis")).toBeLessThan(content.indexOf("value = 42"))
        expect(content).not.toContain("ignore-output-payload")
        expect(content).not.toContain("ignore-notebook-metadata")
        expect(content).not.toContain("ignore-cell-metadata")
        expect(content).not.toContain("ignore raw cell")
      }),
    ),
  )

  it.live("skips invalid cells without exposing raw notebook payloads", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "partial.ipynb")
        yield* put(
          filepath,
          JSON.stringify({
            cells: [
              null,
              { cell_type: "code", source: null, outputs: ["INVALID_OUTPUT_SHOULD_NOT_APPEAR"] },
              {
                cell_type: "markdown",
                source: ["Readable cell"],
                metadata: { marker: "CELL_METADATA_SHOULD_NOT_APPEAR" },
              },
            ],
          }),
        )

        const content = text(yield* run(filepath))

        expect(content).toContain("Readable cell")
        expect(content).not.toContain("INVALID_OUTPUT_SHOULD_NOT_APPEAR")
        expect(content).not.toContain("CELL_METADATA_SHOULD_NOT_APPEAR")
      }),
    ),
  )

  it.live("reports valid notebooks with no readable cells without exposing payloads", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "empty-content.ipynb")
        yield* put(
          filepath,
          JSON.stringify({
            metadata: { marker: "NOTEBOOK_METADATA_SHOULD_NOT_APPEAR" },
            cells: [
              null,
              { cell_type: "raw", source: ["RAW_CONTENT_SHOULD_NOT_APPEAR"] },
              { cell_type: "code", source: null, outputs: ["INVALID_OUTPUT_SHOULD_NOT_APPEAR"] },
            ],
          }),
        )

        const content = text(yield* run(filepath))

        expect(content).toContain("Notebook contains no markdown or code cell content")
        expect(content).not.toContain("NOTEBOOK_METADATA_SHOULD_NOT_APPEAR")
        expect(content).not.toContain("RAW_CONTENT_SHOULD_NOT_APPEAR")
        expect(content).not.toContain("INVALID_OUTPUT_SHOULD_NOT_APPEAR")
      }),
    ),
  )

  it.live("applies read pagination to extracted cell text", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "paged.ipynb")
        yield* put(filepath, notebook)

        const result = yield* run(filepath, { offset: 2, limit: 2 })

        expect(result.text?.content).toBe("# Analysis\nUseful introduction")
        expect(result.text?.truncated).toBe(true)
        expect(result.output).toContain("2: # Analysis")
        expect(result.output).toContain("3: Useful introduction")
        expect(result.output).not.toContain("value = 42")
      }),
    ),
  )

  it.live("falls back to raw text for malformed notebooks", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "broken.ipynb")
        const content = '{"cells":[{"cell_type":"markdown","source":["unfinished"]}'
        yield* put(filepath, content)

        const result = yield* run(filepath)

        expect(text(result)).toContain(content)
        expect(text(result)).not.toContain("<markdown_cell>")
      }),
    ),
  )

  it.live("keeps ordinary text reads unchanged", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "notes.txt")
        yield* put(filepath, "plain text")

        const result = yield* run(filepath)

        expect(result.output).toContain("1: plain text")
        expect(result.output).not.toContain("<markdown_cell>")
      }),
    ),
  )

  it.live("keeps PDF files as native attachments", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const filepath = path.join(tmp.path, "document.pdf")
        yield* put(filepath, "%PDF-1.4\nminimal content")

        const result = yield* run(filepath)

        expect(result.value.type).toBe("file")
        if (result.value.type === "file") {
          expect(result.value.mime).toBe("application/pdf")
          expect(result.value.encoding).toBe("base64")
        }
      }),
    ),
  )
})
