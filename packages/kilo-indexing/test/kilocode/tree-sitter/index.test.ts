import { beforeEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

const mockLoadParsers = mock()

mock.module("../../../src/tree-sitter/languageParser", () => ({
  loadRequiredLanguageParsers: mockLoadParsers,
}))

import { parseSourceCodeDefinitionsForFile } from "../../../src/tree-sitter/index"

describe("parseSourceCodeDefinitionsForFile", () => {
  beforeEach(() => {
    mockLoadParsers.mockReset()
  })

  test("returns undefined for fallback-only extensions without AST definition support", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tree-sitter-index-"))
    const file = join(dir, "build.gradle")
    await Bun.write(
      file,
      `plugins { id("java") }
repositories { mavenCentral() }
dependencies { testImplementation("org.junit.jupiter:junit-jupiter:5.10.2") }
`,
    )

    mockLoadParsers.mockRejectedValue(new Error("Unsupported language: gradle"))

    const result = await parseSourceCodeDefinitionsForFile(file)
    expect(result).toBeUndefined()
  })
})
