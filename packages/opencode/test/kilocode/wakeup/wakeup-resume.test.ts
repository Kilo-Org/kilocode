import { afterAll, describe, expect, test } from "bun:test"
import fs from "fs"
import { remove as cleanup } from "../cleanup"
import os from "os"
import path from "path"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef } from "@/effect/instance-ref"
import { GoalInstructions } from "@/kilocode/session/goal/instructions"
import { GoalLink } from "@/kilocode/session/goal/link"
import { GoalState } from "@/kilocode/session/goal/state"
import { Wakeup } from "@/kilocode/wakeup"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { pollWithTimeout } from "../../lib/effect"

const saved = {
  id: ModelV2.ID.make("test-model"),
  providerID: ProviderV2.ID.make("test"),
}

const model = {
  name: "Test Model",
  tool_call: true,
  attachment: true,
  modalities: { input: ["text", "image"], output: ["text"] },
  limit: { context: 100000, output: 10000 },
}

// The exact `chat.completion.chunk` frame shape the other session tests use.
function line(input: unknown) {
  return `data: ${JSON.stringify(input)}\n\n`
}

function chunk(input: { delta?: Record<string, unknown>; finish?: string }) {
  return {
    id: "chatcmpl-wakeup-resume-test",
    object: "chat.completion.chunk",
    choices: [
      {
        delta: input.delta ?? {},
        ...(input.finish ? { finish_reason: input.finish } : {}),
      },
    ],
  }
}

function reply(text: string) {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode(line(chunk({ delta: { role: "assistant" } }))))
      ctrl.enqueue(enc.encode(line(chunk({ delta: { content: text } }))))
      ctrl.enqueue(enc.encode(line(chunk({ finish: "stop" }))))
      ctrl.enqueue(enc.encode("data: [DONE]\n\n"))
      ctrl.close()
    },
  })
}

function tool(name: string, input: unknown) {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode(line(chunk({ delta: { role: "assistant" } }))))
      ctrl.enqueue(
        enc.encode(
          line(
            chunk({
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call_${name}_${crypto.randomUUID()}`,
                    type: "function",
                    function: { name, arguments: "" },
                  },
                ],
              },
            }),
          ),
        ),
      )
      ctrl.enqueue(
        enc.encode(
          line(
            chunk({
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: JSON.stringify(input) },
                  },
                ],
              },
            }),
          ),
        ),
      )
      ctrl.enqueue(enc.encode(line(chunk({ finish: "tool_calls" }))))
      ctrl.enqueue(enc.encode("data: [DONE]\n\n"))
      ctrl.close()
    },
  })
}

function transcript(body: string) {
  try {
    return JSON.stringify((JSON.parse(body) as { messages?: unknown }).messages ?? [])
  } catch {
    return body
  }
}

// The runtime holds the wakeup timer's scope; dispose it once for the file.
afterAll(async () => {
  await AppRuntime.dispose()
})

function config(baseURL: string) {
  return JSON.stringify({
    model: "test/test-model",
    small_model: "test/test-model",
    enabled_providers: ["test"],
    formatter: false,
    lsp: false,
    provider: {
      test: {
        name: "Test",
        npm: "@ai-sdk/openai-compatible",
        options: { apiKey: "test-key", baseURL },
        models: { "test-model": model },
      },
    },
  })
}

describe("wakeup resume", () => {
  test("an armed wakeup fires, resumes the session with its prompt, and clears the entry", async () => {
    const bodies: string[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        bodies.push(await req.text())
        return new Response(reply("woke up"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-resume-"))
    try {
      await Bun.write(path.join(dir, "opencode.json"), config(`${server.url.origin}/v1`))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.create({ title: "Wakeup resume" })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      const info = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) =>
          wake.schedule({
            sessionID: session.id,
            directory: dir,
            prompt: "poll the deploy",
            when: new Date(Date.now() + 1200).toISOString(),
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await Effect.runPromise(
        pollWithTimeout(
          Effect.sync(() =>
            bodies.some((body) => body.includes("[scheduled wakeup]") && body.includes("poll the deploy"))
              ? true
              : undefined,
          ),
          "the wakeup prompt never reached the model",
          "8 seconds",
        ),
      )

      const pending = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) => wake.list({ sessionID: session.id })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )
      expect(pending.map((item) => item.id)).not.toContain(info.id)
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("a paused session logs the wakeup as unresumable instead of dropping it silently", async () => {
    const bodies: string[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        bodies.push(await req.text())
        return new Response(reply("woke up"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-paused-"))
    try {
      await Bun.write(path.join(dir, "opencode.json"), config(`${server.url.origin}/v1`))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.create({ title: "Wakeup paused" })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      // Abort the idle session through the same pause path the UI uses.
      await AppRuntime.runPromise(
        SessionPrompt.Service.use((svc) => svc.cancel(session.id)).pipe(Effect.provideService(InstanceRef, ctx)),
      )
      const paused = await AppRuntime.runPromise(
        SessionPrompt.Service.use((svc) => svc.paused(session.id)).pipe(Effect.provideService(InstanceRef, ctx)),
      )
      expect(paused).toBe(true)

      // The wakeup logger is a cached `Log.create` object, so patch the same
      // instance resume.ts holds; stderr is not reliable once another test
      // redirects the log stream to a file.
      const wakeLog = Log.create({ service: "wakeup" })
      const errors: Array<{ message?: unknown; extra?: Record<string, unknown> }> = []
      const originalLog = wakeLog.error.bind(wakeLog)
      wakeLog.error = ((message?: unknown, extra?: Record<string, unknown>) => {
        errors.push({ message, extra })
      }) as typeof wakeLog.error
      try {
        await AppRuntime.runPromise(
          Wakeup.Service.use((wake) =>
            wake.schedule({
              sessionID: session.id,
              directory: dir,
              prompt: "should be refused",
              when: new Date(Date.now() + 1200).toISOString(),
            }),
          ).pipe(Effect.provideService(InstanceRef, ctx)),
        )

        await Effect.runPromise(
          pollWithTimeout(
            Effect.sync(() =>
              errors.some(
                (entry) =>
                  entry.message === "wakeup could not resume session" && entry.extra?.reason === "session is paused",
              )
                ? true
                : undefined,
            ),
            "the paused wakeup was dropped without an error log",
            "8 seconds",
          ),
        )
      } finally {
        wakeLog.error = originalLog
      }

      // The wake never reached the model.
      expect(bodies.some((body) => body.includes("[scheduled wakeup]"))).toBe(false)
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("a fired wakeup for a waiting goal resumes the goal as a goal turn", async () => {
    const bodies: string[] = []
    const objective = "Improve the validation workflow"
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        const body = await req.text()
        bodies.push(body)
        if (body.includes("Generate a title")) {
          return new Response(reply("Title"), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
        }
        const history = transcript(body)
        const stream = history.includes("Report recorded")
          ? reply("Final report")
          : history.includes("[scheduled wakeup]") && history.includes("Continue working toward this session goal")
            ? tool("goal_report", { status: "complete", reason: "The deploy check passed." })
            : history.includes("Scheduled wakeup")
              ? reply("Scheduled the check")
              : tool("schedule_wakeup", {
                  prompt: "Check the deploy",
                  when: new Date(Date.now() + 3000).toISOString(),
                  reason: "deploy",
                })
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-goal-"))
    try {
      await Bun.write(path.join(dir, "opencode.json"), config(`${server.url.origin}/v1`))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.create({ title: "Wakeup goal" })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      await AppRuntime.runPromise(
        SessionPrompt.Service.use((svc) =>
          svc.command({
            sessionID: session.id,
            command: "goal",
            arguments: objective,
            agent: "code",
            model: "test/test-model",
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const read = () =>
        Session.Service.use((svc) => svc.get(session.id)).pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.map((value) => GoalState.read(value.metadata)),
        )

      await AppRuntime.runPromise(
        pollWithTimeout(
          read().pipe(Effect.map((goal) => (goal?.status === "waiting" ? goal : undefined))),
          "goal never reached waiting",
          "15 seconds",
        ),
      )

      await Effect.runPromise(
        pollWithTimeout(
          Effect.sync(() =>
            bodies.some(
              (body) =>
                body.includes("Continue working toward this session goal") &&
                body.includes(objective) &&
                body.includes("[scheduled wakeup]") &&
                body.includes("goal_report"),
            )
              ? true
              : undefined,
          ),
          "the fired wakeup did not resume as a goal turn",
          "15 seconds",
        ),
      )

      const done = await AppRuntime.runPromise(
        pollWithTimeout(
          read().pipe(Effect.map((goal) => (goal?.status === "complete" ? goal : undefined))),
          "goal never reached complete",
          "15 seconds",
        ),
      )
      expect(done.active).toBe(false)
      expect(done.text).toBe(objective)
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("a waiting goal with no in-memory handler resumes as a goal turn when its wakeup fires", async () => {
    const bodies: string[] = []
    const objective = "Improve the validation workflow"
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        const body = await req.text()
        bodies.push(body)
        if (body.includes("Generate a title")) {
          return new Response(reply("Title"), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
        }
        const history = transcript(body)
        const stream = history.includes("Report recorded")
          ? reply("Final report")
          : history.includes("[scheduled wakeup]") && history.includes("Continue working toward this session goal")
            ? tool("goal_report", { status: "complete", reason: "The deploy check passed." })
            : reply("Working")
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-restart-"))
    try {
      await Bun.write(path.join(dir, "opencode.json"), config(`${server.url.origin}/v1`))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.create({ title: "Wakeup restart", agent: "code", model: saved })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      const info = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) =>
          wake.schedule({
            sessionID: session.id,
            directory: dir,
            prompt: "poll the deploy",
            when: new Date(Date.now() + 1200).toISOString(),
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await AppRuntime.runPromise(
        Session.Service.use((svc) =>
          svc.setMetadata({
            sessionID: session.id,
            metadata: {
              "kilo.goal": {
                text: objective,
                status: "waiting",
                active: false,
                wait: { kind: "wakeup", id: info.id, label: "poll the deploy" },
              },
            },
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const read = () =>
        Session.Service.use((svc) => svc.get(session.id)).pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.map((value) => GoalState.read(value.metadata)),
        )

      await Effect.runPromise(
        pollWithTimeout(
          Effect.sync(() =>
            bodies.some(
              (body) =>
                body.includes("Continue working toward this session goal") &&
                body.includes(objective) &&
                body.includes("[scheduled wakeup]") &&
                body.includes("goal_report"),
            )
              ? true
              : undefined,
          ),
          "the fired wakeup did not resume as a goal turn",
          "15 seconds",
        ),
      )

      const done = await AppRuntime.runPromise(
        pollWithTimeout(
          read().pipe(Effect.map((goal) => (goal?.status === "complete" ? goal : undefined))),
          "goal never left waiting",
          "15 seconds",
        ),
      )
      expect(done.active).toBe(false)
      expect(done.text).toBe(objective)
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("cancelling the awaited wakeup resumes a waiting goal that has no in-memory handler", async () => {
    const bodies: string[] = []
    const objective = "Improve the validation workflow"
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        const body = await req.text()
        bodies.push(body)
        if (body.includes("Generate a title")) {
          return new Response(reply("Title"), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
        }
        const history = transcript(body)
        const stream = history.includes("Report recorded")
          ? reply("Final report")
          : history.includes("[cancelled]") && history.includes("Continue working toward this session goal")
            ? tool("goal_report", { status: "complete", reason: "Rescheduled after cancel." })
            : reply("Working")
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-cancel-restart-"))
    try {
      await Bun.write(path.join(dir, "opencode.json"), config(`${server.url.origin}/v1`))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) =>
          svc.create({ title: "Wakeup cancel restart", agent: "code", model: saved }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const info = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) =>
          wake.schedule({
            sessionID: session.id,
            directory: dir,
            prompt: "poll the deploy",
            when: new Date(Date.now() + 60_000).toISOString(),
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await AppRuntime.runPromise(
        Session.Service.use((svc) =>
          svc.setMetadata({
            sessionID: session.id,
            metadata: {
              "kilo.goal": {
                text: objective,
                status: "waiting",
                active: false,
                wait: { kind: "wakeup", id: info.id, label: "poll the deploy" },
              },
            },
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await AppRuntime.runPromise(
        Wakeup.Service.use((wake) => wake.cancel(info.id)).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const read = () =>
        Session.Service.use((svc) => svc.get(session.id)).pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.map((value) => GoalState.read(value.metadata)),
        )

      await Effect.runPromise(
        pollWithTimeout(
          Effect.sync(() =>
            bodies.some(
              (body) =>
                body.includes("Continue working toward this session goal") &&
                body.includes(objective) &&
                body.includes("[cancelled]") &&
                body.includes(info.id),
            )
              ? true
              : undefined,
          ),
          "cancel did not resume as a goal turn",
          "15 seconds",
        ),
      )

      const done = await AppRuntime.runPromise(
        pollWithTimeout(
          read().pipe(Effect.map((goal) => (goal && goal.status !== "waiting" ? goal : undefined))),
          "goal stayed waiting after cancel",
          "15 seconds",
        ),
      )
      expect(done.status).not.toBe("waiting")
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("a waiting goal that cannot resume settles paused with a readable reason", async () => {
    const bodies: string[] = []
    const objective = "Improve the validation workflow"
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        bodies.push(await req.text())
        return new Response(reply("should not run"), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-archived-"))
    try {
      await Bun.write(path.join(dir, "opencode.json"), config(`${server.url.origin}/v1`))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.create({ title: "Wakeup archived" })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      const info = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) =>
          wake.schedule({
            sessionID: session.id,
            directory: dir,
            prompt: "poll the deploy",
            when: new Date(Date.now() + 1200).toISOString(),
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await AppRuntime.runPromise(
        Session.Service.use((svc) =>
          svc.setMetadata({
            sessionID: session.id,
            metadata: {
              "kilo.goal": {
                text: objective,
                status: "waiting",
                active: false,
                wait: { kind: "wakeup", id: info.id, label: "poll the deploy" },
              },
            },
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.setArchived({ sessionID: session.id, time: Date.now() })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      const read = () =>
        Session.Service.use((svc) => svc.get(session.id)).pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.map((value) => GoalState.read(value.metadata)),
        )

      const settled = await AppRuntime.runPromise(
        pollWithTimeout(
          read().pipe(
            Effect.map((goal) =>
              goal?.status === "paused" && goal.reason?.includes("Restore this session") ? goal : undefined,
            ),
          ),
          "archived waiting goal was not settled with a readable reason",
          "15 seconds",
        ),
      )
      expect(settled.status).toBe("paused")
      expect(settled.reason).toContain("Restore this session")
      // The failed resume must undo hydrate's hold and wait record, or the
      // question tool stays filtered out for the paused goal and the wait leaks.
      expect(GoalState.hold(session.id)).toBe(false)
      expect(GoalLink.get(session.id)).toBeUndefined()
      expect(bodies.some((body) => body.includes("[scheduled wakeup]"))).toBe(false)
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("a fire during an in-flight goal turn queues onto the next goal cycle", async () => {
    const bodies: string[] = []
    const objective = "Improve the validation workflow"
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        const body = await req.text()
        bodies.push(body)
        if (body.includes("Generate a title")) {
          return new Response(reply("Title"), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
        }
        const history = transcript(body)
        const stream = history.includes("Report recorded")
          ? reply("Final report")
          : history.includes("[scheduled wakeup]") && history.includes("Continue working toward this session goal")
            ? tool("goal_report", { status: "complete", reason: "Resumed after the fire." })
            : history.includes("Hold the turn")
              ? reply("Slept")
              : tool("bash", {
                  command: `sleep 5 # goal-${crypto.randomUUID()}`,
                  description: "Hold the turn",
                })
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-inflight-"))
    try {
      const cfg = JSON.parse(config(`${server.url.origin}/v1`)) as Record<string, unknown>
      cfg.permission = { bash: "allow" }
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(cfg))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.create({ title: "Wakeup inflight" })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      await AppRuntime.runPromise(
        SessionPrompt.Service.use((svc) =>
          svc.command({
            sessionID: session.id,
            command: "goal",
            arguments: objective,
            agent: "code",
            model: "test/test-model",
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await AppRuntime.runPromise(
        pollWithTimeout(
          Effect.sync(() => (GoalState.active(session.id) ? true : undefined)),
          "goal never became active",
          "10 seconds",
        ),
      )

      // Absolute `when` is honored as given, so this fires in ~1.2s while the
      // bash sleep still holds the in-flight goal turn (no persisted wait yet).
      await AppRuntime.runPromise(
        Wakeup.Service.use((wake) =>
          wake.schedule({
            sessionID: session.id,
            directory: dir,
            prompt: "fired note",
            when: new Date(Date.now() + 1200).toISOString(),
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await Effect.runPromise(
        pollWithTimeout(
          Effect.sync(() =>
            bodies.some(
              (body) =>
                body.includes("Continue working toward this session goal") &&
                body.includes("[scheduled wakeup]") &&
                body.includes("fired note") &&
                body.includes("goal_report"),
            )
              ? true
              : undefined,
          ),
          "the in-flight fire did not resume as a goal turn",
          "15 seconds",
        ),
      )

      const stranger = bodies.filter((body) => {
        const history = transcript(body)
        return history.includes("[scheduled wakeup]") && !history.includes("Continue working toward this session goal")
      })
      expect(stranger).toEqual([])

      const done = await AppRuntime.runPromise(
        pollWithTimeout(
          Session.Service.use((svc) => svc.get(session.id)).pipe(
            Effect.provideService(InstanceRef, ctx),
            Effect.map((value) => {
              const goal = GoalState.read(value.metadata)
              return goal?.status === "complete" ? goal : undefined
            }),
          ),
          "goal never reached complete",
          "15 seconds",
        ),
      )
      expect(done.active).toBe(false)
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("cancelling the awaited wakeup leaves the session's other timers alone", async () => {
    const bodies: string[] = []
    const objective = "Improve the validation workflow"
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
        const body = await req.text()
        bodies.push(body)
        if (body.includes("Generate a title")) {
          return new Response(reply("Title"), {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
        }
        const history = transcript(body)
        // The cancelled wait resumes the goal, and this turn arms a new wait
        // instead of settling, so the session keeps the timers it already held.
        const stream = history.includes("Scheduled wakeup")
          ? reply("Scheduled the check")
          : history.includes("[cancelled]") && history.includes("Continue working toward this session goal")
            ? tool("schedule_wakeup", {
                prompt: "check again",
                when: new Date(Date.now() + 60_000).toISOString(),
                reason: "again",
              })
            : reply("Working")
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-cancel-others-"))
    try {
      await Bun.write(path.join(dir, "opencode.json"), config(`${server.url.origin}/v1`))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) =>
          svc.create({ title: "Wakeup cancel others", agent: "code", model: saved }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const awaited = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) =>
          wake.schedule({
            sessionID: session.id,
            directory: dir,
            prompt: "poll the deploy",
            when: new Date(Date.now() + 60_000).toISOString(),
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )
      const reminder = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) =>
          wake.schedule({
            sessionID: session.id,
            directory: dir,
            prompt: "user reminder",
            when: new Date(Date.now() + 60_000).toISOString(),
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await AppRuntime.runPromise(
        Session.Service.use((svc) =>
          svc.setMetadata({
            sessionID: session.id,
            metadata: {
              "kilo.goal": {
                text: objective,
                status: "waiting",
                active: false,
                wait: { kind: "wakeup", id: awaited.id, label: "poll the deploy" },
              },
            },
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      await AppRuntime.runPromise(
        Wakeup.Service.use((wake) => wake.cancel(awaited.id)).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const read = () =>
        Session.Service.use((svc) => svc.get(session.id)).pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.map((value) => GoalState.read(value.metadata)),
        )

      await AppRuntime.runPromise(
        pollWithTimeout(
          read().pipe(
            Effect.map((goal) => (goal?.status === "waiting" && goal.wait?.id !== awaited.id ? goal : undefined)),
          ),
          "the cancelled wait did not resume into a new goal wait",
          "15 seconds",
        ),
      )

      const pending = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) => wake.list({ sessionID: session.id })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )
      const ids = pending.map((item) => item.id)
      expect(ids).toContain(reminder.id)
      expect(ids).not.toContain(awaited.id)
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("removing a session's timers does not re-create the goal state release dropped", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("not found", { status: 404 }),
    })

    const base = fs.realpathSync(os.tmpdir())
    const dir = fs.mkdtempSync(path.join(base, "opencode-wakeup-remove-"))
    try {
      await Bun.write(path.join(dir, "opencode.json"), config(`${server.url.origin}/v1`))

      const ctx = await AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load({ directory: dir })))
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.create({ title: "Wakeup remove" })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      const info = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) =>
          wake.schedule({
            sessionID: session.id,
            directory: dir,
            prompt: "poll the deploy",
            when: new Date(Date.now() + 60_000).toISOString(),
          }),
        ).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const metadata = {
        "kilo.goal": {
          text: "Wait for the deploy to finish",
          status: "waiting",
          active: false,
          wait: { kind: "wakeup", id: info.id, label: "poll the deploy" },
        },
      }
      await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.setMetadata({ sessionID: session.id, metadata })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )

      // The goal loop hydrates a waiting session at boot, so its wait record is
      // live before the session is removed.
      GoalLink.hydrate(session.id, metadata)
      expect(GoalLink.get(session.id)).toMatchObject({ id: info.id })

      // Record any resume the bulk cancel tries, so a cancel notification that
      // re-hydrates the persisted waiting goal is observable rather than only
      // leaking state.
      const resumed: string[] = []
      GoalLink.bind(dir, (input) =>
        Effect.sync(() => {
          resumed.push(input.note ?? "")
        }),
      )

      // The removal path (KiloSession.cancelWakeups): drop the session's goal
      // link state, then cancel its timers through the bulk cancel.
      GoalLink.release(session.id)
      await AppRuntime.runPromise(
        Wakeup.Service.use((wake) => wake.cancelSession(session.id)).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      const pending = await AppRuntime.runPromise(
        Wakeup.Service.use((wake) => wake.list({ sessionID: session.id })).pipe(
          Effect.provideService(InstanceRef, ctx),
        ),
      )
      expect(pending).toEqual([])
      // The bulk cancel is teardown: it must not re-hydrate the released wait or
      // arm a goal whose session is being removed.
      expect(GoalLink.get(session.id)).toBeUndefined()
      expect(resumed).toEqual([])
      GoalLink.clear(session.id)
      GoalState.pause(session.id)
    } finally {
      await server.stop(true)
      await cleanup(dir)
    }
  }, 30_000)

  test("the timed-goal heuristic ignores a longer word that merely starts with one", () => {
    // The curb hides read/edit/bash, so "builder" or "buildings" must not read
    // as a deploy/build wait.
    expect(GoalInstructions.timed("Wait for the builder to finish")).toBe(false)
    expect(GoalInstructions.timed("wait for the buildings to render")).toBe(false)
    // The inflections that name the same event still count.
    expect(GoalInstructions.timed("Wait for the deploy to finish")).toBe(true)
    expect(GoalInstructions.timed("wait for the deployment to land")).toBe(true)
    expect(GoalInstructions.timed("wait for the builds to pass")).toBe(true)
    expect(GoalInstructions.timed("wait for the CI job")).toBe(true)
  })
})
