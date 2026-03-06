import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { spawn, type ChildProcess } from "child_process"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import crypto from "crypto"
import path from "path"

let mockLlm: ReturnType<typeof Bun.serve>
let server: ChildProcess
let port: number
let password: string
let authHeader: string
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
  authHeader = `Basic ${Buffer.from(`kilo:${password}`).toString("base64")}`

  const cliPath = process.env.KILO_CLI_PATH || path.resolve(import.meta.dir, "../../bin/kilo")

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
    console.error("[mock-llm CLI stderr]", data.toString().trim())
  })

  port = await waitForPort(server)

  client = createKiloClient({
    baseUrl: `http://localhost:${port}`,
    headers: {
      Authorization: authHeader,
    },
  })
})

afterAll(() => {
  server?.kill("SIGTERM")
  mockLlm?.stop()
})

describe("Full E2E with mock LLM", () => {
  it(
    "can send a message and receive a streamed response",
    async () => {
      const session = await client.session.create()
      expect(session.data).toBeDefined()

      const id = (session.data as { id: string }).id
      expect(id).toBeDefined()

      // Send a message via the prompt endpoint with explicit model
      const prompt = await client.session.prompt({
        sessionID: id,
        model: { providerID: "mock", modelID: "mock-model" },
        parts: [{ type: "text", text: "Hello!" }],
      })
      console.log("[mock-llm] prompt response status:", prompt.response?.status)

      // Poll for messages — the assistant response may take a moment
      // Messages are returned as an array of message objects with `parts` containing the content
      const deadline = Date.now() + 30_000
      let found = false

      while (Date.now() < deadline && !found) {
        const messages = await client.session.messages({ sessionID: id })
        const data = messages.data as Array<{ parts?: Array<{ type: string; text?: string }> }> | undefined
        const hasText = data?.some((m) => m.parts?.some((p) => p.type === "text" && p.text))
        if (hasText) {
          found = true
          break
        }
        await Bun.sleep(1000)
      }

      expect(found).toBe(true)
    },
    { timeout: 60_000 },
  )
})
