import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { App } from "@opencode/core/app"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { Schedule } from "@opencode/core/schedule"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { Tool } from "@opencode/core/tool"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloApp } from "../src/app"
import { KiloHost } from "../src/host"

const wakeupTools = ["schedule_wakeup", "cancel_wakeup", "cron_create", "cron_list", "cron_delete"] as const
const flowTools = ["flow_create", "flow_list", "flow_update", "flow_delete", "flow_run"] as const
const nativeScheduleTools = ["schedule_create", "schedule_list", "schedule_pause", "schedule_resume", "schedule_delete"] as const

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("Condition did not settle before timeout")
}

// One scheduling surface: the host removes the native schedule tools, so only the wakeup and Flow plugins' tools reach
// the model.
test(
  "the location registers the wakeup and Flow tools and not the native schedule tools",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-scheduling-"))
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              createRoutes(
                {
                  password: "secret",
                  database: { path: ":memory:" },
                  models: { fetch: false },
                  fs: { filewatcher: false },
                  config: { directory, project: false },
                },
                () => [],
                KiloHost.overrides,
              ).pipe(Layer.provide(HttpServer.layerServices)),
            )
            const locations = Context.get(context, LocationServiceMap.Service)
            const ref = LocationServiceMap.canonical(
              Location.Ref.make({ directory: AbsolutePath.make(directory) }),
            )
            const location = yield* locations.contextEffect(ref).pipe(Effect.scoped)
            yield* Context.get(location, Plugin.Service).awaitActivation
            const names = (yield* Context.get(location, Tool.Service).list()).map((tool) => tool.name).toSorted()
            for (const name of [...wakeupTools, ...flowTools]) expect(names).toContain(name)
            for (const name of nativeScheduleTools) expect(names).not.toContain(name)

            const skills = yield* Context.get(location, Skill.Service).list()
            // The policy is not a model-loadable skill.
            expect(skills.some((skill) => skill.id === "scheduling")).toBe(false)
            expect(skills.some((skill) => skill.id === "kilo-config")).toBe(true)
            // The upstream skills Kilo replaces must not compete with the Kilo guide.
            expect(skills.some((skill) => skill.id === "opencode")).toBe(false)
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)

test(
  "registers Flow and wakeup tools and fires a due Flow on the latest release channel with empty config",
  async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-scheduling-latest-")))
    const global = path.join(root, "global")
    const project = path.join(root, "project")
    try {
      await Promise.all([global, project].map((directory) => mkdir(directory, { recursive: true })))
      expect(await Bun.spawn(["git", "init", "-q", project]).exited).toBe(0)
      await writeFile(path.join(project, "README.md"), "release\n")
      expect(await Bun.spawn(["git", "-C", project, "add", "."]).exited).toBe(0)
      expect(
        await Bun.spawn([
          "git",
          "-C",
          project,
          "-c",
          "user.name=Flow Test",
          "-c",
          "user.email=flow@example.test",
          "commit",
          "-qm",
          "fixture",
        ]).exited,
      ).toBe(0)
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              createRoutes(
                {
                  password: "secret",
                  database: { path: ":memory:" },
                  models: { fetch: false },
                  fs: { filewatcher: false },
                  config: { directory: global, project: true },
                },
                () => [],
                [...KiloHost.overrides, App.node.replace(App.configured({ ...KiloApp, channel: "latest" }))],
              ).pipe(Layer.provide(HttpServer.layerServices), Layer.provide(Layer.succeed(Flag.Overrides, undefined))),
            )

            const locations = Context.get(context, LocationServiceMap.Service)
            const ref = LocationServiceMap.canonical(
              Location.Ref.make({ directory: AbsolutePath.make(project) }),
            )
            const location = yield* locations.contextEffect(ref)
            yield* Context.get(location, Plugin.Service).awaitActivation
            const names = (yield* Context.get(location, Tool.Service).list()).map((tool) => tool.name).toSorted()
            for (const name of [...wakeupTools, ...flowTools]) expect(names).toContain(name)
            for (const name of nativeScheduleTools) expect(names).not.toContain(name)

            const handler = Context.get(context, HttpRouter.HttpRouter)
              .asHttpEffect()
              .pipe(HttpEffect.toWebHandlerWith(context))
            const schedules = Context.get(context, Schedule.Service)
            const client = OpenCode.make({
              baseUrl: "http://kilo.local",
              headers: { authorization: `Basic ${btoa("opencode:secret")}` },
              fetch: Object.assign(
                async (input: string | URL | Request, init?: RequestInit) =>
                  handler(input instanceof Request ? input : new Request(input, init)),
                { preconnect: fetch.preconnect },
              ),
            })

            yield* Effect.promise(async () => {
              const source = await client.session.create({
                title: "Release source",
                location: { directory: project },
                agent: "build",
                model: { providerID: "kilo", id: "kilo-auto/free" },
              })
              const rpc = client.rpc(KiloFlowRpc.Definition)
              const creating = rpc.create(
                {
                  sourceSessionID: source.id,
                  name: "Release check",
                  when: { in: "10 millis" },
                  prompt: "Check release health",
                  worktree: "reuse",
                  permissions: [],
                },
                { location: { directory: project } },
              )
              const pending = await eventually(
                () => client.permission.request.list({ location: { directory: project } }),
                (result) => result.data.some((request) => request.action === "flow"),
              )
              const approval = pending.data.find((request) => request.action === "flow")
              if (!approval) throw new Error("Expected a pending Flow permission request")
              await client.permission.reply({
                sessionID: approval.sessionID,
                requestID: approval.id,
                decision: "once",
              })
              const created = await creating
              expect(created.status).toBe("active")

              await Bun.sleep(20)
              await Effect.runPromise(schedules.tick)

              const listed = await rpc.list({}, { location: { directory: project } })
              const fired = listed.flows.find((flow) => flow.name === "Release check")
              const runSessionID = fired?.latestRun?.sessionID
              expect(fired).toMatchObject({
                status: "completed",
                latestRun: expect.objectContaining({
                  status: expect.stringMatching(/^(running|succeeded|failed)$/),
                  sessionID: expect.any(String),
                }),
              })
              if (!runSessionID) throw new Error("Expected a Flow run Session")
              expect(runSessionID).not.toBe(source.id)
              const runSession = await client.session.get({ sessionID: runSessionID })
              expect(runSession.metadata?.[KiloFlowRpc.sessionMetadata]).toMatchObject({
                flowID: created.reference.type === "managed" ? created.reference.flowID : "",
              })
            })
          }),
        ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)
