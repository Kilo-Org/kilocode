// Main exports for cli-backend services

// SDK types — re-exported so consumers can import from "cli-backend" barrel
export type {
  Session,
  SessionStatus,
  Message as MessageInfo,
  Part as MessagePart,
  ToolState,
  PermissionRequest,
  Event,
  Todo,
  Agent,
  Provider,
  Model as ProviderModel,
  McpStatus,
  McpLocalConfig,
  McpRemoteConfig,
  Config,
} from "@kilocode/sdk/v2/client"

// Local types — extension-specific, not from the API
export type {
  ServerConfig,
  EditorContext,
  KilocodeNotification,
  KilocodeNotificationAction,
  CloudSessionData,
} from "./types"

export { ServerManager } from "./server-manager"
export type { ServerInstance } from "./server-manager"

export { SdkSSEAdapter } from "./sdk-sse-adapter"
export type { SSEEventHandler, SSEErrorHandler, SSEStateHandler } from "./sdk-sse-adapter"

export { KiloConnectionService } from "./connection-service"
export type { ConnectionState } from "./connection-service"
