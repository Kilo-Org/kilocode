import type { KiloClient } from "@kilocode/sdk/v2/client"
import type * as vscode from "vscode"
import { retry } from "../../services/cli-backend/retry"
import {
  MarketplaceService,
  type AgentMarketplaceItem,
  type InstallMarketplaceItemOptions,
  type MarketplaceItem,
  type RemoveResult,
} from "../../services/marketplace"
import { removeLegacyMcp } from "./legacy-mcp"

type Scope = "project" | "global"

interface MarketplaceState {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): PromiseLike<void>
}

export interface MarketplaceContext {
  readonly client: KiloClient | null
  readonly state: MarketplaceState | undefined
  readonly storage: vscode.Uri | undefined
  postMessage(msg: unknown): void
  getWorkspaceDirectory(): string
  getProjectDirectory(): string | undefined
  clearAgentsCache(): void
  clearSkillsCache(): void
  /** Clear the webview message and module-level command caches after an API error. */
  clearCommandsCache(): void
  /** Clear only the webview message cache after a thrown error or successful removal. */
  clearCommandsMessageCache(): void
  clearConfigCache(): void
  fetchAndSendAgents(): Promise<void>
  fetchAndSendSkills(): Promise<void>
  fetchAndSendCommands(): Promise<void>
  fetchAndSendConfig(): Promise<void>
}

export class MarketplaceHandler {
  private service: MarketplaceService | null = null

  constructor(private readonly ctx: () => MarketplaceContext) {}

  async fetchData(): Promise<void> {
    const ctx = this.ctx()
    const skills = await this.fetchCliSkills(ctx)
    const data = await this.getService().fetchData(ctx.getProjectDirectory(), skills)
    const dismissed = ctx.state?.get<boolean>("kilo.agentMigrationBannerDismissed") ?? false
    ctx.postMessage({ type: "marketplaceData", ...data, showAgentMigrationBanner: !dismissed })
  }

  async install(item: MarketplaceItem, options: InstallMarketplaceItemOptions): Promise<void> {
    const ctx = this.ctx()
    const scope = options?.target ?? "project"
    const result = await this.getService().install(item, options, ctx.getProjectDirectory())
    if (result.success) {
      await this.invalidate(scope)
    }
    ctx.postMessage({
      type: "marketplaceInstallResult",
      success: result.success,
      slug: result.slug,
      error: result.error,
    })
  }

  async remove(item: MarketplaceItem, scope: Scope): Promise<void> {
    const result = await this.removeItem(item, scope)
    this.ctx().postMessage({
      type: "marketplaceRemoveResult",
      success: result.success,
      slug: result.slug,
      error: result.error,
    })
  }

  async dismissBanner(): Promise<void> {
    await this.ctx().state?.update("kilo.agentMigrationBannerDismissed", true)
  }

  /** Remove a skill via the CLI backend, then refresh authoritative skill and command data. */
  async removeSkill(location: string): Promise<boolean> {
    const ctx = this.ctx()
    if (!ctx.client) return false
    try {
      const result = await ctx.client.kilocode.removeSkill({ location, directory: ctx.getWorkspaceDirectory() })
      if (result.error) {
        console.error("[Kilo New] removeSkill returned error:", result.error)
        ctx.clearSkillsCache()
        ctx.clearCommandsCache()
        await Promise.all([ctx.fetchAndSendSkills(), ctx.fetchAndSendCommands()])
        return false
      }
    } catch (err) {
      console.error("[Kilo New] Failed to remove skill:", err)
      ctx.clearSkillsCache()
      ctx.clearCommandsMessageCache()
      await Promise.all([ctx.fetchAndSendSkills(), ctx.fetchAndSendCommands()])
      return false
    }
    ctx.clearSkillsCache()
    ctx.clearCommandsMessageCache()
    await Promise.all([ctx.fetchAndSendSkills(), ctx.fetchAndSendCommands()])
    return true
  }

  /** Remove an agent via CLI, falling back to kilo.json removal. */
  async removeAgent(name: string): Promise<void> {
    const ctx = this.ctx()
    if (!ctx.client) return
    try {
      const result = await ctx.client.kilocode.removeAgent({ name, directory: ctx.getWorkspaceDirectory() })
      if (!result.error) {
        ctx.clearAgentsCache()
        await ctx.fetchAndSendAgents()
        return
      }
    } catch (err) {
      console.warn("[Kilo New] removeAgent via CLI failed, falling back to marketplace removal:", err)
    }
    const stub: AgentMarketplaceItem = {
      id: name,
      type: "agent",
      name,
      description: "",
      content: { mode: "primary", description: "", prompt: "" },
    }
    if (!(await this.removeAll(stub))) {
      console.error("[Kilo New] KiloProvider: Failed to remove agent:", name)
    }
  }

  async removeMcp(name: string): Promise<void> {
    const ctx = this.ctx()
    await removeLegacyMcp({ name, workspace: ctx.getProjectDirectory(), storage: ctx.storage })

    const stub = { id: name, type: "mcp" as const, name, description: "", url: "", content: "" }
    if (!(await this.removeAll(stub))) {
      console.error("[Kilo New] KiloProvider: Failed to remove MCP server:", name)
    }
  }

  dispose(): void {
    this.service?.dispose()
  }

  private getService(): MarketplaceService {
    if (this.service) return this.service
    this.service = new MarketplaceService()
    return this.service
  }

  private async fetchCliSkills(
    ctx: MarketplaceContext,
  ): Promise<Array<{ name: string; location: string }> | undefined> {
    if (!ctx.client) return undefined
    try {
      const { data } = await retry(() =>
        ctx.client!.app.skills({ directory: ctx.getWorkspaceDirectory() }, { throwOnError: true }),
      )
      return data
    } catch (err) {
      console.error("[Kilo New] KiloProvider: Failed to fetch CLI skills for marketplace:", err)
      return undefined
    }
  }

  private async removeItem(item: MarketplaceItem, scope: Scope): Promise<RemoveResult> {
    const result = await this.getService().remove(item, scope, this.ctx().getProjectDirectory())
    if (result.success) {
      await this.invalidate(scope)
    }
    return result
  }

  /** Remove from both scopes because service removal is idempotent and an item may exist in both. */
  private async removeAll(item: MarketplaceItem): Promise<boolean> {
    const ctx = this.ctx()
    const workspace = ctx.getProjectDirectory()
    const service = this.getService()
    const project = await service.remove(item, "project", workspace)
    const global = await service.remove(item, "global", workspace)

    if (!(project.success || global.success)) return false
    await this.invalidate(global.success ? "global" : "project")
    return true
  }

  /** Reset CLI config caches before refreshing dependent webview data. */
  private async invalidate(scope: Scope): Promise<void> {
    const ctx = this.ctx()
    if (!ctx.client) return
    if (scope === "global") {
      await ctx.client.global.config.update({ config: {} }).catch((err: unknown) => {
        console.warn("[Kilo New] global.config.update after marketplace change failed:", err)
      })
    }
    await ctx.client.instance.dispose({ directory: ctx.getWorkspaceDirectory() }).catch((err: unknown) => {
      console.warn("[Kilo New] instance.dispose() after marketplace change failed:", err)
    })
    ctx.clearAgentsCache()
    ctx.clearConfigCache()
    await Promise.all([ctx.fetchAndSendAgents(), ctx.fetchAndSendConfig()])
  }
}
