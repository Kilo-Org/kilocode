import type { OpenCodeClient, McpAddInput } from "@opencode-ai/client/promise"
import type { McpLocalConfig, McpRemoteConfig } from "./view-types"
import { result, type AdapterOptions } from "./result"

export function mcpConfig(config: McpLocalConfig | McpRemoteConfig): McpAddInput["config"] {
  const common = {
    disabled: config.enabled === undefined ? undefined : !config.enabled,
    timeout:
      config.timeout === undefined
        ? undefined
        : { startup: config.timeout, catalog: config.timeout, execution: config.timeout },
  }
  if (config.type === "local")
    return { ...common, type: "local", command: config.command, environment: { ...config.env, ...config.environment } }
  return {
    ...common,
    type: "remote",
    url: config.url,
    headers: config.headers,
    oauth:
      config.oauth === false
        ? false
        : config.oauth
          ? {
              client_id: config.oauth.clientId,
              client_secret: config.oauth.clientSecret,
              scope: config.oauth.scope,
              callback_port: config.oauth.callbackPort,
              redirect_uri: config.oauth.redirectUri,
            }
          : undefined,
  }
}

export function createMcpMethods(client: OpenCodeClient, defaultDirectory: string) {
  async function status(directory = defaultDirectory, options?: AdapterOptions) {
    const response = await client.mcp.list({ location: { directory } }, options)
    return Object.fromEntries(response.data.map((server) => [server.name, server.status]))
  }
  return {
    status: <Throw extends boolean = false>(input: { directory?: string } = {}, options?: AdapterOptions<Throw>) =>
      result(() => status(input.directory, options), options),
    add: <Throw extends boolean = false>(
      input: { name: string; directory?: string; config: McpLocalConfig | McpRemoteConfig },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        await client.mcp.add(
          {
            server: input.name,
            config: mcpConfig(input.config),
            location: { directory: input.directory ?? defaultDirectory },
          },
          options,
        )
        return status(input.directory, options)
      }, options),
    connect: <Throw extends boolean = false>(
      input: { name: string; directory?: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        await client.mcp.connect(
          { server: input.name, location: { directory: input.directory ?? defaultDirectory } },
          options,
        )
        return status(input.directory, options)
      }, options),
    disconnect: <Throw extends boolean = false>(
      input: { name: string; directory?: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        await client.mcp.disconnect(
          { server: input.name, location: { directory: input.directory ?? defaultDirectory } },
          options,
        )
        return status(input.directory, options)
      }, options),
    remove: <Throw extends boolean = false>(
      input: { name: string; directory?: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(
        () =>
          client.mcp.remove(
            { server: input.name, location: { directory: input.directory ?? defaultDirectory } },
            options,
          ),
        options,
      ),
  }
}
