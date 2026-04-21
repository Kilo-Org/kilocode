import type { DevilConnectionService } from "../services/cli-backend/connection-service"
import type { AgentManagerInMessage } from "./types"
import type { TeamBuilderInMessage } from "../messages/team-builder-types"

/**
 * Handles all team builder messages from the webview, delegated from AgentManagerProvider.
 * Returns true from handleMessage() if a message was handled, false otherwise.
 */
export class TeamBuilderHandler {
  constructor(
    private readonly connectionService: DevilConnectionService,
    private readonly postMessage: (msg: unknown) => void,
    private readonly log: (msg: string) => void,
  ) {}

  async handleMessage(msg: AgentManagerInMessage): Promise<boolean> {
    if (!msg.type.startsWith("teamBuilder.")) return false
    const tbMsg = msg as TeamBuilderInMessage
    switch (tbMsg.type) {
      case "teamBuilder.loadTeam":
        await this.handleLoadTeam(tbMsg.teamId)
        return true
      case "teamBuilder.listTeams":
        await this.handleListTeams()
        return true
      case "teamBuilder.saveTeam":
        await this.handleSaveTeam(tbMsg.teamId, tbMsg.config)
        return true
      case "teamBuilder.deleteTeam":
        await this.handleDeleteTeam(tbMsg.teamId)
        return true
      case "teamBuilder.getAggregations":
        await this.handleGetAggregations()
        return true
      default:
        return false
    }
  }

  private async handleLoadTeam(teamId: string): Promise<void> {
    try {
      const config = await this.connectionService.getTeam(teamId)
      this.postMessage({ type: "teamBuilder.teamLoaded", teamId, config })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      this.log(`[TeamBuilder] Failed to load team ${teamId}: ${message}`)
      this.postMessage({ type: "teamBuilder.error", code: "LOAD_FAILED", teamId, message })
    }
  }

  private async handleListTeams(): Promise<void> {
    try {
      const teams = await this.connectionService.listTeams()
      this.postMessage({ type: "teamBuilder.teamsList", teams })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      this.log(`[TeamBuilder] Failed to list teams: ${message}`)
      this.postMessage({ type: "teamBuilder.error", code: "LIST_FAILED", message })
    }
  }

  private async handleSaveTeam(teamId: string, config: unknown): Promise<void> {
    try {
      await this.connectionService.saveTeam(teamId, config)
      this.postMessage({ type: "teamBuilder.saved", teamId, success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      this.log(`[TeamBuilder] Failed to save team ${teamId}: ${message}`)
      this.postMessage({ type: "teamBuilder.saved", teamId, success: false, error: message })
    }
  }

  private async handleDeleteTeam(teamId: string): Promise<void> {
    try {
      await this.connectionService.deleteTeam(teamId)
      this.postMessage({ type: "teamBuilder.saved", teamId, success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      this.log(`[TeamBuilder] Failed to delete team ${teamId}: ${message}`)
      this.postMessage({ type: "teamBuilder.error", code: "DELETE_FAILED", teamId, message })
    }
  }

  private async handleGetAggregations(): Promise<void> {
    try {
      const data = await this.connectionService.getAggregations()
      this.postMessage({ type: "teamBuilder.aggregations", data })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      this.log(`[TeamBuilder] Failed to get aggregations: ${message}`)
      this.postMessage({ type: "teamBuilder.error", code: "AGGREGATION_FAILED", message })
    }
  }
}
