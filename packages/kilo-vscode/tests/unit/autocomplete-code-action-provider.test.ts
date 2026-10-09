import { describe, expect, it } from "bun:test"
import { AutocompleteCodeActionProvider } from "../../src/services/autocomplete/AutocompleteCodeActionProvider"

const document = { uri: { scheme: "file", fsPath: "/repo/file.ts" } }
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

describe("AutocompleteCodeActionProvider", () => {
  it("generates a suggestion when no next edit is pending", () => {
    const provider = new AutocompleteCodeActionProvider(() => false)
    const actions = provider.provideCodeActions(document as never, range as never, {} as never, {} as never)

    expect(actions?.at(0)?.command?.command).toBe("kilo-code.new.autocomplete.generateSuggestions")
  })

  it("accepts or jumps to a pending next edit", () => {
    const provider = new AutocompleteCodeActionProvider(() => true)
    const actions = provider.provideCodeActions(document as never, range as never, {} as never, {} as never)

    expect(actions?.at(0)?.command?.command).toBe("kilo-code.new.autocomplete.nextEdit.acceptOrJump")
  })
})
