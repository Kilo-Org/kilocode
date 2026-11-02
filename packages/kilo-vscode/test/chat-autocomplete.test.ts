import { describe, it, expect } from "bun:test"
import type {
  AutocompleteConnection,
  EditResult,
  FimInput,
  FimResult,
} from "../src/services/autocomplete/connection"
import { ChatTextAreaAutocomplete } from "../src/services/autocomplete/chat-autocomplete/ChatTextAreaAutocomplete"

function fakeConnection(overrides: Partial<AutocompleteConnection> = {}) {
  const fimCalls: FimInput[] = []
  const connection: AutocompleteConnection = {
    connected: () => true,
    onStateChange: () => () => {},
    onAuthChange: () => () => {},
    fim: async (input: FimInput): Promise<FimResult> => {
      fimCalls.push(input)
      return { text: "", cost: 0, inputTokens: 0, outputTokens: 0 }
    },
    edit: async (): Promise<EditResult> => ({ content: "" }),
    balance: async () => undefined,
    ...overrides,
  }
  return { connection, fimCalls }
}

describe("ChatTextAreaAutocomplete.getCompletion", () => {
  it("returns an empty suggestion when disconnected, without sending FIM", async () => {
    const { connection, fimCalls } = fakeConnection({ connected: () => false })
    const autocomplete = new ChatTextAreaAutocomplete(connection)

    expect(await autocomplete.getCompletion("hello")).toEqual({ suggestion: "" })
    expect(fimCalls.length).toBe(0)

    autocomplete.dispose()
  })

  it("returns an empty suggestion when the model returns nothing", async () => {
    const { connection, fimCalls } = fakeConnection()
    const autocomplete = new ChatTextAreaAutocomplete(connection)

    expect(await autocomplete.getCompletion("hello")).toEqual({ suggestion: "" })
    expect(fimCalls.length).toBe(1)

    autocomplete.dispose()
  })

  it("returns the cleaned suggestion for a normal completion", async () => {
    const { connection } = fakeConnection({
      fim: async (): Promise<FimResult> => ({ text: "world", cost: 0, inputTokens: 0, outputTokens: 0 }),
    })
    const autocomplete = new ChatTextAreaAutocomplete(connection)

    expect(await autocomplete.getCompletion("Hello")).toEqual({ suggestion: "world" })

    autocomplete.dispose()
  })
})

describe("ChatTextAreaAutocomplete.cleanSuggestion", () => {
  it("drops comment suggestions", () => {
    const { connection } = fakeConnection()
    const autocomplete = new ChatTextAreaAutocomplete(connection)

    expect(autocomplete.cleanSuggestion("// a comment", "Hello", "model")).toBe("")
    expect(autocomplete.cleanSuggestion("# a comment", "Hello", "model")).toBe("")

    autocomplete.dispose()
  })

  it("truncates at the first newline", () => {
    const { connection } = fakeConnection()
    const autocomplete = new ChatTextAreaAutocomplete(connection)

    expect(autocomplete.cleanSuggestion("first line\nsecond line", "Hello", "model")).toBe("first line")

    autocomplete.dispose()
  })
})
