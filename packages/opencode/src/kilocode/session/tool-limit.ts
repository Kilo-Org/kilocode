// kilocode_change - new file: OpenAI-compatible providers reject requests whose
// `tools` array exceeds 128 items ("Invalid value for 'tools': maximum number of
// items is 128."). With many MCP servers connected the merged tool catalog can
// blow past that ceiling, so every outbound request must be capped. All selection
// logic here is pure so it can be unit-tested without an Effect runtime.
import { Log } from "@opencode-ai/core/util/log"

const log = Log.create({ service: "kilocode-tool-limit" })

export namespace KiloToolLimit {
  /** Hard ceiling enforced by OpenAI-compatible provider validation. */
  export const MAX_TOOLS = 128

  /** Added by prompt.ts after SessionTools.resolve for json_schema requests. */
  export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput"

  export type McpBudget = {
    /** Remaining MCP slots before the outbound ceiling is reached. */
    budget: number
    /** Every MCP key the merge loop must skip (conflicts + over-budget). */
    dropped: ReadonlySet<string>
    /** Keys dropped because a built-in/resource tool (or reserved slot) already owns the name. */
    conflicts: readonly string[]
    /** Keys dropped because the merged catalog would exceed the ceiling. */
    overBudget: readonly string[]
  }

  /**
   * Decide which MCP candidate keys must be dropped while SessionTools.resolve is
   * merging the (unbounded) MCP catalog on top of the already-built, bounded
   * built-in/resource tools. Dropping only MCP candidates guarantees the core
   * toolset is never trimmed. Candidates are sorted before slicing so the result
   * is deterministic regardless of MCP connection or enumeration order.
   *
   * Precondition: `mcpKeys` must be a unique-key set (the production caller
   * passes Object.keys(mcpTools), whose keys are unique by construction); the
   * budget arithmetic counts each candidate exactly once.
   *
   * `occupiedKeys` names MCP candidates that collide with a built-in/resource
   * tool already in the record (or the reserved StructuredOutput slot). A
   * collision can never increase the outbound count, so it must not consume
   * budget; the colliding candidate itself is dropped so the built-in wins.
   */
  export function planMcpBudget(input: {
    existingCount: number
    mcpKeys: readonly string[]
    reserveStructuredOutput: boolean
    occupiedKeys?: ReadonlySet<string>
    max?: number
  }): McpBudget {
    const max = input.max ?? MAX_TOOLS
    const occupied = input.occupiedKeys ?? new Set<string>()
    const conflicts = input.mcpKeys
      .filter(
        (key) =>
          occupied.has(key) ||
          (input.reserveStructuredOutput && key === STRUCTURED_OUTPUT_TOOL),
      )
      .sort((a, b) => a.localeCompare(b))
    const conflictSet = new Set(conflicts)
    const eligible = input.mcpKeys.filter((key) => !conflictSet.has(key)).sort((a, b) => a.localeCompare(b))
    const budget = Math.max(0, max - input.existingCount - (input.reserveStructuredOutput ? 1 : 0))
    const overBudget = eligible.slice(budget)
    return {
      budget,
      conflicts,
      overBudget,
      dropped: new Set([...conflicts, ...overBudget]),
    }
  }

  /**
   * Last-resort hard guard for the tool record every runtime sends verbatim.
   * When the record already fits, the SAME object reference is returned so calls
   * on the common (<= 128 tools) path are zero-change. Protected names (for
   * example StructuredOutput, which is added after resolve) are kept first; any
   * remaining slots go to the alphabetically earliest unprotected tools.
   */
  export function capOutboundTools<T>(
    input: Record<string, T>,
    options?: { max?: number; protected?: ReadonlySet<string> },
  ): { tools: Record<string, T>; dropped: string[] } {
    const max = options?.max ?? MAX_TOOLS
    const names = Object.keys(input)
    if (names.length <= max) return { tools: input, dropped: [] }

    const protectedNames = options?.protected ?? new Set<string>()
    const protectedKept = names
      .filter((name) => protectedNames.has(name))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, max)
    const pool = names
      .filter((name) => !protectedNames.has(name))
      .sort((a, b) => a.localeCompare(b))
    const keptPool = pool.slice(0, Math.max(0, max - protectedKept.length))
    const allowed = new Set([...protectedKept, ...keptPool])

    // Rebuild in original insertion order to minimize enumeration-order churn.
    const tools = Object.fromEntries(names.filter((name) => allowed.has(name)).map((name) => [name, input[name]]))
    const dropped = names.filter((name) => !allowed.has(name)).sort((a, b) => a.localeCompare(b))
    return { tools, dropped }
  }

  /**
   * Collisions are reported separately from limit drops: they can happen well
   * below the 128 ceiling and mean something different (a built-in kept its
   * name). Warnings stay count-only; tool names — which originate from external
   * MCP servers and may identify internal resources — are logged at debug.
   */
  export function reportConflicts(conflicts: readonly string[]) {
    if (conflicts.length === 0) return
    log.warn("ignoring MCP tools whose names collide with built-in tools", { conflictCount: conflicts.length })
    log.debug("colliding MCP tool names", { conflicts: [...conflicts].sort((a, b) => a.localeCompare(b)) })
  }

  /** Warn with the drop count for support/diagnostics; full names stay on debug. */
  export function report(phase: "mcp-resolve" | "outbound", dropped: readonly string[], max: number = MAX_TOOLS) {
    if (dropped.length === 0) return
    const sorted = [...dropped].sort((a, b) => a.localeCompare(b))
    log.warn("tool limit reached; dropping tools", { phase, limit: max, droppedCount: sorted.length })
    log.debug("tool limit dropped tool names", { phase, limit: max, dropped: sorted })
  }
}
