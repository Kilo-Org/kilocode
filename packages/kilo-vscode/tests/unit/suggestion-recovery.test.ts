import { describe, expect, it } from "bun:test"
import {
  fetchAndSendPendingSuggestions,
  recoverableSuggestions,
  type RecoverableSuggestion,
  type SuggestionContext,
} from "../../src/kilo-provider/handlers/suggestion"

function pending(id: string, sessionID: string): RecoverableSuggestion {
  return {
    id,
    sessionID,
    text: "Review changes?",
    actions: [{ label: "Start", prompt: "/local-review-uncommitted" }],
  }
}

type Items = Record<string, RecoverableSuggestion[]>

function suggestionClient(itemsPerDir: Items, queries: string[]) {
  return {
    suggestion: {
      list: async (args?: { directory?: string }) => {
        const dir = args?.directory ?? ""
        queries.push(dir)
        return { data: itemsPerDir[dir] ?? [] }
      },
      accept: async () => ({ data: true }),
      dismiss: async () => ({ data: true }),
    },
  }
}

function ctx(opts: { tracked: string[]; dirs?: Map<string, string>; itemsPerDir?: Items }) {
  const messages: unknown[] = []
  const queries: string[] = []
  const sdk = suggestionClient(opts.itemsPerDir ?? {}, queries) as unknown as SuggestionContext["client"]

  const fake: SuggestionContext = {
    client: sdk,
    currentSessionId: undefined,
    trackedSessionIds: new Set(opts.tracked),
    sessionDirectories: opts.dirs ?? new Map(),
    postMessage: (msg) => messages.push(msg),
    getWorkspaceDirectory: () => "/workspace",
  }

  return { fake, messages, queries }
}

describe("recoverableSuggestions", () => {
  it("filters out untracked suggestions and deduplicates by id", () => {
    const seen = new Set<string>()
    const list = [pending("s1", "tracked"), pending("s1", "tracked"), pending("s2", "other")]
    expect(recoverableSuggestions(list, new Set(["tracked"]), seen)).toEqual([pending("s1", "tracked")])
  })
})

describe("fetchAndSendPendingSuggestions", () => {
  it("forwards suggestions from tracked sessions", async () => {
    const dirs = new Map([["s1", "/wt"]])
    const { fake, messages, queries } = ctx({
      tracked: ["s1"],
      dirs,
      itemsPerDir: { "/wt": [pending("sug-1", "s1")] },
    })

    await fetchAndSendPendingSuggestions(fake)

    expect(queries).toContain("/workspace")
    expect(queries).toContain("/wt")
    expect(messages).toEqual([{ type: "suggestionRequest", suggestion: pending("sug-1", "s1") }])
  })

  it("does nothing when client is null", async () => {
    const messages: unknown[] = []
    const fake: SuggestionContext = {
      client: null,
      currentSessionId: undefined,
      trackedSessionIds: new Set(["s1"]),
      sessionDirectories: new Map(),
      postMessage: (msg) => messages.push(msg),
      getWorkspaceDirectory: () => "/workspace",
    }

    await fetchAndSendPendingSuggestions(fake)
    expect(messages).toHaveLength(0)
  })
})
