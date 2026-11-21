import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { waitForPlugins } from "@opencode/cli/services/plugin-startup"
import { Runtime } from "@opencode/cli/framework/runtime"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { Effect, Option } from "effect"
import { resolve } from "node:path"
import { PermissionsCommand } from "./permissions"

export default Runtime.handler(
  PermissionsCommand.commands.list,
  Effect.fn("kilo.permissions.list")(function* (input) {
    const directory = resolve(Option.getOrElse(input.directory, () => process.cwd()))
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    yield* waitForPlugins(client, directory)
    const sets = yield* Effect.tryPromise(() =>
      client.rpc(KiloPermissionsRpc.Definition).list({}, { location: { directory } }),
    )
    const grants = yield* Effect.tryPromise(() => client.permission.saved.list({ projectID: sets.projectID })).pipe(
      Effect.map((items) => items.toSorted(compareGrants)),
    )
    process.stdout.write(formatList(grants, sets.applied))
  }),
)

export function formatList(
  grants: ReadonlyArray<{ readonly action: string; readonly resource: string }>,
  applied: readonly KiloPermissionsRpc.Preset[],
) {
  const rules = applied.flatMap((set) => set.resources.map((resource) => ({ set: set.id, resource })))
  return [
    `permissions: ${grants.length} saved grants\n`,
    ...(grants.length === 0 ? [] : [`permissions[${grants.length}]{action,resource}:\n`]),
    ...grants.map((grant) => `  ${JSON.stringify(grant.action)},${JSON.stringify(grant.resource)}\n`),
    applied.length === 0
      ? "active set: none\n"
      : `active ${applied.length === 1 ? "set" : "sets"}: ${applied.map((set) => set.id).join(", ")} (${rules.length} grants)\n`,
    ...(rules.length === 0 ? [] : [`active[${rules.length}]{set,resource}:\n`]),
    ...rules.map((rule) => `  ${JSON.stringify(rule.set)},${JSON.stringify(rule.resource)}\n`),
  ].join("")
}

function compareGrants(left: { action: string; resource: string }, right: { action: string; resource: string }) {
  if (left.action !== right.action) return left.action < right.action ? -1 : 1
  if (left.resource !== right.resource) return left.resource < right.resource ? -1 : 1
  return 0
}
