import { describe, expect, it } from "bun:test"
import { AutocompleteInlineCompletionProvider } from "../src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider"

function createProvider(state = "connected") {
  return new AutocompleteInlineCompletionProvider(
    {} as never,
    "kilo/mistralai/codestral-2508",
    { connected: () => state !== "disconnected" } as never,
    () => {},
    () => ({ enableAutoTrigger: true }),
    "/repo",
  )
}

function prompt() {
  return {
    prefix: "",
    suffix: "",
    modelName: "codestral",
    completionOptions: {},
    selectedCompletionInfo: undefined,
  } as never
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("autocomplete FIM abort scope", () => {
  it("does not abort in-flight requests from another scope", async () => {
    const provider = createProvider()
    const signals: AbortSignal[] = []
    const resolvers: Array<() => void> = []
    ;(provider as unknown as { fimPromptBuilder: unknown }).fimPromptBuilder = {
      getFromFIM: async (
        _connection: unknown,
        _model: string,
        _prompt: unknown,
        process: (text: string) => unknown,
        signal: AbortSignal,
      ) => {
        signals.push(signal)
        return new Promise((resolve) => {
          resolvers.push(() => {
            resolve({
              suggestion: process("value"),
              cost: 0,
              inputTokens: 0,
              outputTokens: 0,
            })
          })
        })
      },
    }

    const first = provider.fetchAndCacheSuggestion("scope-a", prompt(), "", "", "python")
    await tick()

    const second = provider.fetchAndCacheSuggestion("scope-b", prompt(), "", "", "python")
    await tick()

    expect(signals[0]?.aborted).toBe(false)
    expect(signals[1]?.aborted).toBe(false)

    resolvers.forEach((resolve) => resolve())
    await Promise.all([first, second])
    provider.dispose()
  })

  it("aborts older in-flight requests in the same scope", async () => {
    const provider = createProvider()
    const signals: AbortSignal[] = []
    const resolvers: Array<() => void> = []
    ;(provider as unknown as { fimPromptBuilder: unknown }).fimPromptBuilder = {
      getFromFIM: async (
        _connection: unknown,
        _model: string,
        _prompt: unknown,
        process: (text: string) => unknown,
        signal: AbortSignal,
      ) => {
        signals.push(signal)
        return new Promise((resolve) => {
          resolvers.push(() => {
            resolve({
              suggestion: process("value"),
              cost: 0,
              inputTokens: 0,
              outputTokens: 0,
            })
          })
        })
      },
    }

    const first = provider.fetchAndCacheSuggestion("scope-a", prompt(), "", "", "python")
    await tick()

    const second = provider.fetchAndCacheSuggestion("scope-a", prompt(), "", "", "python")
    await tick()

    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)

    resolvers.forEach((resolve) => resolve())
    await Promise.all([first, second])
    provider.dispose()
  })

  it("does not retain controllers when credentials are invalid", async () => {
    const provider = createProvider("disconnected")
    ;(provider as unknown as { fimPromptBuilder: unknown }).fimPromptBuilder = {
      getFromFIM: () => {
        throw new Error("should not fetch")
      },
    }

    await provider.fetchAndCacheSuggestion("scope-a", prompt(), "", "", "python")

    expect((provider as unknown as { fimAbortControllers: Map<string, AbortController> }).fimAbortControllers.size).toBe(0)
    provider.dispose()
  })
})
