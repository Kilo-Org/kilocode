import { describe, expect, it } from "bun:test"
import { AutocompleteCodeActionProvider } from "../../src/services/autocomplete/AutocompleteCodeActionProvider"

const document = { uri: { scheme: "file", fsPath: "/repo/file.ts" } }
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

describe("AutocompleteCodeActionProvider", () => {
  it("generates a suggestion", () => {
    const provider = new AutocompleteCodeActionProvider()
    const actions = provider.provideCodeActions(document as never, range as never, {} as never, {} as never)

    expect(actions?.at(0)?.command?.command).toBe("kilo-code.new.autocomplete.generateSuggestions")
  })
})
