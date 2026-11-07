import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { define } from "@opencode/plugin/effect/plugin"
import { Event } from "@opencode/schema/config"
import { KiloAgentRpc } from "@opencode/schema/kilocode/agent"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Option, Schedule, Scope } from "effect"
import path from "path"
import { AgentRemove } from "./remove"

// Deletes the markdown definition of a custom agent that the config agent plugin discovered. The config agent
// plugin rescans on `config.updated`, so a removal also reaches the registry and every connected client. A built-in
// agent has no markdown file, so it is refused rather than deleted.
export const KiloAgentRemovePlugin = define<Bus.Service | FSUtil.Service | Global.Service | Scope.Scope>({
  id: "kilocode.agent",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const global = yield* Global.Service
    const fs = yield* FSUtil.Service
    const config = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(config)) return yield* Effect.die(new Error("Kilo agent removal requires location config"))

    // The files the config agent plugin would discover, limited to config directories that resolve inside the project
    // or the global config directory. Resolution happens here because only the filesystem knows a directory's target.
    const known = Effect.fn("KiloAgentRemovePlugin.known")(function* () {
      const entries = yield* config.value.entries()
      const candidates = yield* Effect.forEach(
        entries.filter((entry) => entry.type === "directory"),
        (entry) =>
          fs
            .resolve(entry.path)
            .pipe(Effect.map((resolved) => ({ root: path.resolve(entry.path), resolved }))),
      )
      // Both reference directories are resolved too: on macOS `/var` resolves to `/private/var`, and a resolved
      // candidate compared against an unresolved reference would look like it sits outside the project.
      const project = yield* fs.resolve(ctx.location.directory)
      const home = yield* fs.resolve(global.config)
      const roots = AgentRemove.roots(candidates, project, home)
      const files = yield* Effect.forEach(roots, (item) =>
        Effect.forEach(AgentRemove.patterns, (pattern) =>
          fs
            .scan(pattern, { cwd: item.root, absolute: true, dot: true, symlink: true })
            .pipe(Effect.orElseSucceed((): string[] => [])),
        ).pipe(Effect.map((lists) => lists.flat())),
      )
      return AgentRemove.agents(files.flat(), roots)
    })

    const registered = Effect.fn("KiloAgentRemovePlugin.registered")(function* () {
      return (yield* ctx.agent.list().pipe(Effect.orDie)).data.map((agent) => agent.id)
    })

    const removable = Effect.fn("KiloAgentRemovePlugin.removable")(function* () {
      const listed = yield* known()
      return listed.map((agent) => ({ name: agent.name, path: agent.path, scope: agent.scope }))
    })

    // The reload this RPC announces must not rescan a path that has already been deleted, so the announcement waits
    // until the files are observably gone.
    const arrive = Effect.fn("KiloAgentRemovePlugin.arrive")(function* (files: readonly string[]) {
      const gone = Effect.forEach(files, (file) => fs.isFile(file)).pipe(Effect.map((items) => items.every((it) => !it)))
      yield* Effect.repeat(gone, { until: (done) => done, schedule: Schedule.spaced("25 millis") }).pipe(
        Effect.timeout("2 seconds"),
        Effect.ignore,
      )
    })

    yield* ctx.rpc
      .register(KiloAgentRpc.Definition, {
        removable: () => removable(),
        remove: (input, context) =>
          Effect.gen(function* () {
            const result = AgentRemove.target({
              name: input.name,
              known: yield* known(),
              registered: yield* registered(),
              ...(input.scope === undefined ? {} : { scope: input.scope }),
            })
            if (result._tag === "failure")
              return yield* Effect.fail(
                context.error(
                  result.reason,
                  result.reason === "not_found"
                    ? `Agent "${input.name}" has no markdown definition in an editable directory`
                    : `Agent "${input.name}" is not defined by a file that can be deleted`,
                ),
              )
            // A file can disappear between discovery and the delete; skip it instead of failing the whole removal.
            const files = yield* Effect.filter(result.files, (file) => fs.isFile(file))
            if (files.length === 0)
              return yield* Effect.fail(
                context.error("not_found", `Agent "${input.name}" has no markdown definition to delete`),
              )
            yield* Effect.forEach(
              files,
              (file) =>
                fs.remove(file, { force: true }).pipe(
                  Effect.mapError((error) =>
                    context.error("remove_failed", `Could not remove ${path.basename(file)}: ${error.message}`),
                  ),
                ),
              { discard: true },
            )
            yield* arrive(files)
            yield* bus.publish(Event.Updated, {})
            return {}
          }),
      })
      .pipe(Effect.orDie)
  }),
})
