import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { spawn, type ChildProcess } from "child_process"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import crypto from "crypto"
import path from "path"

let mockLlm: ReturnType<typeof Bun.serve>
let server: ChildProcess
let port: number
let password: string
let client: ReturnType<typeof createKiloClient>

function startMockLlm(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/v1/models") {
        return Response.json({
          data: [{ id: "mock-model", object: "model", owned_by: "test" }],
        })
      }

      if (url.pathname === "/v1/chat/completions") {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            const chunk = {
              choices: [
                {
                  delta: { content: "Hello from mock LLM!" },
                  finish_reason: null,
                },
              ],
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))

            const done = {
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(done)}\n\n`))
            controller.enqueue(encoder.encode("data: [DONE]\n\n"))
            controller.close()
          },
        })
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream" },
        })
      }

      return new Response("Not found", { status: 404 })
    },
  })
}

function waitForPort(proc: ChildProcess, timeout = 30_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server start timeout")), timeout)
    proc.stdout?.on("data", (data: Buffer) => {
      const match = data.toString().match(/listening on http:\/\/[\w.]+:(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(parseInt(match[1]!))
      }
    })
    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`CLI process exited with code ${code} before server started`))
    })
  })
}

beforeAll(async () => {
  mockLlm = startMockLlm()
  password = crypto.randomBytes(32).toString("hex")

  const cliPath = path.resolve(import.meta.dir, "../../../../opencode/dist/kilo")

  // Configure kilo serve to use our mock provider via environment
  const config = JSON.stringify({
    provider: {
      mock: {
        models: {
          "mock-model": {
            name: "Mock Model",
            attachment: false,
            tool_call: true,
            cost: { input: 0, output: 0 },
            limit: { context: 128000, output: 4096 },
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: `http://localhost:${mockLlm.port}/v1`,
        },
      },
    },
    model: "mock/mock-model",
  })

  server = spawn(cliPath, ["serve", "--port", "0"], {
    env: {
      ...process.env,
      KILO_SERVER_PASSWORD: password,
      KILO_CONFIG_CONTENT: config,
      KILO_TELEMETRY_LEVEL: "off",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  server.stderr?.on("data", (data: Buffer) => {
    // Uncomment for debugging: console.error("[CLI stderr]", data.toString())
  })

  port = await waitForPort(server)

  client = createKiloClient({
    baseUrl: `http://localhost:${port}`,
    headers: {
      Authorization: `Bearer ${password}`,
    },
  })
})

afterAll(() => {
  server?.kill("SIGTERM")
  mockLlm?.stop()
})

describe("Full E2E with mock LLM", () => {
  it("can send a message and receive a streamed response", async () => {
    const session = await client.session.create()
    expect(session.data).toBeDefined()

    const id = (session.data as { id: string }).id
    expect(id).toBeDefined()

    // Send a message via the prompt endpoint
    await client.session.prompt({
      sessionID: id,
      parts: [{ type: "text", text: "Hello!" }],
    })

    // Poll for messages — the assistant response may take a moment
    const deadline = Date.now() + 15_000
    let found = false

    while (Date.now() < deadline && !found) {
      const messages = await client.session.messages({ sessionID: id })
      const data = messages.data as Array<{ role: string }> | undefined
      if (data?.some((m) => m.role === "assistant")) {
        found = true
        break
      }
      await Bun.sleep(500)
    }

    expect(found).toBe(true)
  })
})
