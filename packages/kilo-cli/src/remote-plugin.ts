import type { GatewayExtension } from "@kilocode/gateway"
import type { OpenCodeClient } from "@opencode-ai/client"
import { Effect, Exit, Scope, Semaphore, Stream } from "effect"
import { REMOTE_LIMITATION, RemoteRpc } from "./remote-rpc"
import { createRemoteSuggestions } from "./remote-suggestions"
import type { RemoteSessionHandle } from "./remote-session"

export interface RemoteRegistrationOptions {
  readonly relayURL: string
  readonly client: () => Pick<OpenCodeClient, "command" | "session">
  readonly allowHttpLoopback?: boolean
}

/**
 * Location-scoped, non-persistent opt-in. Account secrets stay inside the host,
 * and credential changes withdraw the connection instead of retaining old auth.
 * No relay request is made by registration, status, or disable.
 */
export function registerRemote(options: RemoteRegistrationOptions): GatewayExtension {
  return (ctx, account) =>
    Effect.gen(function* () {
      const parent = yield* Scope.Scope
      const lock = Semaphore.makeUnsafe(1)
      let active: { scope: Scope.Closeable; connection: RemoteSessionHandle } | undefined
      const status = () => ({
        enabled: active !== undefined,
        connected: active?.connection.connected ?? false,
        directory: ctx.location.directory,
        note: REMOTE_LIMITATION,
      })
      const disable = Effect.suspend(() => {
        const current = active
        active = undefined
        return current ? Scope.close(current.scope, Exit.void) : Effect.void
      })
      yield* ctx.event.subscribe().pipe(
        Stream.filter((event) => event.type === "credential.updated" || event.type === "credential.switched"),
        Stream.runForEach(() => lock.withPermit(disable)),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* ctx.rpc.register(RemoteRpc, {
        status: () => Effect.sync(status),
        disable: () => lock.withPermit(disable.pipe(Effect.andThen(() => Effect.sync(status)))),
        enable: (_, call) =>
          lock.withPermit(
            Effect.gen(function* () {
              if (active) return status()
              const resolved = yield* account.pipe(
                Effect.mapError(() => call.error("kilocode.remote", "Remote account is unavailable")),
              )
              const { installRemoteSessionAdapter } = yield* Effect.promise(() => import("./remote-session"))
              const child = yield* Scope.fork(parent)
              // The suggest tool exists only while this remote is enabled: it
              // registers on the extension's optional tool domain inside the
              // enabled child scope, so a disable removes the registration and
              // a host without the capability exposes no suggestion surface.
              const suggestions = ctx.tool ? createRemoteSuggestions() : undefined
              if (suggestions && ctx.tool) {
                const { suggestTool } = yield* Effect.promise(() => import("./remote-suggestions"))
                yield* ctx.tool
                  .transform((editor) => {
                    editor.add(suggestTool({ suggestions, client: options.client() }))
                  })
                  .pipe(Scope.provide(child))
              }
              const installed = yield* Effect.suspend(() =>
                installRemoteSessionAdapter(
                  ctx,
                  {
                    relayURL: options.relayURL,
                    bearerToken: resolved.token,
                    allowHttpLoopback: options.allowHttpLoopback,
                  },
                  options.client(),
                  suggestions,
                ),
              ).pipe(Scope.provide(child), Effect.exit)
              if (Exit.isFailure(installed)) {
                yield* Scope.close(child, installed)
                return yield* Effect.fail(call.error("kilocode.remote", "Remote connection could not be enabled"))
              }
              active = { scope: child, connection: installed.value }
              return status()
            }),
          ),
      })
    })
}
