import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { LinearTracker } from "@/devilcode/symphony/tracker/linear"
import { TrackerIssue, BlockerRef } from "@/devilcode/symphony/tracker/types"
import { SymphonyTrackerError } from "@/devilcode/symphony/errors"

// ---------------------------------------------------------------------------
// fetch mock harness (matches project convention from registry/http-client.test.ts)
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockFetch(impl: (...args: any[]) => Promise<Response>): void {
  globalThis.fetch = impl as typeof globalThis.fetch
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLinearIssueNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "PROJ-1",
    title: "Implement feature",
    description: "Detailed description",
    priority: 2,
    state: { name: "In Progress" },
    branchName: "feat/proj-1",
    url: "https://linear.app/team/issue/PROJ-1",
    labels: { nodes: [{ name: "Frontend" }, { name: "Bug" }] },
    relations: {
      nodes: [
        {
          type: "blocks",
          relatedIssue: {
            id: "blocker-1",
            identifier: "PROJ-0",
            state: { name: "Done" },
          },
        },
      ],
    },
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-16T12:00:00.000Z",
    ...overrides,
  }
}

function issuesResponse(
  nodes: unknown[],
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return {
    data: {
      issues: {
        nodes,
        pageInfo: { hasNextPage, endCursor },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Schema validation — TrackerIssue
// ---------------------------------------------------------------------------

describe("TrackerIssue schema", () => {
  it("parses valid issue data", () => {
    const input = {
      id: "abc-123",
      identifier: "PROJ-42",
      title: "Fix login page",
      description: "The login page crashes on mobile",
      priority: 1,
      state: "Todo",
      branchName: "fix/login-crash",
      url: "https://linear.app/team/issue/PROJ-42",
      labels: ["bug", "urgent"],
      blockedBy: [{ id: "dep-1", identifier: "PROJ-40", state: "In Progress" }],
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    }

    const result = TrackerIssue.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe("abc-123")
      expect(result.data.labels).toEqual(["bug", "urgent"])
      expect(result.data.blockedBy).toHaveLength(1)
    }
  })

  it("accepts null for nullable fields", () => {
    const input = {
      id: "abc-123",
      identifier: "PROJ-42",
      title: "Fix login page",
      description: null,
      priority: null,
      state: "Todo",
      branchName: null,
      url: "https://linear.app/team/issue/PROJ-42",
      labels: [],
      blockedBy: [],
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    }

    const result = TrackerIssue.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBeNull()
      expect(result.data.priority).toBeNull()
      expect(result.data.branchName).toBeNull()
    }
  })

  it("rejects missing required fields", () => {
    const incomplete = {
      id: "abc-123",
      // missing identifier, title, state, url, labels, blockedBy, createdAt, updatedAt
    }

    const result = TrackerIssue.safeParse(incomplete)
    expect(result.success).toBe(false)
  })

  it("rejects wrong type for labels (expects string array)", () => {
    const input = {
      id: "abc-123",
      identifier: "PROJ-42",
      title: "Fix login page",
      description: null,
      priority: null,
      state: "Todo",
      branchName: null,
      url: "https://linear.app/team/issue/PROJ-42",
      labels: "not-an-array",
      blockedBy: [],
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    }

    const result = TrackerIssue.safeParse(input)
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Schema validation — BlockerRef
// ---------------------------------------------------------------------------

describe("BlockerRef schema", () => {
  it("parses valid blocker reference data", () => {
    const input = { id: "blocker-1", identifier: "PROJ-10", state: "Done" }
    const result = BlockerRef.safeParse(input)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe("blocker-1")
      expect(result.data.identifier).toBe("PROJ-10")
      expect(result.data.state).toBe("Done")
    }
  })

  it("rejects missing id field", () => {
    const result = BlockerRef.safeParse({ identifier: "PROJ-10", state: "Done" })
    expect(result.success).toBe(false)
  })

  it("rejects missing identifier field", () => {
    const result = BlockerRef.safeParse({ id: "blocker-1", state: "Done" })
    expect(result.success).toBe(false)
  })

  it("rejects missing state field", () => {
    const result = BlockerRef.safeParse({ id: "blocker-1", identifier: "PROJ-10" })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LinearTracker — constructor
// ---------------------------------------------------------------------------

describe("LinearTracker constructor", () => {
  it("stores endpoint and apiKey (accessible via fetch behavior)", async () => {
    const endpoint = "https://api.linear.app/graphql"
    const apiKey = "lin_api_test123"
    const tracker = new LinearTracker(endpoint, apiKey)

    let capturedUrl: string | undefined
    let capturedHeaders: Record<string, string> | undefined

    mockFetch(async (url, opts) => {
      capturedUrl = url as string
      capturedHeaders = (opts?.headers ?? {}) as Record<string, string>
      return new Response(
        JSON.stringify(issuesResponse([])),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    })

    await tracker.fetchCandidates(["Todo"], "my-project")

    expect(capturedUrl).toBe(endpoint)
    expect(capturedHeaders!["Authorization"]).toBe(apiKey)
  })
})

// ---------------------------------------------------------------------------
// LinearTracker.fetchCandidates
// ---------------------------------------------------------------------------

describe("LinearTracker.fetchCandidates", () => {
  const endpoint = "https://api.linear.app/graphql"
  const apiKey = "lin_api_abc"

  it("makes GraphQL request with correct auth header and query shape", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)
    let capturedBody: { query: string; variables: Record<string, unknown> } | undefined
    let capturedHeaders: Record<string, string> | undefined

    mockFetch(async (_url, opts) => {
      capturedHeaders = (opts?.headers ?? {}) as Record<string, string>
      capturedBody = JSON.parse(opts?.body as string)
      return new Response(
        JSON.stringify(issuesResponse([makeLinearIssueNode()])),
        { status: 200 },
      )
    })

    const issues = await tracker.fetchCandidates(["In Progress", "Todo"], "my-proj")

    // Auth header
    expect(capturedHeaders!["Authorization"]).toBe(apiKey)
    expect(capturedHeaders!["Content-Type"]).toBe("application/json")

    // Body shape
    expect(capturedBody).toBeDefined()
    expect(capturedBody!.query).toContain("issues")
    expect(capturedBody!.variables.projectSlug).toBe("my-proj")
    expect(capturedBody!.variables.states).toEqual(["In Progress", "Todo"])
    expect(capturedBody!.variables.first).toBe(50)
    expect(capturedBody!.variables.after).toBeUndefined()

    // Normalized result
    expect(issues).toHaveLength(1)
    expect(issues[0].identifier).toBe("PROJ-1")
    expect(issues[0].state).toBe("In Progress")
    expect(issues[0].labels).toEqual(["frontend", "bug"])
    expect(issues[0].blockedBy).toHaveLength(1)
    expect(issues[0].blockedBy[0].identifier).toBe("PROJ-0")
  })

  it("handles pagination correctly (fetches multiple pages)", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    const page1Node = makeLinearIssueNode({ id: "issue-1", identifier: "PROJ-1" })
    const page2Node = makeLinearIssueNode({ id: "issue-2", identifier: "PROJ-2" })

    let callCount = 0
    mockFetch(async (_url, opts) => {
      callCount++
      const body = JSON.parse(opts?.body as string)

      if (callCount === 1) {
        // First page: has next page
        expect(body.variables.after).toBeUndefined()
        return new Response(
          JSON.stringify(issuesResponse([page1Node], true, "cursor-1")),
          { status: 200 },
        )
      }

      // Second page: no more pages
      expect(body.variables.after).toBe("cursor-1")
      return new Response(
        JSON.stringify(issuesResponse([page2Node], false, null)),
        { status: 200 },
      )
    })

    const issues = await tracker.fetchCandidates(["Todo"], "my-proj")

    expect(callCount).toBe(2)
    expect(issues).toHaveLength(2)
    expect(issues[0].identifier).toBe("PROJ-1")
    expect(issues[1].identifier).toBe("PROJ-2")
  })

  it("returns empty array when no issues match", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () =>
      new Response(JSON.stringify(issuesResponse([])), { status: 200 }),
    )

    const issues = await tracker.fetchCandidates(["Backlog"], "my-proj")
    expect(issues).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// LinearTracker.fetchIssueStates
// ---------------------------------------------------------------------------

describe("LinearTracker.fetchIssueStates", () => {
  const endpoint = "https://api.linear.app/graphql"
  const apiKey = "lin_api_xyz"

  it("returns a Map<string, string> mapping id to state name", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () =>
      new Response(
        JSON.stringify({
          data: {
            nodes: [
              { id: "id-1", state: { name: "In Progress" } },
              { id: "id-2", state: { name: "Done" } },
            ],
          },
        }),
        { status: 200 },
      ),
    )

    const result = await tracker.fetchIssueStates(["id-1", "id-2"])

    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(2)
    expect(result.get("id-1")).toBe("In Progress")
    expect(result.get("id-2")).toBe("Done")
  })

  it("skips null nodes in the response", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () =>
      new Response(
        JSON.stringify({
          data: {
            nodes: [
              { id: "id-1", state: { name: "Todo" } },
              null,
            ],
          },
        }),
        { status: 200 },
      ),
    )

    const result = await tracker.fetchIssueStates(["id-1", "id-missing"])
    expect(result.size).toBe(1)
    expect(result.get("id-1")).toBe("Todo")
    expect(result.has("id-missing")).toBe(false)
  })

  it("returns empty Map for empty input array", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    // Should NOT make a fetch call
    let fetchCalled = false
    mockFetch(async () => {
      fetchCalled = true
      return new Response("{}", { status: 200 })
    })

    const result = await tracker.fetchIssueStates([])
    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
    expect(fetchCalled).toBe(false)
  })

  it("sends issue IDs in the query variables", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)
    let capturedBody: { query: string; variables: Record<string, unknown> } | undefined

    mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string)
      return new Response(
        JSON.stringify({ data: { nodes: [] } }),
        { status: 200 },
      )
    })

    await tracker.fetchIssueStates(["id-a", "id-b"])
    expect(capturedBody!.variables.ids).toEqual(["id-a", "id-b"])
  })
})

// ---------------------------------------------------------------------------
// LinearTracker.fetchTerminalIssues
// ---------------------------------------------------------------------------

describe("LinearTracker.fetchTerminalIssues", () => {
  const endpoint = "https://api.linear.app/graphql"
  const apiKey = "lin_api_term"

  it("filters by terminal states and returns normalized issues", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)
    const doneNode = makeLinearIssueNode({
      id: "done-1",
      identifier: "PROJ-99",
      state: { name: "Done" },
    })

    let capturedBody: { query: string; variables: Record<string, unknown> } | undefined

    mockFetch(async (_url, opts) => {
      capturedBody = JSON.parse(opts?.body as string)
      return new Response(
        JSON.stringify(issuesResponse([doneNode])),
        { status: 200 },
      )
    })

    const issues = await tracker.fetchTerminalIssues(["Done", "Cancelled"], "my-proj")

    expect(capturedBody!.variables.states).toEqual(["Done", "Cancelled"])
    expect(capturedBody!.variables.projectSlug).toBe("my-proj")
    expect(issues).toHaveLength(1)
    expect(issues[0].state).toBe("Done")
    expect(issues[0].identifier).toBe("PROJ-99")
  })

  it("paginates through multiple pages of terminal issues", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)
    let callCount = 0

    mockFetch(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify(
            issuesResponse(
              [makeLinearIssueNode({ id: "t-1", state: { name: "Done" } })],
              true,
              "cursor-t",
            ),
          ),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify(
          issuesResponse(
            [makeLinearIssueNode({ id: "t-2", state: { name: "Cancelled" } })],
            false,
            null,
          ),
        ),
        { status: 200 },
      )
    })

    const issues = await tracker.fetchTerminalIssues(["Done", "Cancelled"], "proj")
    expect(callCount).toBe(2)
    expect(issues).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Error handling — network failures
// ---------------------------------------------------------------------------

describe("LinearTracker error handling", () => {
  const endpoint = "https://api.linear.app/graphql"
  const apiKey = "lin_api_err"

  it("throws SymphonyTrackerError with statusCode on HTTP error response", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () => new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }))

    try {
      await tracker.fetchCandidates(["Todo"], "proj")
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(SymphonyTrackerError)
      const e = err as InstanceType<typeof SymphonyTrackerError>
      expect(e.data.message).toMatch(/Linear API returned 500/)
      expect(e.data.statusCode).toBe(500)
    }
  })

  it("throws SymphonyTrackerError with graphqlErrors on GraphQL error response", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () =>
      new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: "Field 'nonexistent' not found" }],
        }),
        { status: 200 },
      ),
    )

    try {
      await tracker.fetchCandidates(["Todo"], "proj")
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(SymphonyTrackerError)
      const e = err as InstanceType<typeof SymphonyTrackerError>
      expect(e.data.message).toMatch(/Linear GraphQL errors/)
      expect(e.data.graphqlErrors).toBeDefined()
      expect(e.data.graphqlErrors!.length).toBeGreaterThan(0)
    }
  })

  it("throws SymphonyTrackerError on network failure", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () => {
      throw new TypeError("fetch failed")
    })

    try {
      await tracker.fetchCandidates(["Todo"], "proj")
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(SymphonyTrackerError)
      const e = err as InstanceType<typeof SymphonyTrackerError>
      expect(e.data.message).toMatch(/Linear API request failed/)
    }
  })

  it("throws SymphonyTrackerError on abort/timeout", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () => {
      const error = new DOMException("The operation was aborted.", "AbortError")
      Object.defineProperty(error, "name", { value: "AbortError" })
      throw error
    })

    try {
      await tracker.fetchCandidates(["Todo"], "proj")
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(SymphonyTrackerError)
      const e = err as InstanceType<typeof SymphonyTrackerError>
      expect(e.data.message).toMatch(/timed out/)
    }
  })

  it("propagates SymphonyTrackerError on fetchIssueStates HTTP failure", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () => new Response("Forbidden", { status: 403, statusText: "Forbidden" }))

    try {
      await tracker.fetchIssueStates(["id-1"])
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(SymphonyTrackerError)
      const e = err as InstanceType<typeof SymphonyTrackerError>
      expect(e.data.message).toMatch(/Linear API returned 403/)
      expect(e.data.statusCode).toBe(403)
    }
  })

  it("propagates SymphonyTrackerError on fetchTerminalIssues network failure", async () => {
    const tracker = new LinearTracker(endpoint, apiKey)

    mockFetch(async () => {
      throw new Error("ECONNREFUSED")
    })

    try {
      await tracker.fetchTerminalIssues(["Done"], "proj")
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(SymphonyTrackerError)
      const e = err as InstanceType<typeof SymphonyTrackerError>
      expect(e.data.message).toMatch(/Linear API request failed/)
      expect(e.data.message).toMatch(/ECONNREFUSED/)
    }
  })
})
