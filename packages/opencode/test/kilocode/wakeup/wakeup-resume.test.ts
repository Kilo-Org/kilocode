import { afterAll, describe, expect, test } from "bun:test"
import fs from "fs"
import { rm } from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { InstanceRef } from "@/effect/instance-ref"
import { Wakeup } from "@/kilocode/wakeup"
import { InstanceStore } from "@/project/instance-store"
import { Session } from "@/session/session"
import { pollWithTimeout } from "../../lib/effect"

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

// The runtime holds the wakeup timer's scope; dispose it once for the file.
afterAll(async () => {
  await AppRuntime.dispose()
})

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
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          model: "test/test-model",
          small_model: "test/test-model",
          enabled_providers: ["test"],
          formatter: false,
          lsp: false,
          provider: {
            test: {
              name: "Test",
              npm: "@ai-sdk/openai-compatible",
              options: { apiKey: "test-key", baseURL: `${server.url.origin}/v1` },
              models: { "test-model": model },
            },
          },
        }),
      )

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
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
