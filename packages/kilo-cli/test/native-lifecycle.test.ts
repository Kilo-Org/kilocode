import { expect, test } from "bun:test"
import path from "node:path"
import { OpenCode, type OpenCodeEvent } from "@opencode-ai/client"
import { fixture, ready, type Fixture } from "./fixture"
import { run } from "../src/run"

type Completion = {
  stream?: boolean
  messages: { role: string; content?: unknown }[]
  tools?: { function: { name: string } }[]
}

function isPermissionAsked(
  event: OpenCodeEvent,
  sessionID: string,
): event is Extract<OpenCodeEvent, { type: "permission.asked" }> {
  return event.type === "permission.asked" && event.data.sessionID === sessionID
}

function answer(content: string, tool?: { name: string; arguments: string }) {
  const delta = tool
    ? { tool_calls: [{ index: 0, id: "call_native", type: "function", function: tool }] }
    : { role: "assistant", content }
  const frames = [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] },
  ]
  return new Response(
    frames
      .map(
        (frame) =>
          `data: ${JSON.stringify({ id: "native-proof", object: "chat.completion.chunk", model: "chat", created: 1, ...frame })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    {
      headers: { "content-type": "text/event-stream" },
    },
  )
}

async function boot(
  input: Fixture,
  baseURL: string,
  permissions: { action: string; resource: string; effect: "ask" }[] = [],
  timeout = 20000,
) {
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")], {
    cwd: input.cwd,
    env: {
      ...input.env,
      KILO_FIXTURE_CONFIG: JSON.stringify({
        model: "fixture/chat",
        permissions,
        providers: {
          fixture: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL, apiKey: "fixture" },
            models: { chat: {} },
          },
        },
      }),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  })
  const errors = new Response(child.stderr).text()
  try {
    const listening = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    const options = { baseUrl: listening.value, headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } }
    return {
      child,
      errors,
      client: OpenCode.make(options),
      reconnect: () => OpenCode.make(options),
      async [Symbol.asyncDispose]() {
        child.kill("SIGTERM")
        await child.exited
      },
    }
  } catch (error) {
    child.kill("SIGTERM")
    await child.exited
    throw new Error(`Interactive boot failed: ${await errors}`, { cause: error })
  }
}

async function within<T>(promise: Promise<T>, milliseconds = 8000) {
  const result = Promise.withResolvers<T>()
  const timer = setTimeout(() => result.reject(new Error(`Operation exceeded ${milliseconds}ms`)), milliseconds)
  promise.then(result.resolve, result.reject)
  try {
    return await result.promise
  } finally {
    clearTimeout(timer)
  }
}

async function waitFor<T>(fn: () => T | undefined, milliseconds = 8000): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < milliseconds) {
    const value = fn()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`waitFor timed out after ${milliseconds}ms`)
}

for (const auto of [false, true]) {
  test(`headless shell ${auto ? "allows once" : "rejects"} without changing saved policy`, async () => {
    await using input = await fixture()
    const model = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: Completion = await request.json()
        if (!body.stream)
          return Response.json({ choices: [{ message: { role: "assistant", content: "Headless fixture" } }] })
        if (body.messages.at(-1)?.role === "tool") return answer("Headless tool completed")
        return answer("", {
          name: "shell",
          arguments: JSON.stringify({
            command: "printf headless > headless.txt",
            description: "Write isolated fixture",
          }),
        })
      },
    })
    try {
      await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
        { action: "shell", resource: "*", effect: "ask" },
      ])
      const session = await host.client.session.create({
        location: { directory: input.cwd },
        model: { providerID: "fixture", id: "chat" },
      })
      const result = run(host.client, { sessionID: session.id, directory: input.cwd, text: "Write the fixture", auto })
      if (!auto) {
        await expect(within(result)).rejects.toThrow("Permission requested")
        expect(await Bun.file(path.join(input.cwd, "headless.txt")).exists()).toBe(false)
      } else {
        expect((await within(result)).text).toBe("Headless tool completed")
        expect(await Bun.file(path.join(input.cwd, "headless.txt")).text()).toBe("headless")
        await expect(
          within(run(host.client, { sessionID: session.id, directory: input.cwd, text: "Write the fixture again" })),
        ).rejects.toThrow("Permission requested")
      }
      expect(await host.client.session.active()).toEqual({})
    } finally {
      await model.stop(true)
    }
  })
}

test("headless run cancels questions even with explicit auto approval", async () => {
  await using input = await fixture()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: Completion = await request.json()
      if (!body.stream)
        return Response.json({ choices: [{ message: { role: "assistant", content: "Question fixture" } }] })
      return answer("", {
        name: "question",
        arguments: JSON.stringify({
          questions: [
            {
              header: "Fixture",
              question: "Which option?",
              options: [{ label: "First", description: "Fixture option" }],
            },
          ],
        }),
      })
    },
  })
  try {
    await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`)
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      model: { providerID: "fixture", id: "chat" },
    })
    await expect(
      within(run(host.client, { sessionID: session.id, directory: input.cwd, text: "Ask a question", auto: true })),
    ).rejects.toThrow("headless runs cannot answer forms")
    expect(await host.client.form.list({ sessionID: session.id })).toEqual([])
    expect(await host.client.session.active()).toEqual({})
  } finally {
    await model.stop(true)
  }
})

test("headless cancellation interrupts execution and leaves the session resumable", async () => {
  await using input = await fixture()
  const started = Promise.withResolvers<void>()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: Completion = await request.json()
      if (!body.stream)
        return Response.json({ choices: [{ message: { role: "assistant", content: "Cancellation fixture" } }] })
      if (String([...body.messages].reverse().find((message) => message.role === "user")?.content).includes("Recover"))
        return answer("Recovered headless response")
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ id: "held", object: "chat.completion.chunk", model: "chat", created: 1, choices: [{ index: 0, delta: { role: "assistant", content: "Partial fixture" }, finish_reason: null }] })}\n\n`,
              ),
            )
            started.resolve()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  try {
    await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`)
    const session = await host.client.session.create({
      location: { directory: input.cwd },
      model: { providerID: "fixture", id: "chat" },
    })
    const controller = new AbortController()
    const result = run(
      host.client,
      { sessionID: session.id, directory: input.cwd, text: "Start streaming" },
      controller.signal,
    )
    const outcome = result.then(
      () => undefined,
      (error: unknown) => error,
    )
    await within(started.promise)
    await expect(
      run(host.client, { sessionID: session.id, directory: input.cwd, text: "Do not replace active work" }),
    ).rejects.toThrow("already running")
    expect((await host.client.session.active())[session.id]).toBeDefined()
    controller.abort(new Error("Fixture cancellation"))
    expect(await within(outcome)).toMatchObject({ message: "Fixture cancellation" })
    expect(await host.client.session.active()).toEqual({})
    expect((await host.client.session.get({ sessionID: session.id })).outcome).toBe("interrupted")
    expect(
      (await within(run(host.client, { sessionID: session.id, directory: input.cwd, text: "Recover this session" })))
        .text,
    ).toBe("Recovered headless response")
  } finally {
    await model.stop(true)
  }
})

for (const reply of ["once", "always", "reject"] as const) {
  test(`native shell honors ${reply} permission through the public contract`, async () => {
    await using input = await fixture()
    const executed = path.join(input.cwd, "permission-proof.txt")
    const secondExecuted = path.join(input.cwd, "second-proof.txt")
    const tools: string[] = []
    const model = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: Completion = await request.json()
        if (!body.stream)
          return Response.json({ choices: [{ message: { role: "assistant", content: "Native permission fixture" } }] })
        const lastMessage = body.messages[body.messages.length - 1]
        const lastUser = [...body.messages].reverse().find((message) => message.role === "user")?.content
        if (lastMessage?.role === "tool") {
          return answer(
            String(lastUser).includes("second")
              ? "Second permission decision observed"
              : "Permission decision observed",
          )
        }
        tools.push(...(body.tools ?? []).map((tool) => tool.function.name))
        if (String(lastUser).includes("second")) {
          return answer("", {
            name: "shell",
            arguments: JSON.stringify({
              command: "printf second-proof > second-proof.txt",
              description: "Write second fixture",
            }),
          })
        }
        return answer("", {
          name: "shell",
          arguments: JSON.stringify({
            command: "printf permission-proof > permission-proof.txt",
            description: "Write an isolated permission fixture",
          }),
        })
      },
    })
    try {
      await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
        { action: "shell", resource: "*", effect: "ask" },
      ])
      const client = host.client
      const session = await client.session.create({
        location: { directory: input.cwd },
        model: { providerID: "fixture", id: "chat" },
      })
      const controller = new AbortController()
      const events: OpenCodeEvent[] = []
      const pump = (async () => {
        try {
          for await (const event of client.event.subscribe({ signal: controller.signal })) {
            events.push(event)
          }
        } catch {}
      })()
      try {
        await client.session.prompt({ sessionID: session.id, text: "Use the shell for this isolated fixture" })
        const permission = await waitFor(() => events.find((event) => isPermissionAsked(event, session.id))?.data)
        expect(tools).toContain("shell")
        expect(permission.action).toBe("shell")
        expect(await Bun.file(executed).exists()).toBe(false)
        expect(
          (await client.permission.list({ sessionID: session.id })).some((request) => request.id === permission.id),
        ).toBe(true)
        await client.permission.reply({ sessionID: session.id, requestID: permission.id, reply })
        await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(8000) })
        expect(await client.session.active()).toEqual({})
        const allowed = reply === "once" || reply === "always"
        expect(await Bun.file(executed).exists()).toBe(allowed)
        if (allowed) expect(await Bun.file(executed).text()).toBe("permission-proof")
        const messages = JSON.stringify(await client.message.list({ sessionID: session.id }))
        expect(messages).toContain(allowed ? "Permission decision observed" : "The user declined this tool call")

        if (reply === "always") {
          const askCount = events.filter((event) => isPermissionAsked(event, session.id)).length
          await client.session.prompt({ sessionID: session.id, text: "Run second command" })
          await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(8000) })
          expect(await client.session.active()).toEqual({})
          expect(await Bun.file(secondExecuted).exists()).toBe(true)
          expect(await Bun.file(secondExecuted).text()).toBe("second-proof")
          expect(events.filter((event) => isPermissionAsked(event, session.id)).length).toBe(askCount)
          const secondMessages = JSON.stringify(await client.message.list({ sessionID: session.id }))
          expect(secondMessages).toContain("Second permission decision observed")
        }
      } finally {
        controller.abort()
        await pump.catch(() => undefined)
      }
    } finally {
      await model.stop(true)
    }
  })
}

test("native shell handles interruption while waiting for permission and continues cleanly", async () => {
  await using input = await fixture()
  const executed = path.join(input.cwd, "permission-proof.txt")
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: Completion = await request.json()
      if (!body.stream)
        return Response.json({ choices: [{ message: { role: "assistant", content: "Native permission fixture" } }] })
      const lastUser = [...body.messages].reverse().find((message) => message.role === "user")?.content
      if (String(lastUser).includes("Recovered prompt")) {
        return answer("Recovered answer without tools")
      }
      if (body.messages.some((message) => message.role === "tool")) return answer("Permission decision observed")
      return answer("", {
        name: "shell",
        arguments: JSON.stringify({
          command: "printf permission-proof > permission-proof.txt",
          description: "Write an isolated permission fixture",
        }),
      })
    },
  })
  try {
    await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
      { action: "shell", resource: "*", effect: "ask" },
    ])
    const client = host.client
    const session = await client.session.create({
      location: { directory: input.cwd },
      model: { providerID: "fixture", id: "chat" },
    })
    const controller = new AbortController()
    const events: OpenCodeEvent[] = []
    const pump = (async () => {
      try {
        for await (const event of client.event.subscribe({ signal: controller.signal })) {
          events.push(event)
        }
      } catch {}
    })()
    try {
      await client.session.prompt({ sessionID: session.id, text: "Use the shell for this isolated fixture" })
      const permission = await waitFor(() => events.find((event) => isPermissionAsked(event, session.id))?.data)
      expect(permission.action).toBe("shell")
      expect(await Bun.file(executed).exists()).toBe(false)
      expect(
        (await client.permission.list({ sessionID: session.id })).some((request) => request.id === permission.id),
      ).toBe(true)

      await client.session.interrupt({ sessionID: session.id })
      await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(8000) })
      expect(await client.session.active()).toEqual({})
      expect(await Bun.file(executed).exists()).toBe(false)
      expect(await client.permission.list({ sessionID: session.id })).toEqual([])

      await client.session.prompt({ sessionID: session.id, text: "Recovered prompt" })
      await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(8000) })
      expect(await client.session.active()).toEqual({})
      const messages = JSON.stringify(await client.message.list({ sessionID: session.id }))
      expect(messages).toContain("Recovered answer without tools")
    } finally {
      controller.abort()
      await pump.catch(() => undefined)
    }
  } finally {
    await model.stop(true)
  }
})

test("native shell handles reconnect while waiting for permission and completes step", async () => {
  await using input = await fixture()
  const executed = path.join(input.cwd, "permission-proof.txt")
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: Completion = await request.json()
      if (!body.stream)
        return Response.json({ choices: [{ message: { role: "assistant", content: "Native permission fixture" } }] })
      if (body.messages.some((message) => message.role === "tool")) return answer("Permission decision observed")
      return answer("", {
        name: "shell",
        arguments: JSON.stringify({
          command: "printf permission-proof > permission-proof.txt",
          description: "Write an isolated permission fixture",
        }),
      })
    },
  })
  try {
    await using host = await boot(input, `http://127.0.0.1:${model.port}/v1`, [
      { action: "shell", resource: "*", effect: "ask" },
    ])
    const client = host.client
    const session = await client.session.create({
      location: { directory: input.cwd },
      model: { providerID: "fixture", id: "chat" },
    })
    const controller = new AbortController()
    const events = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    try {
      await within(events.next())
      await client.session.prompt({ sessionID: session.id, text: "Use the shell for this isolated fixture" })
      const permission = await within(
        (async () => {
          while (true) {
            const next = await events.next()
            if (next.done) throw new Error("Event stream ended before permission")
            if (next.value.type === "permission.asked" && next.value.data.sessionID === session.id)
              return next.value.data
          }
        })(),
      )
      expect(permission.action).toBe("shell")
      expect(await Bun.file(executed).exists()).toBe(false)

      const reconnected = host.reconnect()
      const pending = await reconnected.permission.list({ sessionID: session.id })
      expect(pending.some((request) => request.id === permission.id)).toBe(true)
      await reconnected.permission.reply({ sessionID: session.id, requestID: permission.id, reply: "once" })
      await reconnected.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(8000) })
      expect(await reconnected.session.active()).toEqual({})
      expect(await Bun.file(executed).exists()).toBe(true)
      expect(await Bun.file(executed).text()).toBe("permission-proof")
      const messages = JSON.stringify(await reconnected.message.list({ sessionID: session.id }))
      expect(messages).toContain("Permission decision observed")
    } finally {
      controller.abort()
      await events.return?.(undefined).catch(() => undefined)
    }
  } finally {
    await model.stop(true)
  }
})

for (const recovery of ["interrupt", "crash", "shutdown-export"] as const) {
  test(`native conversation survives ${recovery} and continues after reconnect`, async () => {
    await using input = await fixture()
    const started = Promise.withResolvers<void>()
    const resumed = Promise.withResolvers<void>()
    const mode = { hold: true }
    const model = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: Completion = await request.json()
        if (!body.stream)
          return Response.json({ choices: [{ message: { role: "assistant", content: "Native lifecycle fixture" } }] })
        if (!mode.hold) {
          resumed.resolve()
          return answer("Continued native response")
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ id: "held", object: "chat.completion.chunk", model: "chat", created: 1, choices: [{ index: 0, delta: { role: "assistant", content: "Partial fixture response" }, finish_reason: null }] })}\n\n`,
                ),
              )
              started.resolve()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    try {
      await using first = await boot(input, `http://127.0.0.1:${model.port}/v1`)
      const session = await first.client.session.create({
        location: { directory: input.cwd },
        model: { providerID: "fixture", id: "chat" },
      })
      await first.client.session.prompt({ sessionID: session.id, text: "Start an isolated streaming response" })
      await within(started.promise)
      mode.hold = false
      if (recovery === "interrupt") {
        await first.client.session.interrupt({ sessionID: session.id })
        await first.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(8000) })
        expect(await first.client.session.active()).toEqual({})
        const reconnected = first.reconnect()
        await reconnected.session.prompt({ sessionID: session.id, text: "Continue with a new response" })
        await within(resumed.promise)
        await reconnected.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(8000) })
        expect(JSON.stringify(await reconnected.message.list({ sessionID: session.id }))).toContain(
          "Continued native response",
        )
        return
      }
      first.child.kill(recovery === "crash" ? "SIGKILL" : "SIGTERM")
      await first.child.exited
      if (recovery === "shutdown-export") {
        // A read-only command must preserve the execution claim without attempting recovery.
        const exported = Bun.spawn(
          [
            process.execPath,
            "--no-env-file",
            "--preload",
            "@opentui/solid/preload",
            path.resolve(import.meta.dir, "../src/tui-preview.ts"),
            "export",
            session.id,
          ],
          {
            cwd: path.resolve(import.meta.dir, ".."),
            env: input.env,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            timeout: 20000,
          },
        )
        const [code, stdout, stderr] = await Promise.all([
          exported.exited,
          new Response(exported.stdout).text(),
          new Response(exported.stderr).text(),
        ])
        expect(code, stderr).toBe(0)
        expect(JSON.parse(stdout).info.id).toBe(session.id)
      }
      await using second = await boot(input, `http://127.0.0.1:${model.port}/v1`, [], 120000)
      await within(resumed.promise)
      await second.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(8000) })
      expect(await second.client.session.active()).toEqual({})
      expect(JSON.stringify(await second.client.message.list({ sessionID: session.id }))).toContain(
        "Continued native response",
      )
    } finally {
      await model.stop(true)
    }
  }, 120000)
}
