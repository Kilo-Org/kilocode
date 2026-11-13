// The Marketplace view's v2 scope: the catalog data over the relay, the MCP status and sign-in handoff, and the host
// actions the panel needs.
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { createEffect, on, onMount } from "solid-js"
import { useV2 } from "./client"
import { createMarketplaceData } from "./marketplace-data"
import { createMcp } from "./mcp"

export function createMarketplace() {
  const v2 = useV2()
  const data = createMarketplaceData({ directory: v2.directory, rpc: v2.api.rpc(KiloMarketplaceRpc.Definition) })
  const mcp = createMcp()
  const load = () => {
    void data.load()
    void data.refreshInstalled()
  }
  createEffect(
    on(
      v2.connection.status,
      (status) => {
        if (status === "connected") load()
      },
      { defer: true },
    ),
  )
  onMount(() => {
    if (v2.connection.status() === "connected") load()
  })
  return {
    ...data,
    mcp,
    open: v2.open,
    report: v2.report,
    workspace: hasWorkspace(),
  }
}

export type Marketplace = ReturnType<typeof createMarketplace>

function hasWorkspace() {
  return (window as unknown as { KILO_HAS_WORKSPACE?: boolean }).KILO_HAS_WORKSPACE === true
}
