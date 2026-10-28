export * as Version from "./version"

/**
 * Agent Plugins versions this loader implements, keyed by version. Each release publishes both schema identifiers
 * (spec §10.1). A plugin declaring any other identifier is rejected (§5.2): add a row here, with tests, only after
 * checking that the release's rules match this implementation.
 */
export const supported = {
  "1.0.0": {
    plugin: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    mcp: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  },
} as const

export type Id = keyof typeof supported

export function fromPluginSchema(schema: string) {
  return (Object.keys(supported) as Id[]).find((id) => supported[id].plugin === schema)
}

export function fromMcpSchema(schema: string) {
  return (Object.keys(supported) as Id[]).find((id) => supported[id].mcp === schema)
}
