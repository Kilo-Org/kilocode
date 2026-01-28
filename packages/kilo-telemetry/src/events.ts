export enum TelemetryEvent {
  // CLI Lifecycle
  CLI_START = "CLI Start",
  CLI_EXIT = "CLI Exit",

  // Session Events
  SESSION_START = "Session Start",
  SESSION_END = "Session End",
  SESSION_MESSAGE = "Session Message",

  // Model Usage
  LLM_COMPLETION = "LLM Completion",

  // Feature Usage
  COMMAND_USED = "Command Used",
  TOOL_USED = "Tool Used",
  AGENT_USED = "Agent Used",

  // Share Events
  SHARE_CREATED = "Share Created",
  SHARE_DELETED = "Share Deleted",

  // MCP Events
  MCP_SERVER_CONNECTED = "MCP Server Connected",
  MCP_SERVER_ERROR = "MCP Server Error",

  // Auth Events
  AUTH_SUCCESS = "Auth Success",
  AUTH_LOGOUT = "Auth Logout",

  // Config Events
  TELEMETRY_DISABLED = "Telemetry Disabled",

  // Errors
  ERROR = "Error",
}
