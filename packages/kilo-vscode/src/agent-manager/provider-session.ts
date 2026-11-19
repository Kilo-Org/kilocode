// Session creation for a worktree, split out of AgentManagerProvider. Preparation and MCP warmup stay detached
// from the awaited session.create so the first prompt can arrive early.
import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { waitForModel } from "@opencode/client/kilocode/model-startup"
import type { AgentManagerConnection } from "./connection"
import type { AgentManagerOutMessage } from "./types"
import { getErrorMessage } from "./errors"
import { prepareDirectory } from "./mcp-warmup"
import { sessionCreateBody } from "./session-create"
import type { CreationBoot } from "./provider-lifecycle"

export interface ProviderSessionHost {
  readonly connection: AgentManagerConnection
  postToWebview(message: AgentManagerOutMessage): void
  log(...args: unknown[]): void
}

export async function createSessionInWorktree(
  host: ProviderSessionHost,
  worktreePath: string,
  branch: string,
  worktreeId?: string,
  timing?: { mark(label: string): void },
  model?: { providerID: string; modelID: string; variant?: string },
  agent?: string,
  boot?: CreationBoot,
): Promise<SessionInfo | null> {
  let client: OpenCodeClient
  try {
    client = await host.connection.client()
  } catch (err) {
    host.log("createSessionInWorktree: client not available:", err)
    host.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: "Not connected to CLI backend",
      worktreeId,
    })
    return null
  }

  host.postToWebview({
    type: "agentManager.worktreeSetup",
    status: "starting",
    message: "Starting session...",
    branch,
    worktreeId,
  })

  try {
    void prepareDirectory(client, worktreePath, (...args) => host.log(...args)).catch((err) =>
      host.log("Worktree preparation failed:", err),
    )
    const metadata = await boot?.metadata()
    if (model)
      await waitForModel(client, {
        location: { directory: worktreePath },
        model: { providerID: model.providerID, id: model.modelID },
        signal: host.connection.signal(),
      })
    const created = await client.session.create(sessionCreateBody({ directory: worktreePath, model, agent, metadata }))
    timing?.mark("session")
    return created
  } catch (error) {
    host.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "error",
      message: `Failed to create session: ${getErrorMessage(error)}`,
      worktreeId,
    })
    return null
  }
}
