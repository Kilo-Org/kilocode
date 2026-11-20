// Global saved auto-approve (v1 `/auto-approve` parity). When the global `kilo2.json` sets `auto_approve: true`,
// ordinary permission asks resolve to `allow` for every client without prompting, and pending asks drain when the
// setting turns on. Explicit denies, managed policies, unattended automation rules, human-only prompts
// (`metadata.interactive`), and the Kilo hardening hooks registered after this plugin still win.
import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Permission } from "@opencode/core/permission"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { KiloAutoApproveRpc } from "@opencode/schema/kilocode/auto-approve"
import { KiloPermission } from "@opencode/schema/kilocode/permission"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Option, type Scope, Stream } from "effect"
import { within } from "./settings"

/**
 * Resolves the effective `auto_approve` state from every loaded config entry in load order. Only a document inside the
 * canonical global config directory can enable it (`"enabled"`), so a checked-in project file cannot grant the bypass;
 * any non-global document setting `false` narrows it (`"narrowed"`).
 */
export const autoApproveState = Effect.fnUntraced(function* (
  entries: readonly Entry[],
  globalConfig: string,
  resolve: (file: string) => Effect.Effect<string>,
) {
  const globalDirectory = yield* resolve(globalConfig)
  let state: KiloAutoApproveRpc.State = "disabled"
  for (const entry of entries) {
    if (entry.type !== "document" || !(entry.info instanceof KiloConfigPolicy.Info)) continue
    const setting = entry.info.auto_approve
    if (setting === undefined) continue
    const isGlobal = entry.path !== undefined && within(globalDirectory, yield* resolve(entry.path))
    if (isGlobal) {
      state = setting ? "enabled" : "disabled"
      continue
    }
    if (!setting) state = "narrowed"
  }
  return state
})

export const isAutoApproveEnabled = (
  entries: readonly Entry[],
  globalConfig: string,
  resolve: (file: string) => Effect.Effect<string>,
) => autoApproveState(entries, globalConfig, resolve).pipe(Effect.map((state) => state === "enabled"))

export const installAutoApprove = Effect.fn("KiloAutoApprovePlugin")(function* (ctx: {
  readonly permission: Pick<Context["permission"], "hook">
  readonly rpc?: Pick<Context["rpc"], "register">
  readonly event: {
    readonly subscribe: (options: { readonly types: readonly ["config.updated"] }) => Stream.Stream<unknown, unknown>
  }
}) {
  const config = yield* Effect.serviceOption(Config.Service)
  if (Option.isNone(config)) return
  const permission = yield* Effect.serviceOption(Permission.Service)
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service

  const state = () =>
    config.value.entries().pipe(Effect.flatMap((entries) => autoApproveState(entries, global.config, fs.resolve)))
  const enabled = () => state().pipe(Effect.map((current) => current === "enabled"))

  if (ctx.rpc) {
    yield* ctx.rpc
      .register(KiloAutoApproveRpc.Definition, {
        get: () => state().pipe(Effect.map((current) => ({ state: current }))),
      })
      .pipe(Effect.orDie)
  }

  // Registered before Flow, Browser, Agent Manager, managed Policy and Sandbox hooks, so every hardening rule and
  // deny runs after this hook and still wins.
  yield* ctx.permission.hook("evaluate", (event) =>
    Effect.gen(function* () {
      if (event.effect !== "ask") return
      if (event.unattended !== undefined) return
      if (KiloPermission.requiresPerson(event.metadata)) return
      if (!(yield* enabled())) return
      event.effect = "allow"
    }),
  )

  const drain = Effect.gen(function* () {
    if (Option.isNone(permission)) return
    if (!(yield* enabled())) return
    const requests = yield* permission.value.list()
    for (const request of requests) {
      if (KiloPermission.requiresPerson(request.metadata)) continue
      const allowed = yield* permission.value
        .allows({ ...request })
        .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)))
      if (!allowed) continue
      yield* permission.value
        .reply({ requestID: request.id, reply: "once" })
        .pipe(Effect.catchTag("Permission.NotFoundError", () => Effect.void))
    }
  })

  yield* ctx.event.subscribe({ types: ["config.updated"] }).pipe(
    Stream.runForEach(() =>
      drain.pipe(Effect.catchCause((cause) => Effect.logError("failed to settle auto-approved permissions", { cause }))),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
})

export const KiloAutoApprovePlugin = define<FSUtil.Service | Global.Service | Scope.Scope>({
  id: "kilocode.auto-approve",
  effect: (ctx) => installAutoApprove(ctx),
})
