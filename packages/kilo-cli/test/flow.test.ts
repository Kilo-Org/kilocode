import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Schedule } from "@opencode/core/schedule"
import { KiloFlowRpc } from "@opencode/schema/kilocode/flow"
import { Session } from "@opencode/schema/session"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer, References } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 10_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("The Flow permission request did not appear")
}

test("lists local schedules and creates managed definitions through the Kilo Flow RPC", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-flow-rpc-"))
  const global = path.join(root, "global")
  const projects = [path.join(root, "first"), path.join(root, "second")]
  const nested = path.join(projects[0]!, "packages", "app")
  try {
    await Promise.all([global, ...projects, nested].map((directory) => mkdir(directory, { recursive: true })))
    await Promise.all(
      projects.map((directory, index) =>
        writeFile(
          path.join(directory, "kilo2.json"),
          JSON.stringify({
            experimental: { schedules: index === 1 },
            permission: { execute: "allow" },
            worktree: { directory: "../worktrees" },
          }),
        ),
      ),
    )
    for (const directory of projects) {
      const init = Bun.spawn(["git", "init", "-q", directory])
      expect(await init.exited).toBe(0)
      await writeFile(path.join(directory, "README.md"), path.basename(directory))
      if (directory === projects[0]) await writeFile(path.join(nested, "index.ts"), "export const ready = true\n")
      const add = Bun.spawn(["git", "-C", directory, "add", "."])
      expect(await add.exited).toBe(0)
      const commit = Bun.spawn([
        "git",
        "-C",
        directory,
        "-c",
        "user.name=Flow Test",
        "-c",
        "user.email=flow@example.test",
        "commit",
        "-qm",
        "fixture",
      ])
      expect(await commit.exited).toBe(0)
    }

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
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
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
            const first = await client.session.create({
              title: "First automation",
              location: { directory: nested },
              agent: "build",
              model: { providerID: "kilo", id: "kilo-auto/free" },
              permissions: [{ action: "execute", resource: "*", effect: "allow" }],
            })
            const second = await client.session.create({
              title: "Second automation",
              location: { directory: projects[1]! },
              agent: "plan",
              model: { providerID: "kilo", id: "kilo-auto/free" },
              permissions: [{ action: "execute", resource: "*", effect: "allow" }],
            })
            const time = await Effect.runPromise(
              schedules.create(
                {
                  sessionID: Session.ID.make(first.id),
                  name: "Daily cleanup",
                  when: { type: "cron", cron: "0 9 * * *", tz: "America/Detroit" },
                  action: { type: "prompt", prompt: "Clean the project" },
                },
                { requireEnabled: false },
              ),
            )
            const poll = await client.experimental.schedule.create({
              sessionID: second.id,
              name: "Wait for release",
              when: { every: "1 hour" },
              if: { code: "return false" },
              prompt: "Publish the release",
            })

            const rpc = client.rpc(KiloFlowRpc.Definition)
            const output = await rpc.list({}, { location: { directory: nested } })
            expect(output.warnings).toEqual([])
            expect(output.flows).toHaveLength(2)
            expect(output.flows).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  reference: { type: "native-schedule", scheduleID: time.id },
                  trigger: expect.objectContaining({ type: "time" }),
                  context: expect.objectContaining({
                    directory: nested,
                    sessionID: first.id,
                    model: expect.objectContaining({ providerID: "kilo", id: "kilo-auto/free" }),
                    agent: "build",
                  }),
                }),
                expect.objectContaining({
                  reference: { type: "native-schedule", scheduleID: poll.id },
                  trigger: expect.objectContaining({ type: "poll", mode: "if" }),
                  context: expect.objectContaining({ directory: projects[1], sessionID: second.id, agent: "plan" }),
                }),
              ]),
            )
            expect(new Set(output.flows.map((flow) => flow.context.projectID)).size).toBe(2)

            const permissions = [{ action: "shell", resource: "git status *" }]
            const creating = rpc.create(
              {
                sourceSessionID: first.id,
                name: "Weekly maintenance",
                when: { cron: "0 10 * * 1", tz: "America/Detroit" },
                prompt: "Review and update dependencies",
                worktree: "new",
                permissions,
              },
              { location: { directory: nested } },
            )
            const pending = await eventually(
              () => client.permission.request.list({ location: { directory: nested } }),
              (result) => result.data.some((request) => request.action === "flow"),
            )
            expect(pending.data).toContainEqual(
              expect.objectContaining({
                sessionID: first.id,
                action: "flow",
                resources: ["shell: git status *"],
                message: "Approve this Flow's unattended permissions:\n- shell: git status *",
                metadata: {
                  "kilocode.flow": expect.objectContaining({
                    name: "Weekly maintenance",
                    permissions,
                    unattended: true,
                  }),
                },
              }),
            )
            const approval = pending.data.find((request) => request.action === "flow")
            if (!approval) throw new Error("Expected a pending Flow permission request")
            await client.permission.reply({
              sessionID: approval.sessionID,
              requestID: approval.id,
              decision: "once",
            })
            const created = await creating
            expect(created).toMatchObject({
              reference: { type: "managed", scheduleID: expect.any(String) },
              name: "Weekly maintenance",
              trigger: { type: "time", when: { type: "cron", cron: "0 10 * * 1" } },
              execution: { type: "local", mode: "fresh", sourceSessionID: first.id, worktree: "new" },
              context: {
                directory: nested,
                projectID: first.projectID,
                sessionID: first.id,
                model: { providerID: "kilo", id: "kilo-auto/free" },
                agent: "build",
              },
              prompt: "Review and update dependencies",
              permissions,
              status: "active",
              nextRunAt: expect.any(Number),
              health: { status: "healthy" },
            })
            const creatingToolFree = rpc.create(
              {
                sourceSessionID: first.id,
                name: "Tool-free reminder",
                when: { in: "10 millis" },
                prompt: "Summarize the existing context without tools",
                worktree: "reuse",
                permissions: [],
              },
              { location: { directory: nested } },
            )
            const toolFreeApproval = await eventually(
              () => client.permission.request.list({ location: { directory: nested } }),
              (result) => result.data.some((request) => request.resources.includes("no unattended tool permissions")),
            ).then((result) =>
              result.data.find((request) => request.resources.includes("no unattended tool permissions")),
            )
            if (!toolFreeApproval) throw new Error("Expected a tool-free Flow permission request")
            await client.permission.reply({
              sessionID: toolFreeApproval.sessionID,
              requestID: toolFreeApproval.id,
              decision: "once",
            })
            const toolFree = await creatingToolFree
            expect(toolFree).toMatchObject({ name: "Tool-free reminder", permissions: [], status: "active" })
            await Bun.sleep(20)
            await Effect.runPromise(schedules.tick)
            expect((await client.message.list({ sessionID: first.id })).data).toEqual([])
            expect((await rpc.list({}, { location: { directory: nested } })).flows).toContainEqual(
              expect.objectContaining({
                name: "Tool-free reminder",
                status: "completed",
                lastOutcome: expect.stringMatching(/^(fired|succeeded|failed)$/),
                latestRun: expect.objectContaining({
                  status: expect.stringMatching(/^(running|succeeded|failed)$/),
                  scheduled: expect.objectContaining({ scheduleID: toolFree.reference.scheduleID }),
                }),
              }),
            )
            const refreshed = await rpc.list({}, { location: { directory: nested } })
            expect(refreshed.flows).toContainEqual(created)

            const rejected = rpc.create(
              {
                sourceSessionID: first.id,
                name: "Rejected maintenance",
                when: { every: "1 day" },
                prompt: "Run an unapproved command",
                worktree: "reuse",
                permissions: [{ action: "shell", resource: "rm *" }],
              },
              { location: { directory: nested } },
            )
            const rejection = await eventually(
              () => client.permission.request.list({ location: { directory: nested } }),
              (result) => result.data.some((request) => request.resources.includes("shell: rm *")),
            ).then((result) => result.data.find((request) => request.resources.includes("shell: rm *")))
            if (!rejection) throw new Error("Expected a rejectable Flow permission request")
            await client.permission.reply({
              sessionID: rejection.sessionID,
              requestID: rejection.id,
              decision: "reject",
            })
            await expect(rejected).rejects.toThrow()
            expect(
              (await rpc.list({}, { location: { directory: nested } })).flows.some(
                (flow) => flow.name === "Rejected maintenance",
              ),
            ).toBeFalse()

            if (created.reference.type !== "managed") throw new Error("Expected a managed Flow")
            await expect(
              rpc.run({ flowID: created.reference.flowID }, { location: { directory: projects[1]! } }),
            ).rejects.toThrow(`Flow ${created.reference.flowID} does not exist`)
            const execution = await rpc.run({ flowID: created.reference.flowID }, { location: { directory: nested } })
            expect(execution.flowID).toBe(created.reference.flowID)
            expect(execution.status).toBe("running")
            expect(execution.worktree).toBe("new")
            expect(typeof execution.sessionID).toBe("string")
            expect(typeof execution.directory).toBe("string")
            expect(execution.directory).not.toBe(nested)
            expect(execution.directory?.endsWith(path.join("packages", "app"))).toBeTrue()
            if (!execution.sessionID || !execution.directory) throw new Error("Expected a started Flow run")
            expect(await client.session.get({ sessionID: execution.sessionID })).toMatchObject({
              id: execution.sessionID,
              title: "Flow: Weekly maintenance",
              location: { directory: execution.directory },
              metadata: {
                "kilocode.flow": { flowID: created.reference.flowID, runID: execution.id },
              },
              permissions: [
                { action: "*", resource: "*", effect: "deny" },
                { action: "shell", resource: "git status *", effect: "allow" },
              ],
            })
            const withRun = await rpc.list({}, { location: { directory: nested } })
            expect(withRun.flows).toContainEqual(
              expect.objectContaining({
                reference: expect.objectContaining({ type: "managed", flowID: created.reference.flowID }),
                lastRunAt: execution.time.started,
                latestRun: expect.objectContaining({
                  id: execution.id,
                  sessionID: execution.sessionID,
                }),
              }),
            )
          })
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
