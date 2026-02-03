import type { McpServer } from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@kilocode/sdk/v2" // kilocode_change

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
  modeId?: string
}

export interface ACPConfig {
  sdk: OpencodeClient
  defaultModel?: {
    providerID: string
    modelID: string
  }
}
