import type { KiloConnectionService } from "./cli-backend/connection-service"

export type McpRemovalEvent = {
  directory: string
  name: string
  phase: "removing" | "removed" | "installed" | "idle"
}

class McpRemovalBus {
  private listeners = new Set<(event: McpRemovalEvent) => void>()

  on(listener: (event: McpRemovalEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: McpRemovalEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

const buses = new WeakMap<KiloConnectionService, McpRemovalBus>()

/** Share MCP removal progress and completion across every webview using one CLI connection. */
export function mcpRemoval(connection: KiloConnectionService): McpRemovalBus {
  const existing = buses.get(connection)
  if (existing) return existing
  const bus = new McpRemovalBus()
  buses.set(connection, bus)
  return bus
}
