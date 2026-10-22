export * as McpRegistry from "./mcp-registry"

import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Option, Schema } from "effect"
import type { Entry, Registry } from "./registry"

// The official MCP registry (https://registry.modelcontextprotocol.io), API `v0`. Servers describe remote endpoints
// and packages (npm, PyPI, OCI). This adapter turns each into an install option whose payload is the same
// placeholder template the Kilo marketplace uses (`{{KEY}}`), so `mcp.ts` builds and validates both the same way.
// Registry variables (`{name}` in URLs and header values, package environment variables) become parameters.
const BASE = "https://registry.modelcontextprotocol.io"

const Value = Schema.Struct({
  description: Schema.optional(Schema.String),
  isRequired: Schema.optional(Schema.Boolean),
  isSecret: Schema.optional(Schema.Boolean),
  default: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
})
const Input = Schema.Struct({
  ...Value.fields,
  name: Schema.optional(Schema.String),
  valueHint: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  variables: Schema.optional(Schema.Record(Schema.String, Value)),
})
type Input = typeof Input.Type

const Remote = Schema.Struct({
  type: Schema.String,
  url: Schema.String,
  headers: Schema.optional(Schema.Array(Input)),
  variables: Schema.optional(Schema.Record(Schema.String, Value)),
})

const Package = Schema.Struct({
  registryType: Schema.String,
  identifier: Schema.String,
  version: Schema.optional(Schema.String),
  transport: Schema.optional(Schema.Struct({ type: Schema.String })),
  runtimeArguments: Schema.optional(Schema.Array(Input)),
  packageArguments: Schema.optional(Schema.Array(Input)),
  environmentVariables: Schema.optional(Schema.Array(Input)),
})
type Package = typeof Package.Type

const Server = Schema.Struct({
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  websiteUrl: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.Struct({ url: Schema.optional(Schema.String) })),
  remotes: Schema.optional(Schema.Array(Remote)),
  packages: Schema.optional(Schema.Array(Package)),
})
type Server = typeof Server.Type

const decodeList = Schema.decodeUnknownOption(
  Schema.Struct({ servers: Schema.Array(Schema.Struct({ server: Schema.Unknown })) }),
)
const decodeServer = Schema.decodeUnknownOption(Server)

export function make(input: { fetch?: typeof fetch; base?: string } = {}): Registry {
  const request = input.fetch ?? fetch
  const base = input.base ?? BASE
  return {
    id: "mcp-registry",
    name: "MCP Registry",
    description: "The official Model Context Protocol registry: community servers, not reviewed by Kilo",
    kinds: ["mcp"],
    curated: false,
    searchable: true,
    list: async (kind, query) => {
      if (kind !== "mcp") return []
      const search = query?.trim() ? `&search=${encodeURIComponent(query.trim())}` : ""
      // The registry answers a plain page in well under a second, but a search took 30 to 80 seconds when measured
      // (October 2026), so searches get a long timeout and a smaller page.
      const response = await request(`${base}/v0/servers?version=latest&limit=${search ? 30 : 100}${search}`, {
        signal: AbortSignal.timeout(search ? 90_000 : 20_000),
      })
      if (!response.ok) throw new Error(`MCP registry returned HTTP ${response.status}`)
      return parse(await response.json())
    },
  }
}

export function parse(body: unknown): Entry[] {
  const list = decodeList(body)
  if (Option.isNone(list)) throw new Error("MCP registry returned an unexpected document")
  return list.value.servers.flatMap((raw) => {
    const server = Option.getOrUndefined(decodeServer(raw.server))
    if (!server) return []
    const options = [...(server.remotes ?? []).flatMap(remoteOption), ...(server.packages ?? []).flatMap(packageOption)]
    // A server with nothing this client can run (for example only NuGet packages) is not listed.
    if (options.length === 0) return []
    return [
      {
        item: {
          registry: "mcp-registry",
          kind: "mcp" as const,
          id: server.name,
          name: server.title ?? server.name,
          description: server.description ?? "",
          author: server.name.split("/")[0],
          url: server.websiteUrl ?? server.repository?.url,
          tags: [],
          prerequisites: [],
          parameters: [],
          options: options.map(({ option }, index) => ({
            ...option,
            name:
              options.filter((entry) => entry.option.name === option.name).length > 1
                ? `${option.name} (${index + 1})`
                : option.name,
          })),
        },
        payloads: options.map((option) => JSON.stringify(option.config)),
      },
    ]
  })
}

interface Built {
  readonly option: KiloMarketplaceRpc.InstallOption
  readonly config: unknown
}

function remoteOption(remote: typeof Remote.Type): Built[] {
  if (remote.type !== "streamable-http" && remote.type !== "sse") return []
  const parameters = new Map<string, KiloMarketplaceRpc.Parameter>()
  const url = template(remote.url, parameters, remote.variables)
  const headers = Object.fromEntries(
    (remote.headers ?? []).flatMap((header) => {
      if (!header.name) return []
      const value = resolve(header.name, header, parameters)
      return [[header.name, value]]
    }),
  )
  return [
    {
      option: { name: `Remote (${remote.type})`, prerequisites: [], parameters: [...parameters.values()] },
      config: { type: remote.type, url, ...(Object.keys(headers).length > 0 ? { headers } : {}) },
    },
  ]
}

const RUNNERS: Record<
  string,
  { command: string; prerequisite: string; spec: (pkg: Package, args: string[]) => string[] }
> = {
  npm: { command: "npx", prerequisite: "Node.js", spec: (pkg, args) => [...args, "-y", versioned(pkg, "@")] },
  pypi: { command: "uvx", prerequisite: "Python and uv", spec: (pkg, args) => [...args, versioned(pkg, "==")] },
  oci: {
    command: "docker",
    prerequisite: "Docker",
    spec: (pkg, args) => [
      "run",
      ...args,
      "-i",
      "--rm",
      ...(pkg.environmentVariables ?? []).flatMap((variable) => (variable.name ? ["-e", variable.name] : [])),
      pkg.version && !pkg.identifier.includes(":") ? `${pkg.identifier}:${pkg.version}` : pkg.identifier,
    ],
  },
}

function packageOption(pkg: Package): Built[] {
  if (!Object.hasOwn(RUNNERS, pkg.registryType)) return []
  const runner = RUNNERS[pkg.registryType]
  // Only stdio packages run as a local server; HTTP transports of a package need a server started separately.
  if (!runner || (pkg.transport && pkg.transport.type !== "stdio")) return []
  const parameters = new Map<string, KiloMarketplaceRpc.Parameter>()
  const args = (list: readonly Input[] | undefined) => (list ?? []).flatMap((input) => argument(input, parameters))
  const environment = Object.fromEntries(
    (pkg.environmentVariables ?? []).flatMap((variable) =>
      variable.name ? [[variable.name, resolve(variable.name, variable, parameters)]] : [],
    ),
  )
  const command = [runner.command, ...runner.spec(pkg, args(pkg.runtimeArguments)), ...args(pkg.packageArguments)]
  return [
    {
      option: {
        name: `${runner.command} (${pkg.registryType})`,
        description: pkg.identifier,
        prerequisites: [runner.prerequisite],
        parameters: [...parameters.values()],
      },
      config: {
        type: "local",
        command,
        ...(Object.keys(environment).length > 0 ? { environment } : {}),
      },
    },
  ]
}

// A fixed value is used as is; a required argument without one becomes a parameter; an optional one is left out.
function argument(input: Input, parameters: Map<string, KiloMarketplaceRpc.Parameter>) {
  const value = input.value ?? input.default
  const name = input.name ?? input.valueHint
  const resolved =
    value !== undefined
      ? template(value, parameters, input.variables)
      : input.isRequired && name
        ? placeholder(name, input, parameters)
        : undefined
  if (resolved === undefined) return []
  if (input.type === "named" && input.name) return [input.name, resolved]
  return [resolved]
}

function resolve(name: string, input: Input, parameters: Map<string, KiloMarketplaceRpc.Parameter>): string {
  const value = input.value ?? input.default
  return value === undefined ? placeholder(name, input, parameters) : template(value, parameters, input.variables)
}

// Only declared registry variables are substituted; other braces are literal according to the registry schema.
function template(text: string, parameters: Map<string, KiloMarketplaceRpc.Parameter>, variables: Input["variables"]) {
  return text.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name: string) => {
    const variable = variables && Object.hasOwn(variables, name) ? variables[name] : undefined
    return variable ? (variable.value ?? variable.default ?? placeholder(name, variable, parameters)) : match
  })
}

function placeholder(name: string, input: Partial<Input>, parameters: Map<string, KiloMarketplaceRpc.Parameter>) {
  // Escape the delimiter too, so distinct registry names cannot share an answer.
  const key = name.replace(/[^A-Za-z0-9]/gu, (character) => `_${character.codePointAt(0)!.toString(16)}_`)
  if (!parameters.has(key)) {
    parameters.set(key, {
      key,
      name,
      placeholder: input.placeholder ?? input.description,
      optional: !input.isRequired,
      ...(input.isSecret !== undefined ? { secret: input.isSecret } : {}),
    })
  }
  if (input.isSecret) parameters.set(key, { ...parameters.get(key)!, secret: true })
  return `{{${key}}}`
}

function versioned(pkg: Package, separator: string) {
  return pkg.version && pkg.version !== "latest" ? `${pkg.identifier}${separator}${pkg.version}` : pkg.identifier
}
