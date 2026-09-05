import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fixture, ready } from "./fixture"

const directory = path.resolve(import.meta.dir, "..")

type Frame = Record<string, unknown>

export type Reply<T> = { readonly id: number; readonly result?: T; readonly error?: { readonly message?: string } }

export type Bridge = ReturnType<typeof connect>

// One artifact per test process: the build copies a Bun runtime next to the bundle.
let building: Promise<string> | undefined

export function artifact() {
  building ??= build()
  return building
}

/**
 * Boots the isolated Kilo preview host against a fake model, then runs the real
 * bridge launcher in a child process whose stdio is a pipe, so tests speak
 * newline-delimited JSON-RPC to the production entrypoint.
 */
export async function acpFixture(options: { readonly reply?: string } = {}) {
  const built = await artifact()
  const input = await fixture()
  const model = fakeModel(options.reply ?? "Fixture ACP response")
  try {
    const env = {
      ...input.env,
      KILO_FIXTURE_CONFIG: JSON.stringify({
        model: "fixture/chat",
        providers: {
          fixture: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
            models: { chat: {} },
          },
        },
      }),
    }
    const host = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")], {
      cwd: input.cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    })
    const errors = new Response(host.stderr).text()
    const url = await ready(host.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/).catch(async (error: unknown) => {
      throw new Error(`${String(error)}\n${await errors}`)
    })
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    const bridge = spawnBridge({
      cwd: input.cwd,
      env: { ...env, KILO_ACP_TEST_URL: url.value, KILO_ACP_TEST_PASSWORD: password, KILO_ACP_TEST_ARTIFACT: built },
    })
    return {
      cwd: input.cwd,
      url: url.value,
      password,
      model,
      bridge,
      hostErrors: () => errors,
      async [Symbol.asyncDispose]() {
        const results = await Promise.allSettled([
          bridge[Symbol.asyncDispose](),
          stopHost(host),
          model.stop(),
          input[Symbol.asyncDispose](),
        ])
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected")
        if (failure) throw failure.reason
      },
    }
  } catch (error) {
    await model.stop()
    await input[Symbol.asyncDispose]()
    throw error
  }
}

export function ok<T>(reply: Reply<T>) {
  if (reply.error) throw new Error(`ACP request failed: ${JSON.stringify(reply.error)}`)
  if (reply.result === undefined) throw new Error("ACP response carried no result")
  return reply.result
}

export function initialize(bridge: Bridge) {
  return bridge
    .request<{
      protocolVersion: number
      agentCapabilities?: { loadSession?: boolean }
      agentInfo?: { name: string; title?: string | null; version: string }
      authMethods?: { id: string; name: string; description?: string | null; _meta?: Frame | null }[]
    }>("initialize", {
      protocolVersion: 1,
      clientCapabilities: { _meta: { "terminal-auth": true } },
      clientInfo: { name: "kilo-acp-test", version: "0.0.0" },
    })
    .then(ok)
}

export function newSession(bridge: Bridge, cwd: string) {
  return bridge.request<{ sessionId: string; configOptions?: Frame[] }>("session/new", { cwd, mcpServers: [] }).then(ok)
}

function spawnBridge(input: { readonly cwd: string; readonly env: Record<string, string | undefined> }) {
  return connect(
    Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "acp-entry.ts")], {
      cwd: input.cwd,
      env: input.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
}

/** Speaks newline-delimited JSON-RPC to any process that serves ACP over stdio. */
export function connect(child: Bun.Subprocess<"pipe", "pipe", "pipe">) {
  const encoder = new TextEncoder()
  const pending: Frame[] = []
  const waiters: { readonly predicate: (frame: Frame) => boolean; readonly resolve: (frame: Frame) => void }[] = []
  let stdout = ""
  let stderr = ""
  let failure: Error | undefined
  let identifier = 0
  let closed = false

  const dispatch = (frame: Frame) => {
    const index = waiters.findIndex((waiter) => waiter.predicate(frame))
    if (index === -1) {
      pending.push(frame)
      return
    }
    waiters.splice(index, 1)[0].resolve(frame)
  }
  const reading = (async () => {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let buffered = ""
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
      const text = decoder.decode(chunk.value, { stream: true })
      stdout += text
      buffered += text
      while (true) {
        const newline = buffered.indexOf("\n")
        if (newline === -1) break
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (!line) continue
        const parsed: unknown = JSON.parse(line)
        if (!isFrame(parsed)) throw new Error(`The ACP bridge wrote a non-object message: ${line}`)
        dispatch(parsed)
      }
    }
  })().catch((error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error))
  })
  const collecting = (async () => {
    const reader = child.stderr.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
      stderr += decoder.decode(chunk.value, { stream: true })
    }
  })()

  const take = (predicate: (frame: Frame) => boolean, description: string, timeoutMs: number) => {
    const buffered = pending.findIndex(predicate)
    if (buffered !== -1) return Promise.resolve(pending.splice(buffered, 1)[0])
    if (failure) return Promise.reject(failure)
    return new Promise<Frame>((resolve, reject) => {
      const waiter = { predicate, resolve }
      waiters.push(waiter)
      setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index === -1) return
        waiters.splice(index, 1)
        reject(new Error(`Timed out waiting for ${description}: ${stderr}`))
      }, timeoutMs).unref()
    })
  }
  const write = async (frame: Frame) => {
    if (closed) throw new Error("The ACP bridge stdin is closed")
    child.stdin.write(encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`))
    await child.stdin.flush()
  }

  return {
    async request<T>(method: string, params?: unknown) {
      const id = ++identifier
      await write(params === undefined ? { id, method } : { id, method, params })
      const frame = await take((frame) => frame.id === id && !("method" in frame), `the ${method} response`, 60_000)
      if (!isReply<T>(frame)) throw new Error(`Malformed ACP response: ${JSON.stringify(frame)}`)
      return frame
    },
    notify: (method: string, params?: unknown) => write({ method, params }),
    waitFor: (method: string, predicate: (params: Frame) => boolean, timeoutMs = 60_000) =>
      take(
        (frame) => frame.method === method && !("id" in frame) && predicate(isFrame(frame.params) ? frame.params : {}),
        `the ${method} notification`,
        timeoutMs,
      ),
    async endStdin() {
      closed = true
      await child.stdin.end()
      const code = await child.exited
      await Promise.all([reading, collecting])
      return code
    },
    output: () => ({ stdout, stderr }),
    async [Symbol.asyncDispose]() {
      closed = true
      await Promise.resolve(child.stdin.end()).catch(() => undefined)
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
      await Promise.all([reading, collecting])
    },
  }
}

export function fakeModel(text: string) {
  const requests: { readonly stream: boolean; readonly body: string }[] = []
  let gate: { readonly marker: string; readonly promise: Promise<void>; readonly release: () => void } | undefined
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body = await request.text()
      const parsed: { stream?: boolean } = JSON.parse(body)
      requests.push({ stream: parsed.stream === true, body })
      if (!parsed.stream) {
        return Response.json({
          id: "fixture",
          object: "chat.completion",
          created: 1,
          model: "chat",
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      }
      const held = gate && body.includes(gate.marker) ? gate.promise : undefined
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder()
            const send = (frame: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
            const chunk = (choices: unknown, usage?: unknown) => ({
              id: "fixture",
              object: "chat.completion.chunk",
              created: 1,
              model: "chat",
              choices,
              ...(usage ? { usage } : {}),
            })
            send(chunk([{ index: 0, delta: { role: "assistant" }, finish_reason: null }]))
            if (held) await held
            // An interrupted turn cancels this response stream while it is held.
            try {
              send(chunk([{ index: 0, delta: { content: text }, finish_reason: null }]))
              send(
                chunk([{ index: 0, delta: {}, finish_reason: "stop" }], {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2,
                }),
              )
              controller.enqueue(encoder.encode("data: [DONE]\n\n"))
              controller.close()
            } catch {
              return
            }
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  return {
    port: server.port,
    requests,
    hold(marker: string) {
      const waiter = Promise.withResolvers<void>()
      gate = { marker, promise: waiter.promise, release: waiter.resolve }
    },
    release() {
      gate?.release()
      gate = undefined
    },
    async stop() {
      gate?.release()
      await server.stop(true)
    },
  }
}

async function build() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "kilo-acp-artifact-"))
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(directory, "script/build-acp.ts"), outdir], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code !== 0) {
    await rm(outdir, { recursive: true, force: true })
    throw new Error(`Failed to build the ACP bridge artifact (${code}): ${stdout}${stderr}`)
  }
  return outdir
}

function isFrame(value: unknown): value is Frame {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isReply<T>(frame: Frame): frame is Frame & Reply<T> {
  return typeof frame.id === "number" && !("method" in frame)
}

async function stopHost(host: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  if (host.exitCode === null) host.kill("SIGTERM")
  const code = await host.exited
  if (code !== 0 && host.signalCode !== "SIGTERM") throw new Error(`The preview host exited with ${code}`)
}
