/**
 * An Agent Plugins loader (https://agent-plugins.org/specification). It validates plugin packages and resolves
 * their skills and MCP servers into client-neutral values; it depends on no OpenCode package, so the v2 plugin
 * adapter, the marketplace and other clients can share it.
 */
export { AgentPlugin } from "./plugin"
export { Diagnostic } from "./diagnostic"
export { Manifest } from "./manifest"
export { Mcp } from "./mcp"
export { Paths } from "./paths"
export { Skills } from "./skills"
export { Version } from "./version"
