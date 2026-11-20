import { describe, expect, it } from "bun:test"
import { selector } from "../../src/services/autocomplete/AutocompleteServiceManager"

describe("autocomplete document selector", () => {
  it("registers classic autocomplete for files and notebook cells", () => {
    expect(selector()).toEqual([{ scheme: "file" }, { scheme: "vscode-notebook-cell" }])
  })
})
