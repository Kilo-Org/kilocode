import { KiloMcpIdentity } from "@kilocode/gateway-core"
import { define } from "@opencode/plugin/effect/plugin"
import { IntegrationID } from "@opencode/schema/integration-id"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloMcpGuardrailsRpc } from "@opencode/schema/kilocode/mcp-guardrails"
import { Duration, Effect, Option, Queue, Result, Schema, Semaphore, Stream } from "effect"
import { isDeepStrictEqual } from "node:util"

// The organization's MCP allow list, applied to every server in the final MCP set. The policy is cached for the
// active organization, refreshed at startup, every REFRESH_INTERVAL and when the organization changes, and kept
// across restarts so a cold start without network still enforces it. Without a policy nothing is blocked.
const REFRESH_INTERVAL = Duration.minutes(10)
// Servers connect in a burst at startup, so one report carries them all.
const REPORT_DELAY = Duration.millis(500)
const kilo = IntegrationID.make("kilo")
const organizationEvent = `rpc.${KiloGatewayRpc.Definition.id}.organization`
const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(KiloGatewayRpc.GuardrailsPolicy))

type Policy = typeof KiloGatewayRpc.GuardrailsPolicy.Type

export const KiloMcpGuardrailsPlugin = define({
  id: "kilocode.mcp-guardrails",
  effect: Effect.fn(function* (ctx) {
    const gateway = ctx.rpc(KiloGatewayRpc.Definition)
    const lock = Semaphore.makeUnsafe(1)
    const reports = yield* Queue.unbounded<{
      readonly key: string
      readonly connection: typeof KiloGatewayRpc.GuardrailsConnection.Type
    }>()
    // Connections already reported, so a reload does not report the same server again.
    const reported = new Set<string>()
    let current: Policy | undefined
    // A failed report is offered again by the next transform pass, which the next refresh triggers.
    let unreported = false

    const storageKey = (server: string, organizationID: string) => `policy:v1:${server}:${organizationID}`

    const activeScope = gateway.authStatus({}).pipe(
      Effect.option,
      Effect.map((status) =>
        Option.isSome(status) && status.value.authenticated && status.value.organizationID
          ? { server: status.value.server, organizationID: status.value.organizationID }
          : undefined,
      ),
    )

    const stored = Effect.gen(function* () {
      const scope = yield* activeScope
      if (!scope) return undefined
      const value = yield* ctx.storage.get(storageKey(scope.server, scope.organizationID))
      const policy = typeof value === "string" ? Option.getOrUndefined(decodeStored(value)) : undefined
      return policy?.organizationID === scope.organizationID ? policy : undefined
    })

    const apply = Effect.fnUntraced(function* (next: Policy | undefined) {
      if (isDeepStrictEqual(current, next)) return
      current = next
      yield* ctx.mcp.reload()
    })

    // The policy of an organization the account no longer uses must not outlive the switch: it is replaced by the
    // new organization's stored policy, or none, before the network answers.
    const reconcileScope = Effect.gen(function* () {
      const scope = yield* activeScope
      if (current && current.organizationID === scope?.organizationID) return
      yield* apply(scope ? yield* stored : undefined)
    })

    const refresh = lock.withPermit(
      Effect.gen(function* () {
        yield* reconcileScope
        const fetched = yield* gateway["guardrails.policy"]({}).pipe(Effect.result)
        if (Result.isFailure(fetched)) {
          // A failed refresh keeps the policy held for the active organization until the next interval.
          yield* Effect.logWarning("failed to refresh MCP guardrails", { cause: fetched.failure })
          return
        }
        const policy = fetched.success ?? undefined
        yield* apply(policy)
        const scope = yield* activeScope
        if (policy && scope)
          yield* ctx.storage.set(storageKey(scope.server, policy.organizationID), JSON.stringify(policy))
        if (!unreported) return
        unreported = false
        yield* ctx.mcp.reload()
      }),
    )

    const report = (
      policy: Policy,
      name: string,
      server: KiloMcpIdentity.ServerConfig,
      verdict: KiloMcpIdentity.Verdict,
    ) => {
      const connection = KiloMcpIdentity.connection(server)
      // A server that can never be allowlisted is denied by the cloud without a record.
      if (!connection || verdict.identityKey === undefined) return
      const key = [policy.organizationID, name, verdict.decision, verdict.identityKey].join("\0")
      if (reported.has(key)) return
      reported.add(key)
      Queue.offerUnsafe(reports, {
        key,
        connection: { target: connection.target, serverName: name, version: connection.version },
      })
    }

    // Loaded before the transform registers, which reconciles the servers: they must not start unguarded.
    current = yield* stored

    yield* ctx.mcp.transform((editor) => {
      const policy = current
      if (!policy || policy.enforcement === "off") return
      for (const [name, server] of editor.list()) {
        const verdict = evaluate(policy, server)
        // A disabled server makes no connection, though it is still blocked so it cannot be connected by hand.
        if (!server.disabled) report(policy, name, server, verdict)
        if (verdict.decision === "allowed" || policy.enforcement !== "enforce") continue
        if (editor.block) editor.block(name, describe(verdict))
        else editor.remove(name)
      }
    })

    yield* ctx.rpc
      .register(KiloMcpGuardrailsRpc.Definition, {
        evaluate: (input) =>
          Effect.sync(() => {
            const policy = current
            if (!policy || policy.enforcement === "off")
              return { enforcement: "off" as const, results: input.servers.map(() => ({ decision: "allowed" as const })) }
            return {
              enforcement: policy.enforcement,
              results: input.servers.map((server) => {
                const verdict = evaluate(policy, server)
                return verdict.reason ? { decision: verdict.decision, reason: verdict.reason } : { decision: verdict.decision }
              }),
            }
          }),
      })
      .pipe(Effect.orDie)

    yield* Effect.gen(function* () {
      const first = yield* Queue.take(reports)
      yield* Effect.sleep(REPORT_DELAY)
      const batch = [first, ...(yield* Queue.clear(reports))]
      const sent = yield* gateway["guardrails.report"]({ connections: batch.map((item) => item.connection) }).pipe(
        Effect.result,
      )
      if (Result.isSuccess(sent)) return
      for (const item of batch) reported.delete(item.key)
      unreported = true
    }).pipe(Effect.forever, Effect.forkScoped)

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event) =>
          event.type === organizationEvent ||
          (event.type === "credential.switched" && event.data.integrationID === kilo),
      ),
      Stream.runForEach(() => refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* Effect.sleep(REFRESH_INTERVAL).pipe(Effect.andThen(refresh), Effect.forever, Effect.forkScoped)
    // The startup refresh does not hold up the location: servers are already guarded by the stored policy.
    yield* Effect.forkScoped(refresh)
  }),
})

function evaluate(policy: Policy, server: KiloMcpIdentity.ServerConfig) {
  return KiloMcpIdentity.evaluate(policy.allowedServers, KiloMcpIdentity.connection(server))
}

function describe(verdict: KiloMcpIdentity.Verdict) {
  if (verdict.reason === "below_min_version")
    return `Below the minimum version your organization requires (${verdict.minVersion})`
  if (verdict.reason === "unsupported_target")
    return "Only https remote servers and packages launched with npx, bunx, pnpm dlx, uvx or uv tool run can be on your organization's MCP allowlist"
  return "Not on your organization's MCP allowlist"
}
