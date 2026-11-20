// Project permission sets. The user picks a set for the project from the TUI offer; the plugin stores the set's shell
// rules with their set and allows a shell ask that they cover through the permission evaluate hook. Applied sets are
// plugin state, not saved permission grants: resetting them never touches the user's own approvals. The hook only
// turns `ask` into `allow`, so configured denies still win, and the hardening hooks registered after this plugin
// (Flow, Browser, Agent Manager, managed Policy, Sandbox) still decide last.
import { Flag } from "@opencode/core/flag"
import { Permission } from "@opencode/core/permission"
import { define, type Context } from "@opencode/plugin/effect/plugin"
import { KiloPermission } from "@opencode/schema/kilocode/permission"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Option, Schema, type Scope } from "effect"
import { catalog } from "./presets"
import { allowsRequest, missing } from "./rules"

const Decision = Schema.Literals(["accepted", "skipped"])
const Applied = Schema.Array(KiloPermissionsRpc.Preset)
// Stored sets may name a set that no longer exists (the old checks + install sets); reading drops them.
const Stored = Schema.Array(Schema.Struct({ id: Schema.String, resources: Schema.Array(Schema.String) }))
const isPresetID = Schema.is(KiloPermissionsRpc.PresetID)

export const installPermissionSets = Effect.fn("KiloPermissionsPlugin")(function* (ctx: {
  readonly location: Pick<Context["location"], "project">
  readonly storage: Pick<Context["storage"], "get" | "set" | "remove">
  readonly permission: Pick<Context["permission"], "hook">
  readonly rpc: Pick<Context["rpc"], "register">
}) {
  const fs = yield* FSUtil.Service
  const flags = yield* Effect.serviceOption(Flag.Service)
  const enabled = Option.isSome(flags)
    ? yield* Flag.enabled("permission_setup").pipe(Effect.provideService(Flag.Service, flags.value))
    : false
  const permission = yield* Effect.serviceOption(Permission.Service)
  const projectID = ctx.location.project.id
  const directory = ctx.location.project.directory
  const decisionKey = `offer:${projectID}`
  const appliedKey = `applied:${projectID}`
  const current = () => catalog(fs, directory).pipe(Effect.orDie)
  const stored = <S extends Schema.Top>(key: string, schema: S) =>
    ctx.storage
      .get(key)
      .pipe(
        Effect.flatMap((value) =>
          value === undefined
            ? Effect.succeed(undefined)
            : Schema.decodeUnknownEffect(schema)(value).pipe(Effect.orDie),
        ),
      )
  const decision = () => stored(decisionKey, Decision).pipe(Effect.map((value) => value ?? null))
  const applied = () =>
    stored(appliedKey, Stored).pipe(
      Effect.map((value): typeof Applied.Type =>
        (value ?? []).flatMap((set) => (isPresetID(set.id) ? [{ id: set.id, resources: set.resources }] : [])),
      ),
    )

  // Settles the waiting requests the applied sets now cover, as if the user had answered each one once.
  const drain = Effect.gen(function* () {
    if (Option.isNone(permission)) return
    for (const request of yield* permission.value.list()) {
      if (request.action !== "shell" || KiloPermission.requiresPerson(request.metadata)) continue
      const allowed = yield* permission.value
        .allows({ ...request })
        .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)))
      if (!allowed) continue
      yield* permission.value
        .reply({ requestID: request.id, reply: "once" })
        .pipe(Effect.catchTag("Permission.NotFoundError", () => Effect.void))
    }
  })

  // `ctx.rpc.register` returns the event emitter only after it has taken the handlers that publish, so the handlers
  // reach it through this slot, filled right after registration.
  const events: { emit?: (sets: typeof Applied.Type) => Effect.Effect<void> } = {}
  const publish = Effect.gen(function* () {
    const sets = yield* applied()
    if (events.emit) yield* events.emit(sets)
  })
  // Removes every applied set and returns how many rules they held. Saved permission grants are never touched.
  const removeApplied = Effect.gen(function* () {
    const removed = (yield* applied()).reduce((total, set) => total + set.resources.length, 0)
    yield* ctx.storage.remove(appliedKey)
    yield* publish
    return removed
  })

  if (enabled) {
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        if (event.effect !== "ask" || event.action !== "shell") return
        if (KiloPermission.requiresPerson(event.metadata)) return
        const sets = yield* applied()
        if (sets.length === 0) return
        const covered = allowsRequest({
          action: event.action,
          resources: event.resources,
          rules: event.rules ?? [],
          applied: sets.flatMap((set) => set.resources),
        })
        if (covered) event.effect = "allow"
      }),
    )
  }

  const registration = yield* ctx.rpc
    .register(KiloPermissionsRpc.Definition, {
      list: () =>
        Effect.gen(function* () {
          const presets = enabled ? (yield* current()).presets : []
          return { enabled, projectID, decision: yield* decision(), presets, applied: yield* applied() }
        }),
      apply: (input, context) =>
        Effect.gen(function* () {
          if (!enabled) return yield* Effect.fail(context.error("unavailable", "Permission setup is disabled"))
          const selected = (yield* current()).presets.find((preset) => preset.id === input.presetID)
          if (selected === undefined)
            return yield* Effect.fail(context.error("not_applicable", "The permission set no longer applies"))
          // Applying a set again replaces its rules with the current ones; other applied sets stay.
          const sets = (yield* applied()).filter((set) => set.id !== selected.id)
          yield* ctx.storage.set(
            appliedKey,
            [...sets, selected].map((set) => ({ id: set.id, resources: [...set.resources] })),
          )
          yield* ctx.storage.set(decisionKey, "accepted")
          yield* publish
          yield* drain
          return {}
        }),
      skip: (_input, context) =>
        Effect.gen(function* () {
          if (!enabled) return yield* Effect.fail(context.error("unavailable", "Permission setup is disabled"))
          yield* ctx.storage.set(decisionKey, "skipped")
          return {}
        }),
      clear: (_input, context) =>
        Effect.gen(function* () {
          if (!enabled) return yield* Effect.fail(context.error("unavailable", "Permission setup is disabled"))
          yield* removeApplied
          yield* ctx.storage.set(decisionKey, "skipped")
          return {}
        }),
      reset: (input) =>
        Effect.gen(function* () {
          yield* ctx.storage.remove(decisionKey)
          return { removed: input.all ? yield* removeApplied : 0 }
        }),
      check: (input, context) =>
        Effect.gen(function* () {
          if (!enabled) return yield* Effect.fail(context.error("unavailable", "Permission setup is disabled"))
          const presets = (yield* current()).presets
          const selected = input.presetID
            ? presets.find((preset) => preset.id === input.presetID)
            : presets.find((preset) => preset.id.endsWith("-install"))
          if (selected === undefined)
            return yield* Effect.fail(context.error("not_applicable", "The permission set does not apply"))
          const results = yield* Effect.forEach(input.commands, (command) =>
            missing(command, directory, selected.resources).pipe(Effect.map((parts) => ({ command, missing: parts }))),
          )
          return { presetID: selected.id, results }
        }),
    })
    .pipe(Effect.orDie)
  events.emit = (sets) => registration.events.emit("updated", { projectID, applied: sets }).pipe(Effect.ignore)
})

export const KiloPermissionsPlugin = define<FSUtil.Service | Scope.Scope>({
  id: "kilocode.permissions",
  effect: (ctx) => installPermissionSets(ctx),
})
