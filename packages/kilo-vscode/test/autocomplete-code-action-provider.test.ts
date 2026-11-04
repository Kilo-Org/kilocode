import { describe, expect, it } from "bun:test"
import { AutocompleteCodeActionProvider } from "../src/services/autocomplete/AutocompleteCodeActionProvider"

const document = { uri: { scheme: "file", fsPath: "/repo/file.ts" } }
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

type Action = { command?: { command?: string } }

describe("AutocompleteCodeActionProvider", () => {
  it("generates a suggestion when no next edit is pending", () => {
    const provider = new AutocompleteCodeActionProvider(() => false)
    const actions = provider.provideCodeActions(document as never, range as never, {} as never, {} as never) as unknown as Action[]

    expect(actions.at(0)?.command?.command).toBe("kilo-code.v2.autocomplete.generateSuggestions")
  })

  it("accepts or jumps to a pending next edit", () => {
    const provider = new AutocompleteCodeActionProvider(() => true)
    const actions = provider.provideCodeActions(document as never, range as never, {} as never, {} as never) as unknown as Action[]

    expect(actions.at(0)?.command?.command).toBe("kilo-code.v2.autocomplete.nextEdit.acceptOrJump")
  })
})
