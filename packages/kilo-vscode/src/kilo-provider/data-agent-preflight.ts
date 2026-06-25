import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { invalidate } from "../services/marketplace/actions"
import { MarketplaceApiClient } from "../services/marketplace/api"
import { AGENT_ALREADY_INSTALLED_ERROR, MarketplaceInstaller } from "../services/marketplace/installer"
import { MarketplacePaths } from "../services/marketplace/paths"
import type { AgentMarketplaceItem, InstallResult } from "../services/marketplace/types"
import { TelemetryProxy } from "../services/telemetry/telemetry-proxy"
import { TelemetryEventName } from "../services/telemetry/types"

export type PreflightReason = "unavailable" | "install" | "unexpected"

export type PreflightResult = { available: true } | { available: false; reason: PreflightReason }

export interface PreflightDeps {
  fetchAgents: () => Promise<AgentMarketplaceItem[]>
  installAgent: (agent: AgentMarketplaceItem) => Promise<InstallResult>
  invalidate: () => Promise<void>
  log: (message: string, detail?: unknown) => void
  capture: (reason: PreflightReason) => void
}

const preparations = new WeakMap<KiloConnectionService, Promise<PreflightResult>>()
const availability = new WeakMap<KiloConnectionService, boolean>()

function failure(deps: PreflightDeps, reason: PreflightReason, msg: string, detail?: unknown): PreflightResult {
  deps.log(msg, detail)
  deps.capture(reason)
  return { available: false, reason }
}

export async function prepareDataAgent(deps: PreflightDeps): Promise<PreflightResult> {
  const catalog = await deps.fetchAgents().then(
    (agents) => ({ agents }),
    (err: unknown) => ({ err }),
  )
  if ("err" in catalog) {
    return failure(deps, "unavailable", "[Kilo New] Failed to fetch the Data agent for onboarding:", catalog.err)
  }

  const agent = catalog.agents.find((item) => item.type === "agent" && item.id === "data")
  if (!agent) return failure(deps, "unavailable", "[Kilo New] Data agent is unavailable in the marketplace catalog")

  const install = await deps.installAgent(agent).then(
    (result) => ({ result }),
    (err: unknown) => ({ err }),
  )
  if ("err" in install) {
    return failure(
      deps,
      "unexpected",
      "[Kilo New] Unexpected failure while installing the Data agent for onboarding:",
      install.err,
    )
  }

  if (!install.result.success) {
    if (install.result.error === AGENT_ALREADY_INSTALLED_ERROR) return { available: true }
    return failure(deps, "install", "[Kilo New] Failed to install the Data agent for onboarding:", install.result.error)
  }

  await deps.invalidate().catch((err: unknown) => {
    deps.log("[Kilo New] Failed to invalidate the CLI after installing the Data agent:", err)
  })
  return { available: true }
}

function defaults(connection: KiloConnectionService, dir: string): PreflightDeps {
  const api = new MarketplaceApiClient()
  const installer = new MarketplaceInstaller(new MarketplacePaths())
  return {
    fetchAgents: () => api.fetchAgents(),
    installAgent: (agent) => installer.installAgent(agent, "global"),
    invalidate: () => invalidate({ connection }, "global", dir),
    log: (msg, detail) => {
      if (detail === undefined) {
        console.error(msg)
        return
      }
      console.error(msg, detail)
    },
    capture: (reason) => {
      TelemetryProxy.capture(TelemetryEventName.DATA_AGENT_ONBOARDING_PREPARATION_FAILED, { reason })
    },
  }
}

export function prepareDataAgentOnce(
  connection: KiloConnectionService,
  dir: string,
  deps?: PreflightDeps,
): Promise<PreflightResult> {
  const existing = preparations.get(connection)
  if (existing) return existing

  // Cache failures to avoid duplicate telemetry.
  const pending = prepareDataAgent(deps ?? defaults(connection, dir)).then((result) => {
    availability.set(connection, result.available)
    return result
  })
  preparations.set(connection, pending)
  return pending
}

export function isDataAgentAvailable(connection: KiloConnectionService): boolean {
  return availability.get(connection) ?? false
}
