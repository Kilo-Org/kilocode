import { describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { readDocument } from "../../src/documents/document-reader"

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kilo-document-"))
}

describe("readDocument", () => {
  it("reads text files inside the worktree", () => {
    const root = workspace()
    fs.writeFileSync(path.join(root, "plan.md"), "# Plan\n")

    expect(readDocument(root, "plan.md")).toEqual({ file: "plan.md", kind: "text", content: "# Plan\n" })
  })

  it("rejects paths outside the worktree", () => {
    const root = workspace()
    const outside = path.join(root, "..", "outside.md")
    fs.writeFileSync(outside, "secret")

    expect(readDocument(root, "../outside.md")).toEqual({ error: "Document is outside the worktree." })
  })

  it("rejects binary files", () => {
    const root = workspace()
    fs.writeFileSync(path.join(root, "data.bin"), Buffer.from([1, 0, 2]))

    expect(readDocument(root, "data.bin")).toEqual({ error: "Binary files cannot be previewed." })
  })
})
