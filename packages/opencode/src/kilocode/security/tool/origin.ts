import * as ToolNetwork from "@/kilocode/sandbox/network"
import type { ToolProvenance } from "../types"

/**
 * Structural provenance of a tool definition.
 *
 * Where a tool's code came from is recorded by whoever loaded it — the registry when it imports a
 * file or takes a plugin's tool map — as a symbol on the definition object. It is never derived from
 * anything the tool says about itself, so a lower-trust source cannot claim a higher trust level:
 * a workspace tool cannot mark itself "builtin", because only the registry sets the built-in marker
 * (`ToolNetwork.builtin`) and only on Kilo's own tools.
 *
 * An unmarked, non-built-in definition is `unknown`, which is the conservative case, not a trusted one.
 */
export namespace ToolOrigin {
  // A module-local symbol, deliberately not registered in the global registry: a tool module cannot
  // reach it, so it cannot stamp an origin on itself.
  const ORIGIN = Symbol("kilo.security.toolOrigin")

  /** Origins a loader can record. `builtin` is expressed by the registry's own marker instead. */
  export type Recorded = Extract<ToolProvenance, "trusted-config" | "workspace" | "plugin" | "unknown">

  export function mark<A extends object>(value: A, origin: Recorded): A {
    Object.defineProperty(value, ORIGIN, { value: origin, enumerable: false, configurable: true })
    return value
  }

  export function of(value: object): Recorded | undefined {
    const found = (value as Record<symbol, unknown>)[ORIGIN]
    return typeof found === "string" ? (found as Recorded) : undefined
  }

  /**
   * Provenance of a tool definition as the security layer sees it. Built-in wins (it is the marker
   * the registry controls); otherwise the recorded origin; otherwise unknown.
   */
  export function provenance(value: object): ToolProvenance {
    if (ToolNetwork.isBuiltin(value)) return "builtin"
    return of(value) ?? "unknown"
  }

  /** Provenance of an MCP tool entry: remote servers are a distinct, weaker trust level. */
  export function mcpProvenance(entry: object): ToolProvenance {
    return ToolNetwork.isRemoteMcp(entry) ? "mcp-remote" : "mcp-local"
  }
}
