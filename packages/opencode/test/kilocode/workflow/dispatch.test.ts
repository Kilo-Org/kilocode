import { describe, it, expect, mock, beforeEach } from "bun:test"
import { PlanTask, PlanChallenge, ReviewVerdict, ReviewFinding } from "@/devilcode/workflow/types"

// Mock the AI SDK generateObject
const mockGenerateObject = mock((..._args: any[]): any =>
  Promise.resolve({
    object: [],
  }),
)
mock.module("ai", () => ({
  generateObject: mockGenerateObject,
  jsonSchema: (s: any) => s,
}))

// Mock Provider to avoid real provider initialization
const mockGetModel = mock(() =>
  Promise.resolve({
    id: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    api: { id: "claude-sonnet-4-20250514", url: "", npm: "@ai-sdk/anthropic" },
    capabilities: { temperature: true },
    options: {},
  }),
)
const mockGetLanguage = mock(() => Promise.resolve({ languageModel: true }))

mock.module("@/provider/provider", () => ({
  Provider: {
    getModel: mockGetModel,
    getLanguage: mockGetLanguage,
  },
}))

// Import after mocks
const { dispatchPlan, dispatchChallenge, dispatchReview } = await import(
  "@/devilcode/workflow/dispatch"
)

describe("dispatchPlan", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset()
    mockGetModel.mockReset()
    mockGetLanguage.mockReset()
    mockGetModel.mockImplementation(() =>
      Promise.resolve({
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: { id: "claude-sonnet-4-20250514", url: "", npm: "@ai-sdk/anthropic" },
        capabilities: { temperature: true },
        options: {},
      }),
    )
    mockGetLanguage.mockImplementation(() => Promise.resolve({ languageModel: true }))
  })

  it("returns parsed PlanTask array from LLM response", async () => {
    const tasks = [
      {
        id: "task-1",
        title: "Set up database schema",
        role: "worker",
        wave: 1,
        dependsOn: [],
        estimatedComplexity: "medium",
        files: ["src/db/schema.ts"],
        verification: ["bun test test/db/schema.test.ts"],
        description: "Create the database schema for user management",
      },
      {
        id: "task-2",
        title: "Implement auth middleware",
        role: "senior",
        wave: 2,
        dependsOn: ["task-1"],
        estimatedComplexity: "high",
        files: ["src/auth/middleware.ts"],
        verification: ["bun test test/auth/middleware.test.ts"],
        description: "Add JWT-based authentication middleware",
      },
    ]
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: { tasks } }))

    const result = await dispatchPlan({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      phaseContext: "Build a user management system",
      availableRoles: ["orchestrator", "senior", "worker"],
    })

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("task-1")
    expect(result[0].wave).toBe(1)
    expect(result[1].dependsOn).toEqual(["task-1"])
  })

  it("passes phase context as user message content", async () => {
    mockGenerateObject.mockImplementation(() =>
      Promise.resolve({ object: { tasks: [] } }),
    )

    await dispatchPlan({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      phaseContext: "My specific requirements",
      availableRoles: ["senior", "worker"],
    })

    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    const call = mockGenerateObject.mock.calls[0][0]
    const userMsg = call.messages.find((m: any) => m.role === "user")
    expect(userMsg.content).toContain("My specific requirements")
  })

  it("includes available roles in the user message", async () => {
    mockGenerateObject.mockImplementation(() =>
      Promise.resolve({ object: { tasks: [] } }),
    )

    await dispatchPlan({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      phaseContext: "Build X",
      availableRoles: ["architect", "coder", "tester"],
    })

    const call = mockGenerateObject.mock.calls[0][0]
    const userMsg = call.messages.find((m: any) => m.role === "user")
    expect(userMsg.content).toContain("architect")
    expect(userMsg.content).toContain("coder")
    expect(userMsg.content).toContain("tester")
  })
})

describe("dispatchChallenge", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset()
    mockGetModel.mockReset()
    mockGetLanguage.mockReset()
    mockGetModel.mockImplementation(() =>
      Promise.resolve({
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: { id: "claude-sonnet-4-20250514", url: "", npm: "@ai-sdk/anthropic" },
        capabilities: { temperature: true },
        options: {},
      }),
    )
    mockGetLanguage.mockImplementation(() => Promise.resolve({ languageModel: true }))
  })

  it("returns a PlanChallenge from LLM response", async () => {
    const challenge = {
      planId: "phase-1",
      verdict: "approved",
      concerns: [],
      summary: "Plan looks solid",
    }
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: challenge }))

    const result = await dispatchChallenge({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      planTasks: [
        {
          id: "task-1",
          title: "Do thing",
          role: "worker",
          wave: 1,
          dependsOn: [],
          estimatedComplexity: "low",
          files: ["src/thing.ts"],
          verification: ["bun test"],
          description: "Implement the thing",
        },
      ],
      phaseContext: "Build a feature",
    })

    expect(result.verdict).toBe("approved")
    expect(result.concerns).toEqual([])
  })

  it("returns concerns when plan has issues", async () => {
    const challenge = {
      planId: "phase-1",
      verdict: "revise",
      concerns: [
        {
          severity: "critical",
          category: "file-conflict",
          description: "Tasks 1 and 2 in wave 1 both modify src/foo.ts",
          suggestedChange: "Move task-2 to wave 2",
          affectedTasks: ["task-1", "task-2"],
        },
      ],
      summary: "File conflict detected",
    }
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: challenge }))

    const result = await dispatchChallenge({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      planTasks: [],
      phaseContext: "Build a feature",
    })

    expect(result.verdict).toBe("revise")
    expect(result.concerns).toHaveLength(1)
    expect(result.concerns[0].severity).toBe("critical")
  })
})

describe("dispatchReview", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset()
    mockGetModel.mockReset()
    mockGetLanguage.mockReset()
    mockGetModel.mockImplementation(() =>
      Promise.resolve({
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: { id: "claude-sonnet-4-20250514", url: "", npm: "@ai-sdk/anthropic" },
        capabilities: { temperature: true },
        options: {},
      }),
    )
    mockGetLanguage.mockImplementation(() => Promise.resolve({ languageModel: true }))
  })

  it("returns a ReviewVerdict from LLM response", async () => {
    const verdict = {
      verdict: "pass",
      cycle: 1,
      findings: [],
      blockerCount: 0,
      warningCount: 0,
      suggestionCount: 0,
      summary: "All changes look good",
    }
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: verdict }))

    const result = await dispatchReview({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      summaries: ["task-1: Added schema migration"],
      diff: "diff --git a/src/db.ts ...",
      cycle: 1,
    })

    expect(result.verdict).toBe("pass")
    expect(result.cycle).toBe(1)
    expect(result.findings).toEqual([])
  })

  it("returns findings when review finds issues", async () => {
    const verdict = {
      verdict: "fail",
      cycle: 1,
      findings: [
        {
          id: "R-01",
          severity: "blocker",
          category: "security",
          file: "src/auth.ts",
          line: 42,
          description: "Password stored in plaintext",
          suggestedFix: "Use bcrypt to hash passwords",
          suggestedRole: "senior",
          verificationCommand: "bun test test/auth.test.ts",
        },
      ],
      blockerCount: 1,
      warningCount: 0,
      suggestionCount: 0,
      summary: "Security issue found",
    }
    mockGenerateObject.mockImplementation(() => Promise.resolve({ object: verdict }))

    const result = await dispatchReview({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      summaries: ["task-1: Added auth"],
      diff: "diff ...",
      cycle: 1,
    })

    expect(result.verdict).toBe("fail")
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("blocker")
  })
})
