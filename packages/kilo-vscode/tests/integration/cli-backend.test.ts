import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { spawn, type ChildProcess } from "child_process"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import crypto from "crypto"
import path from "path"

let server: ChildProcess
let port: number
let password: string
let client: ReturnType<typeof createKiloClient>

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
  password = crypto.randomBytes(32).toString("hex")

  const cliPath = process.env.KILO_CLI_PATH || path.resolve(import.meta.dir, "../../bin/kilo")

  server = spawn(cliPath, ["serve", "--port", "0"], {
    env: {
      ...process.env,
      KILO_SERVER_PASSWORD: password,
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
})

describe("CLI backend integration", () => {
  it("server health check responds", async () => {
    const res = await fetch(`http://localhost:${port}/global/health`, {
      headers: { Authorization: `Bearer ${password}` },
    })
    expect(res.ok).toBe(true)
  })

  it("can list sessions via SDK", async () => {
    const result = await client.session.list()
    expect(result.data).toBeDefined()
  })

  it("can create a session via SDK", async () => {
    const result = await client.session.create()
    expect(result.data).toBeDefined()
  })
})
