import { describe, it, expect } from "bun:test"
import {
  cycleAgent,
  createDraftAgentSeed,
  draftAgentSelection,
  resolvePromptAgent,
  resolveSessionAgent,
} from "../../webview-ui/src/context/session-agent"
import type { Message } from "../../webview-ui/src/types/messages"

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    sessionID: "sess-1",
    role: "user",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  }
}

describe("resolveSessionAgent", () => {
  it("returns the latest valid user agent", () => {
    const result = resolveSessionAgent(
      [
        makeMessage({ id: "1", agent: "plan" }),
        makeMessage({ id: "2", role: "assistant", agent: "ask" }),
        makeMessage({ id: "3", agent: "code" }),
      ],
      new Set(["plan", "code", "ask"]),
    )

    expect(result).toBe("code")
  })

  it("returns the latest assistant agent when it is last", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: "plan" }), makeMessage({ role: "assistant", agent: "code" })],
      new Set(["plan", "code"]),
    )

    expect(result).toBe("code")
  })

  it("ignores unknown agent names on assistant messages", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: "code" }), makeMessage({ role: "assistant", agent: "task" })],
      new Set(["code"]),
    )

    expect(result).toBe("code")
  })

  it("ignores unknown agent names", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: "missing" }), makeMessage({ agent: "code" })],
      new Set(["code"]),
    )

    expect(result).toBe("code")
  })

  it("ignores empty agent values", () => {
    const result = resolveSessionAgent([makeMessage({ agent: "  " })], new Set(["code"]))
    expect(result).toBeUndefined()
  })

  it("returns agent from assistant when no user has agent", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: undefined }), makeMessage({ role: "assistant", agent: "code" })],
      new Set(["code"]),
    )

    expect(result).toBe("code")
  })

  it("returns undefined when no message has a valid agent", () => {
    const result = resolveSessionAgent(
      [makeMessage({ agent: undefined }), makeMessage({ role: "assistant", agent: undefined })],
      new Set(["code"]),
    )

    expect(result).toBeUndefined()
  })
})

describe("cycleAgent", () => {
  const agents = [
    { name: "ask", mode: "primary" },
    { name: "plan", mode: "primary" },
    { name: "task", mode: "subagent" },
    { name: "hidden", mode: "primary", hidden: true },
    { name: "code", mode: "primary" },
  ]

  function cycle(current: string, direction: 1 | -1, scope = "pending-1") {
    const calls: Array<[string, string | undefined]> = []
    const name = cycleAgent({
      agents,
      scope,
      direction,
      selected: (id) => {
        expect(id).toBe(scope)
        return current
      },
      select: (agent, id) => calls.push([agent, id]),
    })
    return { name, calls }
  }

  it("cycles the same pending scope read by the visible selector", () => {
    expect(cycle("ask", 1)).toEqual({ name: "plan", calls: [["plan", "pending-1"]] })
    expect(cycle("ask", -1)).toEqual({ name: "code", calls: [["code", "pending-1"]] })
  })

  it("wraps and starts from the first agent when the selection is unknown", () => {
    expect(cycle("code", 1).name).toBe("ask")
    expect(cycle("missing", 1).name).toBe("ask")
  })

  it("does nothing when there is no alternative", () => {
    const selected: string[] = []
    expect(
      cycleAgent({
        agents: [{ name: "code" }],
        direction: 1,
        selected: () => "code",
        select: (name) => selected.push(name),
      }),
    ).toBeUndefined()
    expect(selected).toEqual([])
  })
})

describe("resolvePromptAgent", () => {
  it("sends Code after an explicit Ask to Code selection", () => {
    expect(
      resolvePromptAgent({
        sessionID: "ses_1",
        selections: { ses_1: "code" },
        pending: "ask",
      }),
    ).toBe("code")
  })

  it("sends an explicit pending Code selection on a new draft", () => {
    expect(resolvePromptAgent({ selections: {}, pending: "code" })).toBe("code")
  })

  it("omits the agent when there is no explicit selection", () => {
    expect(resolvePromptAgent({ sessionID: "ses_1", selections: {}, pending: null })).toBeUndefined()
    expect(resolvePromptAgent({ selections: {}, pending: null })).toBeUndefined()
  })
})

describe("draftAgentSelection", () => {
  it("carries a pending agent into a new draft scope", () => {
    const result = draftAgentSelection({}, "draft-1", "plan")

    expect(result).toBe("plan")
  })

  it("does not overwrite an existing draft agent", () => {
    const result = draftAgentSelection({ "draft-1": "code" }, "draft-1", "plan")

    expect(result).toBeUndefined()
  })

  it("ignores missing pending agents", () => {
    const result = draftAgentSelection({}, "draft-1", null)

    expect(result).toBeUndefined()
  })
})

describe("createDraftAgentSeed", () => {
  it("seeds and prunes abandoned draft agents", () => {
    const selections: Record<string, string> = {}
    const seed = createDraftAgentSeed({
      selections: () => selections,
      pending: () => "plan",
      active: () => false,
      set: (draft, agent) => {
        selections[draft] = agent
      },
      drop: (draft) => {
        delete selections[draft]
      },
    })

    seed.seed("draft-1")
    expect(selections["draft-1"]).toBe("plan")

    seed.prune("draft-1")
    expect(selections["draft-1"]).toBeUndefined()
  })

  it("keeps active drafts available for retry", () => {
    const selections: Record<string, string> = {}
    const seed = createDraftAgentSeed({
      selections: () => selections,
      pending: () => "code",
      active: () => true,
      set: (draft, agent) => {
        selections[draft] = agent
      },
      drop: (draft) => {
        delete selections[draft]
      },
    })

    seed.seed("draft-1")
    seed.prune("draft-1")

    expect(selections["draft-1"]).toBe("code")
  })

  it("promotes drafts without dropping the migrated agent", () => {
    const dropped: string[] = []
    const seed = createDraftAgentSeed({
      selections: () => ({}),
      pending: () => "ask",
      active: () => false,
      set: () => {},
      drop: (draft) => dropped.push(draft),
    })

    seed.seed("draft-1")
    seed.promote("draft-1")
    seed.prune("draft-1")

    expect(dropped).toEqual([])
  })
})
