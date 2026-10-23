import { KiloCustomRouter } from "@kilocode/gateway-core"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { UI } from "@opencode/cli/run/ui"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Effect, Option, Schema } from "effect"
import { EOL } from "node:os"

export const location = { directory: process.cwd() }

/** A failed `routers.*` call: the user-facing message and, for a Cloud error, its code. */
export class CallError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

/** Wrong command input. Reported without the command's failure prefix, as v1 did. */
export class UsageError extends Error {}

export const connect = Effect.fn("kilo.auto.connect")(function* (input: {
  readonly server: Option.Option<string>
  readonly standalone: boolean
}) {
  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  // The model endpoint is the public readiness boundary for the initial plugin generation.
  yield* call(() => client.model.default({ location }))
  return { client, rpc: client.rpc(KiloGatewayRpc.Definition), options: { location } }
})

export function call<A>(run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => {
      // Signed out: the v1 message, without the command's failure prefix.
      if (typeof cause === "object" && cause !== null && "type" in cause && cause.type === "unauthorized")
        return new UsageError("Sign in to Kilo to use custom auto routers. Run `kilo auth login`.")
      if (typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string") {
        const data = "data" in cause ? cause.data : undefined
        const code =
          typeof data === "object" && data !== null && "code" in data && typeof data.code === "string"
            ? data.code
            : undefined
        return new CallError(cause.message, code)
      }
      return new CallError(cause instanceof Error ? cause.message : String(cause))
    },
  })
}

export function prefixed(prefix: string) {
  return (error: CallError | UsageError) =>
    error instanceof CallError ? new CallError(`${prefix}: ${error.message}`, error.code) : error
}

export function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown) {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(() => new CallError("Unexpected response from the custom router service")),
  )
}

// As on v1: data (router rows, JSON) goes to stdout, messages and progress to stderr, failures as `Error: ...`.
export const print = (line = "") => Effect.sync(() => process.stdout.write(line + EOL))
export const info = (line: string) => Effect.sync(() => UI.println(line))

/** Prints `Error: <prefix>: <message>` to stderr and sets a failing exit code. */
export function report(prefix?: string) {
  return (error: unknown) =>
    Effect.sync(() => {
      const message = error instanceof Error ? error.message : String(error)
      UI.error(prefix && !(error instanceof UsageError) ? `${prefix}: ${message}` : message)
      process.exitCode = 1
    })
}

export function reference(value: string) {
  const resolved = KiloCustomRouter.resolveReference(value)
  return resolved
    ? Effect.succeed(resolved)
    : Effect.fail(new UsageError(`Not a custom router: "${value}". Use \`kilo-auto/custom/<slug>\` or a slug.`))
}

export function splitModel(value: string) {
  const separator = value.indexOf("/")
  return separator > 0 && separator < value.length - 1
    ? Effect.succeed({ provider: value.slice(0, separator), model: value.slice(separator + 1) })
    : Effect.fail(new UsageError(`Expected <provider>/<model>, got "${value}"`))
}

export function describeRouter(router: KiloCustomRouter.Summary) {
  return `${router.name} · base ${router.baseRouter} · mode ${router.mode} · default ${router.defaultEntryKey}${router.canEdit ? "" : " · read-only"}`
}

export function describeEntry(
  entry: KiloCustomRouter.ListEntry,
  servable: (provider: string, model: string) => boolean,
) {
  const state = entry.variants.map((variant) => `${variant.variant ?? "default"}:${variant.status}`).join(" ")
  const needs = entry.needsClientEval ? "needs client eval" : "ready"
  const local =
    entry.entry.kind === "client" && servable(entry.entry.provider, entry.entry.model) ? " · servable here" : ""
  return `${entry.key} · ${state || "no variants"} · ${needs}${local}`
}
