import type { SpawnHooks } from "@opencode-ai/core/mcp/index"
import type { Mcp } from "@opencode-ai/schema/mcp"
import { Effect } from "effect"
import { createSandboxArgvLauncher, parseSandboxConfig, sandboxSupport, type SandboxConfig } from "./sandbox"

export interface SandboxServerCommand {
  readonly command: string[]
  readonly environment?: Record<string, string>
}

/**
 * Decide the sandbox rewrite for one MCP server config. Returns undefined when the server must
 * stay unchanged: a remote server or an empty command argv.
 *
 * Disabled local servers are rewritten too: the disabled flag only prevents the automatic
 * reconcile spawn (core/src/mcp/index.ts:595,634,670), while the public `mcp.connect` starts a
 * disabled server unconditionally (`connect` -> `startServer`), so leaving them unwrapped would
 * give a direct connect an unconfined process.
 *
 * The `opencode` environment marker is baked here because the native client only adds
 * `BUN_BE_BUN` when the spawned command is exactly `opencode` (core/src/mcp/client.ts:226); once
 * the command is wrapped, the launcher path replaces it and the marker must come from the
 * server's own environment. User-provided environment values keep precedence, matching the
 * client's spread order.
 */
export function sandboxServerCommand(server: Mcp.ServerConfig, launcherPath: string): SandboxServerCommand | undefined {
  if (server.type !== "local") return undefined
  const [executable, ...args] = server.command
  if (!executable) return undefined
  return {
    command: [launcherPath, executable, ...args],
    ...(executable === "opencode" ? { environment: { BUN_BE_BUN: "1" } } : {}),
  }
}

/**
 * Wrap each local spawn independently of plugin activation. Core provides the
 * connection scope, so stopping or failing a connection also removes its launcher.
 * Raw configs remain unchanged; never treat a command path as proof of confinement.
 */
export function createSandboxMcpSpawnGate(config: SandboxConfig): SpawnHooks {
  const parsed = parseSandboxConfig(config)
  if (!parsed.enabled) throw new Error("sandbox MCP gate requires an enabled sandbox config")
  const support = sandboxSupport(parsed)
  if (!support.available) throw new Error(`Sandbox is enabled but unavailable: ${support.reason}`)
  return {
    beforeSpawn: (server, directory) =>
      Effect.gen(function* () {
        if (server.type !== "local") return server
        const [executable] = server.command
        if (!executable) return server
        const launcher = yield* Effect.acquireRelease(
          Effect.try(() => createSandboxArgvLauncher(parsed, directory)),
          (launcher) => Effect.sync(() => launcher.dispose()),
        )
        const rewrite = sandboxServerCommand(server, launcher.path)
        if (!rewrite) return server
        return {
          ...server,
          command: rewrite.command,
          ...(rewrite.environment ? { environment: { ...rewrite.environment, ...server.environment } } : {}),
        }
      }),
  }
}
