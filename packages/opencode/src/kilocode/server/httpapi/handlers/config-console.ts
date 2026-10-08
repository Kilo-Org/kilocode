import { Account } from "@/account/account"
import { Auth } from "@/auth"
import { GlobalBus } from "@/bus/global"
import { Config } from "@/config/config"
import * as InstanceState from "@/effect/instance-state"
import { KilocodeConfigOverlay } from "@/kilocode/config/overlay"
import { KilocodeConfigWriter } from "@/kilocode/config/writer"
import { KilocodeConfigSources } from "@/kilocode/config/sources"
import { KilocodeModelState } from "@/kilocode/config/model-state"
import { ConfigRules } from "@/kilocode/server/routes/config-rules"
import { KilocodeKeybinds } from "@/kilocode/tui/keybinds"
import { KilocodeTuiConfig } from "@/kilocode/tui/config"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { Event } from "@/server/event"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { markInstanceForDisposal } from "@/server/routes/instance/httpapi/lifecycle"
import { Effect, Option } from "effect"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import {
  ConfigModelStatePatch,
  ConfigOverlayConflictError,
  ConfigOverlayPatch,
  ConfigOverlayQuery,
  ConfigOverlayShadowedError,
  ConfigOverlayWriteError,
  ConfigRulesPatch,
  TuiConfigPatch,
  TuiConfigQuery,
} from "../groups/config-console"
import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"

export const configConsoleHandlers = HttpApiBuilder.group(InstanceHttpApi, "config-console", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const account = yield* Account.Service
    const flock = yield* EffectFlock.Service

    const overlay = Effect.fn("ConfigConsoleHttpApi.overlay")(function* (ctx: {
      query: typeof ConfigOverlayQuery.Type
    }) {
      const instance = yield* InstanceState.context
      const all = yield* auth.all().pipe(Effect.orElseSucceed(() => ({})))
      const active = yield* account.active().pipe(
        Effect.map(Option.getOrUndefined),
        Effect.orElseSucceed(() => undefined),
      )
      const [base, global, sources] = yield* Effect.all(
        [
          config.get(),
          config.getGlobal(),
          Effect.promise(() =>
            KilocodeConfigSources.list({
              directory: instance.directory,
              worktree: instance.worktree,
              auth: all,
              account: active,
            }),
          ),
        ],
        { concurrency: 3 },
      )
      return yield* Effect.promise(() =>
        KilocodeConfigOverlay.resolve({
          directory: instance.directory,
          worktree: instance.worktree,
          scope: ctx.query.scope ?? "project",
          effective: base,
          global,
          sources: sources.sources,
        }),
      )
    })

    const overlayUpdate = Effect.fn("ConfigConsoleHttpApi.overlayUpdate")(function* (ctx: {
      payload: typeof ConfigOverlayPatch.Type
    }) {
      const body = {
        ...ctx.payload,
        set: ctx.payload.set ? { ...ctx.payload.set } : undefined,
        unset: ctx.payload.unset?.map((item) => [...item]),
      }
      const expected = body.expected ? { ...body.expected } : undefined
      const instance = yield* InstanceState.context
      const patch = KilocodeConfigOverlay.patch(body)
      // A later config file can already define the value, so a write would silently not apply.
      const shadow = yield* Effect.promise(() =>
        KilocodeConfigOverlay.shadow({
          scope: body.scope,
          directory: instance.directory,
          worktree: instance.worktree,
          patch,
        }),
      )
      if (shadow) {
        return yield* Effect.fail(
          new ConfigOverlayShadowedError({
            message: `Not saved: ${shadow.path} takes precedence over ${shadow.target}. Remove or edit the conflicting value there.`,
            path: shadow.target,
            shadowedBy: shadow.path,
          }),
        )
      }
      const writing = Effect.tryPromise({
        try: () =>
          KilocodeConfigWriter.write({
            ...body,
            directory: instance.directory,
            worktree: instance.worktree,
            expected,
          }),
        catch: (error: unknown) => {
          // Config validation and JSON parse failures must reach the client as a typed
          // error with the file and issues instead of an opaque 500 defect.
          if (error instanceof ConfigErrorV1.InvalidError) {
            return new ConfigOverlayWriteError({
              message: error.data.message ?? `Config is invalid in ${error.data.path}`,
              path: error.data.path,
              issues: error.data.issues?.map((issue: { message: string; path: unknown[] }) => ({
                message: issue.message,
                path: issue.path.map(String),
              })),
            })
          }
          if (error instanceof ConfigErrorV1.JsonError) {
            return new ConfigOverlayWriteError({
              message: error.data.message ?? `Config file contains invalid JSON: ${error.data.path}`,
              path: error.data.path,
            })
          }
          const message = error instanceof Error ? error.message : String(error)
          return new ConfigOverlayWriteError({ message: `Failed to write config: ${message}` })
        },
      })
      const result = yield* flock.withLock(writing, `config:${body.scope}:${expected?.path ?? "target"}`)
      if (!result.ok) {
        if (result.code === "target-not-writable") {
          return yield* Effect.fail(new ConfigOverlayWriteError({ message: result.message, path: result.target.path }))
        }
        return yield* Effect.fail(
          new ConfigOverlayConflictError({ code: result.code, message: result.message, target: result.target }),
        )
      }
      const hot = body.scope === "global" && Object.keys(patch).every((key) => key === "console")
      if (body.scope === "global") {
        yield* config.invalidate()
        if (result.changed) {
          yield* Effect.sync(() =>
            GlobalBus.emit("event", {
              directory: "global",
              payload: {
                type: Event.ConfigUpdated.type,
                properties: { sandbox: result.sandboxChanged },
              },
            }),
          ).pipe(Effect.catchCause(() => Effect.void))
        }
      } else {
        yield* config.update({})
        if (result.sandboxChanged) {
          yield* Effect.sync(() =>
            GlobalBus.emit("event", {
              directory: instance.directory,
              payload: {
                type: Event.ConfigUpdated.type,
                properties: { sandbox: true },
              },
            }),
          ).pipe(Effect.catchCause(() => Effect.void))
        }
        yield* markInstanceForDisposal(instance)
      }
      const output = yield* overlay({ query: { scope: body.scope } })
      if (body.scope === "global" && result.changed && !hot) {
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }).pipe(
          Effect.catchCause(() => Effect.void),
        )
      }
      return output
    })

    const sources = Effect.fn("ConfigConsoleHttpApi.sources")(function* () {
      const instance = yield* InstanceState.context
      const all = yield* auth.all().pipe(Effect.orElseSucceed(() => ({})))
      const active = yield* account.active().pipe(
        Effect.map(Option.getOrUndefined),
        Effect.orElseSucceed(() => undefined),
      )
      return yield* Effect.promise(() =>
        KilocodeConfigSources.list({
          directory: instance.directory,
          worktree: instance.worktree,
          auth: all,
          account: active,
        }),
      )
    })

    const effective = Effect.fn("ConfigConsoleHttpApi.effective")(function* () {
      return yield* config.get()
    })

    const rules = Effect.fn("ConfigConsoleHttpApi.rules")(function* () {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        ConfigRules.read({ directory: instance.directory, worktree: instance.worktree }),
      )
    })

    const rulesUpdate = Effect.fn("ConfigConsoleHttpApi.rulesUpdate")(function* (ctx: {
      payload: typeof ConfigRulesPatch.Type
    }) {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() =>
        ConfigRules.update({
          directory: instance.directory,
          worktree: instance.worktree,
          content: ctx.payload.content,
        }),
      )
    })

    const modelState = Effect.fn("ConfigConsoleHttpApi.modelState")(function* () {
      return yield* Effect.promise(() => KilocodeModelState.get())
    })

    const modelStateUpdate = Effect.fn("ConfigConsoleHttpApi.modelStateUpdate")(function* (ctx: {
      payload: typeof ConfigModelStatePatch.Type
    }) {
      return yield* Effect.promise(() =>
        KilocodeModelState.update({ favorite: ctx.payload.favorite?.map((item) => ({ ...item })) }),
      )
    })

    const tuiConfigGet = Effect.fn("ConfigConsoleHttpApi.tuiConfigGet")(function* () {
      const instance = yield* InstanceState.context
      return yield* Effect.promise(() => KilocodeTuiConfig.get({ directory: instance.directory }))
    })

    const tuiKeybindList = Effect.fn("ConfigConsoleHttpApi.tuiKeybindList")(function* () {
      return { keybinds: KilocodeKeybinds.list() }
    })

    const tuiConfigUpdate = Effect.fn("ConfigConsoleHttpApi.tuiConfigUpdate")(function* (ctx: {
      query: typeof TuiConfigQuery.Type
      payload: typeof TuiConfigPatch.Type
    }) {
      const instance = yield* InstanceState.context
      const patch = {
        ...ctx.payload,
        keybinds: ctx.payload.keybinds ? { ...ctx.payload.keybinds } : undefined,
        plugin: ctx.payload.plugin?.map((item) => {
          if (!Array.isArray(item)) return item
          return [item[0], { ...item[1] }] as [string, { readonly [x: string]: unknown }]
        }),
        plugin_enabled: ctx.payload.plugin_enabled ? { ...ctx.payload.plugin_enabled } : undefined,
      }
      return yield* Effect.promise(() =>
        KilocodeTuiConfig.update({
          directory: instance.directory,
          worktree: instance.worktree,
          scope: ctx.query.scope ?? "project",
          patch,
        }),
      )
    })

    return handlers
      .handle("overlay", overlay)
      .handle("overlayUpdate", overlayUpdate)
      .handle("sources", sources)
      .handle("effective", effective)
      .handle("rules", rules)
      .handle("rulesUpdate", rulesUpdate)
      .handle("modelState", modelState)
      .handle("modelStateUpdate", modelStateUpdate)
      .handle("tuiConfigGet", tuiConfigGet)
      .handle("tuiKeybindList", tuiKeybindList)
      .handle("tuiConfigUpdate", tuiConfigUpdate)
  }),
)
