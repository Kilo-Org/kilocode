import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { KiloToolLimit } from "@/kilocode/session/tool-limit"

function keys(count: number, prefix = "srv_tool_") {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(3, "0")}`)
}

function record(count: number, prefix = "k_") {
  return Object.fromEntries(keys(count, prefix).map((name) => [name, { name }]))
}

describe("KiloToolLimit.planMcpBudget", () => {
  test("drops nothing when all MCP candidates fit the remaining budget", () => {
    const result = KiloToolLimit.planMcpBudget({
      existingCount: 40,
      mcpKeys: keys(88),
      reserveStructuredOutput: false,
    })
    expect(result.budget).toBe(88)
    expect(result.dropped.size).toBe(0)
    expect(result.conflicts).toEqual([])
    expect(result.overBudget).toEqual([])
  })

  test("drops the alphabetically last candidates when over budget", () => {
    const result = KiloToolLimit.planMcpBudget({
      existingCount: 40,
      mcpKeys: keys(89),
      reserveStructuredOutput: false,
    })
    expect(result.budget).toBe(88)
    expect([...result.dropped]).toEqual(["srv_tool_088"])
    expect(result.conflicts).toEqual([])
    expect(result.overBudget).toEqual(["srv_tool_088"])
  })

  test("is deterministic regardless of input enumeration order", () => {
    const ordered = keys(89)
    const shuffled = [...ordered].reverse()
    const a = KiloToolLimit.planMcpBudget({ existingCount: 40, mcpKeys: ordered, reserveStructuredOutput: false })
    const b = KiloToolLimit.planMcpBudget({ existingCount: 40, mcpKeys: shuffled, reserveStructuredOutput: false })
    expect([...b.dropped].sort()).toEqual([...a.dropped].sort())
  })

  test("reserves a slot for StructuredOutput", () => {
    const result = KiloToolLimit.planMcpBudget({
      existingCount: 40,
      mcpKeys: keys(89),
      reserveStructuredOutput: true,
    })
    expect(result.budget).toBe(87)
    expect([...result.dropped].sort()).toEqual(["srv_tool_087", "srv_tool_088"])
    expect(result.overBudget).toEqual(["srv_tool_087", "srv_tool_088"])
  })

  test("drops every MCP candidate when no budget remains", () => {
    const mcpKeys = keys(5)
    const result = KiloToolLimit.planMcpBudget({
      existingCount: KiloToolLimit.MAX_TOOLS,
      mcpKeys,
      reserveStructuredOutput: false,
    })
    expect(result.budget).toBe(0)
    expect([...result.dropped].sort()).toEqual([...mcpKeys].sort())
    expect([...result.overBudget].sort()).toEqual([...mcpKeys].sort())
  })

  test("handles an empty MCP catalog", () => {
    const result = KiloToolLimit.planMcpBudget({
      existingCount: 10,
      mcpKeys: [],
      reserveStructuredOutput: false,
    })
    expect(result.budget).toBe(KiloToolLimit.MAX_TOOLS - 10)
    expect(result.dropped.size).toBe(0)
  })

  test("drops every MCP candidate when existing tools already exceed the ceiling", () => {
    const mcpKeys = keys(5)
    const result = KiloToolLimit.planMcpBudget({
      existingCount: KiloToolLimit.MAX_TOOLS + 4,
      mcpKeys,
      reserveStructuredOutput: false,
    })
    expect(result.budget).toBe(0)
    expect([...result.dropped].sort()).toEqual([...mcpKeys].sort())
    expect([...result.overBudget].sort()).toEqual([...mcpKeys].sort())
  })

  test("drops MCP candidates that collide with occupied built-in tools without spending budget", () => {
    const result = KiloToolLimit.planMcpBudget({
      existingCount: 40,
      mcpKeys: ["semantic_search", ...keys(87)], // 88 candidates total, budget is exactly 88
      occupiedKeys: new Set(["semantic_search"]),
      reserveStructuredOutput: false,
    })
    expect(result.budget).toBe(88)
    expect(result.dropped.has("semantic_search")).toBe(true)
    // the 87 non-colliding candidates all fit, so only the collision is dropped
    expect(result.dropped.size).toBe(1)
    expect(result.conflicts).toEqual(["semantic_search"])
    expect(result.overBudget).toEqual([])
  })

  test("keeps conflicts and over-budget drops in separate buckets", () => {
    const result = KiloToolLimit.planMcpBudget({
      existingCount: 127,
      mcpKeys: ["semantic_search", ...keys(3)], // 4 candidates, budget is 1 slot
      occupiedKeys: new Set(["semantic_search"]),
      reserveStructuredOutput: false,
    })
    expect(result.budget).toBe(1)
    expect(result.conflicts).toEqual(["semantic_search"])
    expect(result.overBudget).toEqual(["srv_tool_001", "srv_tool_002"])
    expect([...result.dropped].sort()).toEqual(["semantic_search", "srv_tool_001", "srv_tool_002"])
  })

  test("drops an MCP candidate named StructuredOutput only while the slot is reserved", () => {
    const mcpKeys = [KiloToolLimit.STRUCTURED_OUTPUT_TOOL, ...keys(4)]
    const reserved = KiloToolLimit.planMcpBudget({
      existingCount: 10,
      mcpKeys,
      reserveStructuredOutput: true,
    })
    expect(reserved.dropped.has(KiloToolLimit.STRUCTURED_OUTPUT_TOOL)).toBe(true)
    expect(reserved.conflicts).toEqual([KiloToolLimit.STRUCTURED_OUTPUT_TOOL])

    const unreserved = KiloToolLimit.planMcpBudget({
      existingCount: 10,
      mcpKeys,
      reserveStructuredOutput: false,
    })
    expect(unreserved.dropped.has(KiloToolLimit.STRUCTURED_OUTPUT_TOOL)).toBe(false)
    expect(unreserved.conflicts).toEqual([])
  })

  test("a below-ceiling catalog with only name collisions reports no over-budget drops", () => {
    // 10 built-ins + 3 colliding MCP candidates: total stays at 10, nowhere near 128
    const result = KiloToolLimit.planMcpBudget({
      existingCount: 10,
      mcpKeys: ["timing", "bash", "read"],
      occupiedKeys: new Set(["timing", "bash", "read"]),
      reserveStructuredOutput: false,
    })
    expect([...result.conflicts].sort()).toEqual(["bash", "read", "timing"])
    expect(result.overBudget).toEqual([])
    expect(result.budget).toBe(KiloToolLimit.MAX_TOOLS - 10)
  })
})

describe("KiloToolLimit.capOutboundTools", () => {
  test("returns the same reference and no drops when within the limit", () => {
    const input = record(KiloToolLimit.MAX_TOOLS)
    const result = KiloToolLimit.capOutboundTools(input)
    expect(result.tools).toBe(input)
    expect(result.dropped).toEqual([])
    expect(Object.keys(result.tools)).toHaveLength(128)
  })

  test("returns the same reference for an empty record", () => {
    const input = {}
    const result = KiloToolLimit.capOutboundTools(input)
    expect(result.tools).toBe(input)
    expect(result.dropped).toEqual([])
  })

  test("trims to the limit and reports the dropped names", () => {
    const input = record(129)
    const result = KiloToolLimit.capOutboundTools(input)
    expect(Object.keys(result.tools)).toHaveLength(128)
    expect(result.dropped).toEqual(["k_128"])
    expect(result.tools["k_128"]).toBeUndefined()
    expect(result.tools["k_000"]).toBeDefined()
  })

  test("keeps protected tools even when they sort last", () => {
    const input = Object.fromEntries([
      ...keys(128, "aaa_").map((name) => [name, { name }]),
      ["zzz_protected", { name: "zzz_protected" }],
    ])
    const result = KiloToolLimit.capOutboundTools(input, { protected: new Set(["zzz_protected"]) })
    expect(Object.keys(result.tools)).toHaveLength(128)
    expect(result.tools["zzz_protected"]).toBeDefined()
    expect(result.tools["aaa_127"]).toBeUndefined()
    expect(result.dropped).toEqual(["aaa_127"])
  })

  test("protects StructuredOutput against the alphabetical trim", () => {
    const input = Object.fromEntries([
      ...keys(128, "AAA_").map((name) => [name, { name }]),
      [KiloToolLimit.STRUCTURED_OUTPUT_TOOL, { name: KiloToolLimit.STRUCTURED_OUTPUT_TOOL }],
    ])
    const result = KiloToolLimit.capOutboundTools(input, {
      protected: new Set([KiloToolLimit.STRUCTURED_OUTPUT_TOOL]),
    })
    expect(Object.keys(result.tools)).toHaveLength(128)
    expect(result.tools[KiloToolLimit.STRUCTURED_OUTPUT_TOOL]).toBeDefined()
    expect(result.dropped).toEqual(["AAA_127"])
  })

  test("never throws when the protected set itself exceeds the limit", () => {
    const input = { a: {}, b: {}, c: {} }
    const result = KiloToolLimit.capOutboundTools(input, { max: 2, protected: new Set(["a", "b", "c"]) })
    expect(Object.keys(result.tools).length).toBeLessThanOrEqual(2)
    expect(result.dropped).toEqual(["c"])
  })

  test("preserves the original insertion order of kept tools", () => {
    const input = { z_first: {}, a_second: {}, m_third: {}, b_fourth: {} }
    const result = KiloToolLimit.capOutboundTools(input, { max: 2 })
    // alphabetically earliest two survive, enumerated in the record's original insertion order
    expect(Object.keys(result.tools)).toEqual(["a_second", "b_fourth"])
    expect(result.dropped).toEqual(["m_third", "z_first"])
  })
})

describe("KiloToolLimit reporting", () => {
  afterEach(() => {
    mock.restore()
  })

  function capture(): string[] {
    const lines: string[] = []
    spyOn(process.stderr, "write").mockImplementation(
      ((chunk: string | Uint8Array) => {
        lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk))
        return true
      }) as typeof process.stderr.write,
    )
    return lines
  }

  test("report is a no-op when nothing was dropped", () => {
    const lines = capture()
    KiloToolLimit.report("mcp-resolve", [])
    KiloToolLimit.reportConflicts([])
    expect(lines.join("")).toBe("")
  })

  test("a collision-only catalog logs a collision warning, never a limit warning", () => {
    const lines = capture()
    KiloToolLimit.reportConflicts(["timing"])
    KiloToolLimit.report("mcp-resolve", []) // overBudget is empty below the ceiling
    const output = lines.join("")
    expect(output).toContain("collide with built-in tools")
    expect(output).not.toContain("tool limit reached")
    // warn payload stays count-only: the actual external tool name must not appear at WARN level
    expect(output).toContain("conflictCount=1")
    expect(output).not.toContain("timing")
  })

  test("limit warnings stay count-only; dropped names are withheld from WARN output", () => {
    const lines = capture()
    KiloToolLimit.report("outbound", ["mcp_secret_server_private_tool"])
    const output = lines.join("")
    expect(output).toContain("tool limit reached")
    expect(output).toContain("droppedCount=1")
    expect(output).toContain("limit=128")
    expect(output).not.toContain("mcp_secret_server_private_tool")
  })
})
