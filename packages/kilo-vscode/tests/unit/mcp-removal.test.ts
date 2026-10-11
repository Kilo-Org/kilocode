import { describe, expect, it } from "bun:test"
import type { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { mcpRemoval } from "../../src/services/mcp-removal"

function connection(): KiloConnectionService {
  return {} as KiloConnectionService
}

describe("mcpRemoval", () => {
  it("shares removal events across consumers of one connection", () => {
    const conn = connection()
    const events: string[] = []
    const unsubscribe = mcpRemoval(conn).on((event) => events.push(`${event.phase}:${event.name}`))

    mcpRemoval(conn).emit({ directory: "/workspace", name: "anaconda", phase: "removing" })
    mcpRemoval(conn).emit({ directory: "/workspace", name: "anaconda", phase: "removed" })
    mcpRemoval(conn).emit({ directory: "/workspace", name: "anaconda", phase: "idle" })

    expect(events).toEqual(["removing:anaconda", "removed:anaconda", "idle:anaconda"])
    unsubscribe()
  })

  it("isolates connections and honors unsubscribe", () => {
    const first = connection()
    const second = connection()
    const events: string[] = []
    const unsubscribe = mcpRemoval(first).on((event) => events.push(event.name))

    mcpRemoval(second).emit({ directory: "/workspace", name: "other", phase: "removed" })
    unsubscribe()
    mcpRemoval(first).emit({ directory: "/workspace", name: "anaconda", phase: "removed" })

    expect(events).toEqual([])
  })
})
