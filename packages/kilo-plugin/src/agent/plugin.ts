import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { systemDirectory } from "@opencode/core/kilocode/config/discovery"
import { define } from "@opencode/plugin/effect/plugin"
import { Event } from "@opencode/schema/config"
import { KiloAgentRpc } from "@opencode/schema/kilocode/agent"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Option, Schedule, Scope } from "effect"
import path from "path"
import { projectBoundary } from "../project-boundary"
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
      // candidate compared against an unresolved reference would look like it sits outside the project. The project
      // bound is the one config discovery walks to (the worktree root inside VCS, the filesystem root outside it), so
      // an ancestor `.kilo2` that discovery loads stays removable from a subdirectory workspace.
      const project = yield* projectBoundary(fs, ctx.location)
      const home = yield* fs.resolve(global.config)
      // Outside VCS the project boundary is the filesystem root, so the managed system directory must be excluded
      // explicitly, as the settings writer does, rather than relying on a narrower boundary.
      const system = yield* fs.resolve(systemDirectory())
      const roots = AgentRemove.roots(candidates, project, home, system)
      const discovered = yield* Effect.forEach(roots, (item) =>
        Effect.forEach(AgentRemove.patterns, (pattern) =>
          fs.scan(pattern, { cwd: item.root, absolute: true, dot: true, symlink: true }).pipe(
            Effect.orElseSucceed((): string[] => []),
            // Resolve the directory, not the file: discovery follows symlinks, so a symlinked directory below the root
            // would otherwise hand back a path that only looks contained. A symlinked file keeps its own entry so the
            // removal deletes the link instead of the file it points at.
            Effect.flatMap((files) =>
              Effect.forEach(files, (file) =>
                fs
                  .resolve(path.dirname(file))
                  .pipe(Effect.map((parent) => ({ file, real: path.join(parent, path.basename(file)) }))),
              ),
            ),
          ),
        ).pipe(Effect.map((lists) => lists.flat())),
      )
      // Glob order follows the filesystem, so sort to keep the response stable across platforms.
      return AgentRemove.agents(discovered.flat(), roots).sort(AgentRemove.compare)
    })

    const registered = Effect.fn("KiloAgentRemovePlugin.registered")(function* () {
      return (yield* ctx.agent.list().pipe(Effect.orDie)).data.map((agent) => agent.id)
    })

    const removable = Effect.fn("KiloAgentRemovePlugin.removable")(function* () {
      const listed = yield* known()
      return listed.map((agent) => ({ name: agent.name, path: agent.path, scope: agent.scope }))
    })

    // A name a config document still defines stays in the registry after its file is deleted, so waiting for it to
    // leave would always run out the timeout; the caller removes that config entry next.
    const defined = Effect.fn("KiloAgentRemovePlugin.defined")(function* (name: string) {
      const entries = yield* config.value.entries()
      return entries.some(
        (entry) =>
          entry.type === "document" && entry.info.agents !== undefined && Object.hasOwn(entry.info.agents, name),
      )
    })

    // The config agent plugin reloads on a 100 ms debounce, so announcing alone would let a caller read the registry
    // before the removed agent leaves it. Wait for the registry, as the skill removal does.
    const arrive = Effect.fn("KiloAgentRemovePlugin.arrive")(function* (name: string) {
      const gone = ctx.agent.list().pipe(
        Effect.orDie,
        Effect.map((result) => !result.data.some((agent) => agent.id === name)),
      )
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
            yield* bus.publish(Event.Updated, {})
            if (!(yield* defined(input.name))) yield* arrive(input.name)
            return {}
          }),
      })
      .pipe(Effect.orDie)
  }),
})
