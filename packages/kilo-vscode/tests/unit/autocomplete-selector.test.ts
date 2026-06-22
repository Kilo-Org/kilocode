import { describe, expect, it } from "bun:test"
import { selector } from "../../src/services/autocomplete/AutocompleteServiceManager"

describe("autocomplete document selector", () => {
  it("registers classic autocomplete for files and notebook cells", () => {
    expect(selector("classic")).toEqual([{ scheme: "file" }, { scheme: "vscode-notebook-cell" }])
  })

  it("keeps Next Edit limited to files", () => {
    expect(selector("next-edit")).toEqual([{ scheme: "file" }])
  })
})
