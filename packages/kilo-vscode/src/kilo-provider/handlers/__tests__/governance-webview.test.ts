/**
 * Tests for governance-webview.ts (canonical-settings round-trip).
 *
 * Coverage:
 *   1. governance.load returns Hub data when reachable
 *   2. governance.load falls back to defaults when Hub returns 404
 *   3. governance.update POSTs the right payload (key=governance, value=...)
 *   4. governance.update reverts the UI on Hub error
 *   5. ignores non-governance messages
 */

import {
  handleGovernanceRealWebviewMessage,
  loadDefaultGovernanceState,
  type FetchLike,
  type FetchResponseLike,
} from "../governance-webview"

interface FakeCtx {
  posted: unknown[]
  ctx: Parameters<typeof handleGovernanceRealWebviewMessage>[1]
  fetchCalls: Array<{ url: string; init: { method?: string; body?: string; headers?: Record<string, string> } | undefined }>
  setFetch: (impl: FetchLike) => void
}

function makeCtx(hubBaseUrl = "http://hub.test:8095"): FakeCtx {
  const posted: unknown[] = []
  const fetchCalls: FakeCtx["fetchCalls"] = []
  let fetchImpl: FetchLike = async () => {
    throw new Error("fetch impl not set")
  }
  const wrapper: FetchLike = async (url, init) => {
    fetchCalls.push({ url, init })
    return fetchImpl(url, init)
  }
  const extensionContext = {
    secrets: { get: async () => undefined, store: async () => undefined },
  } as unknown as import("vscode").ExtensionContext
  return {
    posted,
    fetchCalls,
    setFetch: (impl) => {
      fetchImpl = impl
    },
    ctx: {
      extensionContext,
      postMessage: (m: unknown) => posted.push(m),
      fetchImpl: wrapper,
      hubBaseUrl,
      // No workspaceFolder → loadDefaultGovernanceState falls through to skeleton.
    },
  }
}

function jsonResponse(status: number, body: unknown): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

describe("handleGovernanceRealWebviewMessage", () => {
  it("ignores non-governance messages", async () => {
    const t = makeCtx()
    const handled = await handleGovernanceRealWebviewMessage(
      { type: "memory.list" },
      t.ctx,
    )
    expect(handled).toBe(false)
    expect(t.posted).toHaveLength(0)
  })

  it("governance.load returns Hub data when reachable", async () => {
    const t = makeCtx()
    const hubState = {
      tiers: [{ level: 0, name: "observer", permissions: ["view_audit"] }],
      tierAssignments: [{ user: "alice", tier: "operator", assignedAt: 1, assignedBy: "system" }],
      riskThresholds: { low: { min: 0, max: 10 } },
    }
    t.setFetch(async () => jsonResponse(200, { value: hubState }))

    const handled = await handleGovernanceRealWebviewMessage({ type: "governance.load" }, t.ctx)
    expect(handled).toBe(true)

    expect(t.fetchCalls).toHaveLength(1)
    expect(t.fetchCalls[0].url).toBe(
      "http://hub.test:8095/api/canonical-settings?key=governance",
    )
    expect(t.fetchCalls[0].init?.method).toBe("GET")

    expect(t.posted).toHaveLength(1)
    const out = t.posted[0] as {
      type: string
      payload: { tierAssignments: Array<{ user: string }> }
      source: string
    }
    expect(out.type).toBe("governance.update")
    expect(out.source).toBe("hub")
    expect(out.payload.tierAssignments[0].user).toBe("alice")
  })

  it("governance.load falls back to defaults when Hub returns 404", async () => {
    const t = makeCtx()
    t.setFetch(async () => jsonResponse(404, { error: "not found" }))

    await handleGovernanceRealWebviewMessage({ type: "governance.load" }, t.ctx)

    expect(t.posted).toHaveLength(1)
    const out = t.posted[0] as {
      type: string
      payload: { tiers: Array<{ name: string; permissions: string[] }> }
      source: string
      warning?: string
    }
    expect(out.type).toBe("governance.update")
    expect(out.source).toBe("defaults")
    expect(out.warning).toMatch(/Hub unreachable/)

    // 4-tier model present.
    const names = out.payload.tiers.map((t) => t.name)
    expect(names).toEqual(["observer", "operator", "admin", "superadmin"])
  })

  it("governance.load falls back to defaults when fetch throws (network error)", async () => {
    const t = makeCtx()
    t.setFetch(async () => {
      throw new Error("ECONNREFUSED")
    })

    await handleGovernanceRealWebviewMessage({ type: "governance.load" }, t.ctx)

    expect(t.posted).toHaveLength(1)
    const out = t.posted[0] as { source: string; warning?: string }
    expect(out.source).toBe("defaults")
    expect(out.warning).toMatch(/ECONNREFUSED/)
  })

  it("governance.update POSTs the right payload", async () => {
    const t = makeCtx()
    const newState = {
      tiers: [{ level: 0, name: "observer", permissions: ["view_audit"] }],
      tierAssignments: [{ user: "bob", tier: "admin", assignedAt: 2, assignedBy: "alice" }],
    }
    t.setFetch(async () => jsonResponse(200, { value: newState }))

    await handleGovernanceRealWebviewMessage(
      { type: "governance.update", payload: newState },
      t.ctx,
    )

    expect(t.fetchCalls).toHaveLength(1)
    expect(t.fetchCalls[0].url).toBe("http://hub.test:8095/api/canonical-settings")
    expect(t.fetchCalls[0].init?.method).toBe("POST")
    const body = JSON.parse(t.fetchCalls[0].init?.body ?? "{}")
    expect(body.key).toBe("governance")
    expect(body.value).toEqual(newState)
    expect(t.fetchCalls[0].init?.headers?.["content-type"]).toBe("application/json")

    expect(t.posted).toHaveLength(1)
    const out = t.posted[0] as { type: string; source: string; payload: typeof newState }
    expect(out.type).toBe("governance.update")
    expect(out.source).toBe("hub")
    expect(out.payload.tierAssignments[0].user).toBe("bob")
  })

  it("governance.update reverts UI on Hub error (emits error + reload)", async () => {
    const t = makeCtx()
    let call = 0
    t.setFetch(async (url, init) => {
      call += 1
      if (call === 1) {
        // POST fails with 500
        expect(init?.method).toBe("POST")
        return jsonResponse(500, { error: "internal" })
      }
      // Subsequent reload GET succeeds with the OLD known-good state.
      expect(url).toContain("?key=governance")
      return jsonResponse(200, {
        value: { tiers: [], tierAssignments: [{ user: "old", tier: "observer", assignedAt: 0, assignedBy: "system" }] },
      })
    })

    await handleGovernanceRealWebviewMessage(
      { type: "governance.update", payload: { tierAssignments: [{ user: "new" }] } },
      t.ctx,
    )

    // We expect 3 posts: error, then the reloaded "old" state.
    expect(t.posted).toHaveLength(2)
    const errMsg = t.posted[0] as { type: string; reason: string; revert?: boolean }
    expect(errMsg.type).toBe("governance.error")
    expect(errMsg.revert).toBe(true)
    expect(errMsg.reason).toMatch(/Hub save failed/)

    const reverted = t.posted[1] as {
      type: string
      payload: { tierAssignments: Array<{ user: string }> }
      source: string
    }
    expect(reverted.type).toBe("governance.update")
    expect(reverted.source).toBe("hub")
    expect(reverted.payload.tierAssignments[0].user).toBe("old")
  })

  it("governance.update without a payload emits governance.error", async () => {
    const t = makeCtx()
    await handleGovernanceRealWebviewMessage({ type: "governance.update" }, t.ctx)
    expect(t.fetchCalls).toHaveLength(0)
    expect(t.posted).toHaveLength(1)
    const out = t.posted[0] as { type: string; reason: string }
    expect(out.type).toBe("governance.error")
    expect(out.reason).toMatch(/requires a payload/)
  })
})

describe("loadDefaultGovernanceState", () => {
  it("returns the 4-tier skeleton when no workspace folder is given", () => {
    const defaults = loadDefaultGovernanceState(undefined)
    expect(defaults.tiers).toBeDefined()
    expect((defaults.tiers as Array<{ name: string }>).map((t) => t.name)).toEqual([
      "observer",
      "operator",
      "admin",
      "superadmin",
    ])
    expect(defaults.riskThresholds).toBeDefined()
    expect(defaults.tierAssignments).toEqual([])
    expect(defaults.auditLog).toEqual([])
  })
})
