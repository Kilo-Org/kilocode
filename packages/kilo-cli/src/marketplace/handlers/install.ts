import { Runtime } from "@opencode/cli/framework/runtime"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { Effect, Option } from "effect"
import { UserError } from "../../error"
import { Marketplace } from "../commands"
import { call, connect, print, recordMessages, validateResponse, type Connection } from "./client"

export default Runtime.handler(
  Marketplace.commands.install,
  Effect.fn("cli.marketplace.install")(function* (input) {
    const marketplace = yield* connect
    const registry = yield* Option.match(input.registry, {
      onSome: (registry) => Effect.succeed(registry),
      onNone: () => call(() => resolveRegistry(marketplace, input.kind, input.id)),
    })
    const record = yield* call(() =>
      marketplace.rpc
        .install(
          {
            registry,
            kind: input.kind,
            id: input.id,
            scope: input.project ? "project" : "global",
            option: Option.getOrUndefined(input.option),
            params: Option.getOrUndefined(input.param),
          },
          marketplace.options,
        )
        .then(validateResponse("install")),
    )
    yield* reportInstall(marketplace, record)
  }),
)

// Export the post-install boundary so fixtures can verify output ordering and nonfatal status failures.
export function reportInstall(marketplace: Connection, record: KiloMarketplaceRpc.Installed, timeout = 15_000) {
  return Effect.gen(function* () {
    yield* print([
      `Installed ${record.kind} ${record.id} from ${record.registry} (${record.scope})`,
      ...record.paths.map((target) => `  ${target}`),
      ...(record.config ? [`  ${record.config}`] : []),
      ...recordMessages(record),
    ])
    if (record.kind !== "mcp") return
    const context =
      `Use the same server, project directory (${marketplace.location.directory}), and profile ` +
      `(the same KILO_V2_PROFILE with bun dev in this checkout). ` +
      "For a remote server, run recovery on that server with its project/profile; native mcp auth has no --server flag."
    const status = yield* call(() => installStatus(marketplace, record, timeout)).pipe(
      Effect.catch(() =>
        Effect.succeed(["MCP status unavailable; installation retained. Check with `kilo mcp list`."]),
      ),
    )
    yield* print([...status, context])
  })
}

async function installStatus(marketplace: Connection, record: KiloMarketplaceRpc.Installed, timeout: number) {
  if (!record.server || !record.config)
    return ["MCP status not verified: installation has no server/config identity. Check with `kilo mcp list`."]
  const name = record.server
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const entries = await marketplace.client.config.get(marketplace.options, {
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))),
    })
    // Native discovery is lowest to highest priority. Inspect ownership, not a second config merge.
    const effective = entries.findLast(
      (entry) => entry.type === "document" && Object.hasOwn(entry.info.mcp?.servers ?? {}, name),
    )
    if (effective?.type === "document" && effective.path !== record.config)
      return [
        `MCP ${name} is overridden in this project; installed config is not effective. Check with \`kilo mcp list\`.`,
      ]
    if (effective && performance.now() < deadline) {
      const servers = await marketplace.client.mcp.list(marketplace.options, {
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))),
      })
      const server = servers.data.find((server) => server.name === name)
      if (server?.status.status === "connected") return [`MCP ${name}: connected.`]
      if (server?.status.status === "disabled") return [`MCP ${name}: disabled; no sign-in started.`]
      if (server?.status.status === "failed")
        return [`MCP ${name}: connection failed: ${server.status.error}`, "Check with `kilo mcp list`."]
      if (server?.status.status === "needs_auth")
        return [
          `MCP ${name}: sign-in required; installation retained.`,
          `Run: kilo mcp auth '${name.replaceAll("'", "'\\''")}'`,
          "Remote OAuth needs authorization on the server machine or established callback forwarding.",
        ]
    }
    await Bun.sleep(Math.min(250, Math.max(0, deadline - performance.now())))
  }
  return [`MCP ${name}: status not ready; installation retained. Check later with \`kilo mcp list\`.`]
}

/** Implicit selection needs complete discovery; a failed source may contain another matching id. */
export async function resolveRegistry(marketplace: Connection, kind: KiloMarketplaceRpc.Kind, id: string) {
  // Searchable registries list only a top slice without a query.
  const listed = await marketplace.rpc
    .list({ kind, query: id.split("/").at(-1) }, marketplace.options)
    .then(validateResponse("list"))
  const matches = [...new Set(listed.items.filter((item) => item.id === id).map((item) => item.registry))]
  if (matches.length === 1 && listed.failures.length === 0) return matches[0]
  const failures = listed.failures.map((failure) => `${failure.registry}: ${failure.message}`)
  const sources = await marketplace.rpc
    .registries({}, marketplace.options)
    .then(validateResponse("registries"))
    .catch((error: Error) => {
      failures.push(`Couldn't load registry settings: ${error.message}`)
      return []
    })
  const disabled = sources.filter((source) => !source.enabled && source.kinds.includes(kind))
  throw new UserError({
    message: [
      ...(listed.failures.length > 0
        ? [`Discovery in enabled registries is incomplete; cannot automatically select a registry for ${id}.`]
        : []),
      ...failures.map((failure) => `Warning: ${failure}`),
      matches.length > 0
        ? `${id} was found in ${matches.join(", ")}; pass --registry <id> to choose explicitly.`
        : `No ${kind} ${id} found in the enabled registries${listed.failures.length ? " that responded" : ""}.`,
      ...disabled.map(
        (source) =>
          `${source.name} (${source.id}) is disabled and supports ${kind} items; enable it with ` +
          `\`kilo marketplace registries --enable ${source.id}\` and retry.`,
      ),
    ].join("\n"),
  })
}
