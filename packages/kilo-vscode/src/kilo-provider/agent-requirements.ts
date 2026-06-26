import type { AgentRequirementResult } from "@kilocode/sdk/v2/client"
import { installMarketplaceItem, type MarketplaceActionContext } from "../services/marketplace/actions"
import type { InstallResult, MarketplaceItem } from "../services/marketplace/types"
import { getErrorMessage, sameDirectory } from "../kilo-provider-utils"

export type RequirementInstall = {
  marketplace: string
  status: "installing" | "succeeded" | "failed"
  code?: "skill_not_found" | "item_not_skill" | "installation_failed" | "unavailable" | "marketplace_unavailable"
  error?: string
}

export type RequirementExtension = {
  name: string
  id: string
  status: "ready" | "missing" | "error"
  message?: string
}

export type HostAgentRequirementResult = Omit<AgentRequirementResult, "vscode_extensions"> & {
  vscode_extensions: RequirementExtension[]
}

export type AgentRequirementsInstallHandler = (input: {
  result: AgentRequirementResult
  directory: string
  progress: (installs: RequirementInstall[]) => void
}) => Promise<void>

export function requirementKey(agent: string, directory: string): string {
  return `${directory}\0${agent}`
}

export function applyVSCodeExtensionRequirements(input: {
  result: AgentRequirementResult
  installed: (id: string) => boolean
}): HostAgentRequirementResult {
  const extensions = input.result.vscode_extensions.map((extension) => ({
    ...extension,
    status: input.installed(extension.id) ? ("ready" as const) : ("missing" as const),
  }))
  const missing = extensions.some((item) => item.status !== "ready")
  return {
    ...input.result,
    state: input.result.state === "ready" && missing ? "blocked" : input.result.state,
    vscode_extensions: extensions,
  }
}

// Resolve requests only against known session and worktree directories.
export function requirementDirectory(input: {
  requested: string
  session?: string
  root: string
  sessions: ReadonlyMap<string, string>
  worktrees: readonly string[]
}): string | undefined {
  if (input.session) {
    const dir = input.sessions.get(input.session) ?? input.root
    return sameDirectory(dir, input.requested) ? dir : undefined
  }

  const allowed = [input.root, ...input.sessions.values(), ...input.worktrees]
  return allowed.find((dir) => sameDirectory(dir, input.requested))
}

// Install every missing skill and continue after individual failures.
export async function installRequirements(input: {
  result: AgentRequirementResult
  items: MarketplaceItem[]
  install: (item: Extract<MarketplaceItem, { type: "skill" }>) => Promise<InstallResult>
  progress: (installs: RequirementInstall[]) => void
}): Promise<RequirementInstall[]> {
  const missing = input.result.skills.filter((skill) => skill.status === "missing")
  const installs: RequirementInstall[] = []

  for (const skill of missing) {
    const item = input.items.find((candidate) => candidate.id === skill.marketplace)
    if (!item || item.type !== "skill") {
      installs.push({
        marketplace: skill.marketplace,
        status: "failed",
        code: !item ? "skill_not_found" : "item_not_skill",
      })
      input.progress([...installs])
      continue
    }

    installs.push({ marketplace: skill.marketplace, status: "installing" })
    input.progress([...installs])
    const result = await input.install(item)
    installs[installs.length - 1] = result.success
      ? { marketplace: skill.marketplace, status: "succeeded" }
      : { marketplace: skill.marketplace, status: "failed", code: "installation_failed", error: result.error }
    input.progress([...installs])
  }

  return installs
}

// Install required skills through the shared extension services.
export function createAgentRequirementsInstaller(ctx: MarketplaceActionContext): AgentRequirementsInstallHandler {
  return async (input) => {
    const data = await ctx.marketplace.fetchData(undefined, undefined, []).then(
      (result) => result,
      (error) => ({
        marketplaceItems: [],
        marketplaceInstalledMetadata: { project: {}, global: {} },
        marketplaceRelevance: {},
        errors: [getErrorMessage(error)],
      }),
    )

    const failed = data.errors?.length && data.marketplaceItems.length === 0
    if (failed) {
      input.progress(
        input.result.skills
          .filter((skill) => skill.status !== "ready")
          .map((skill) => ({
            marketplace: skill.marketplace,
            status: "failed",
            code: "marketplace_unavailable" as const,
            error: data.errors!.join("; "),
          })),
      )
    }
    if (!failed) {
      await installRequirements({
        result: input.result,
        items: data.marketplaceItems,
        progress: input.progress,
        install: (item) => installMarketplaceItem(ctx, item, { target: "global" }, undefined, input.directory),
      })
    }

    await ctx.connection.invalidateAgentRequirements()
  }
}
