import { expect, test } from "bun:test"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

// A server that admits the prompt and then keeps the Session running until interrupted.
async function serve(directory: string, options: { models?: readonly unknown[] } = {}) {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const prompted = Promise.withResolvers<void>()
  const interrupted = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const text = await request.text()
      requests.push({ method: request.method, path: url.pathname, body: text ? JSON.parse(text) : undefined })
      if (url.pathname === "/api/info")
        return Response.json({ version: "test", pid: 0, urls: [], paths: { tmp: directory } })
      if (request.method === "GET" && url.pathname === "/api/location") return Response.json(location)
      if (request.method === "GET" && url.pathname === "/api/model") {
        if (!options.models) return Response.json({ data: [] })
        await released.promise
        return Response.json({ data: options.models })
      }
      if (request.method === "POST" && url.pathname === "/api/session/ses_1/model")
        return new Response(null, { status: 204 })
      if (request.method === "POST" && url.pathname === "/api/session")
        return Response.json({
          data: {
            id: "ses_1",
            projectID: "project",
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
          },
        })
      if (url.pathname === "/api/event")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                `data: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n`,
              )
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      if (url.pathname === "/api/session/ses_1/prompt") {
        prompted.resolve()
        const body = JSON.parse(text)
        return Response.json({
          data: { id: body.id, sessionID: "ses_1", type: "user", time: { created: 1 }, payload: {}, delivery: "steer" },
        })
      }
      if (url.pathname === "/api/session/ses_1/interrupt") {
        interrupted.resolve()
        return Response.json({ interrupted: true })
      }
      if (url.pathname.endsWith("/wait")) return interrupted.promise.then(() => new Response(null, { status: 204 }))
      if (request.method === "GET") return Response.json({ data: [] })
      return new Response(null, { status: 404 })
    },
  })
  return { server, requests, prompted: prompted.promise, releaseModels: () => released.resolve() }
}

function spawnRun(
  url: string,
  directory: string,
  message: string[],
  stdin: "pipe" | "ignore",
  options: { model?: string; env?: Record<string, string> } = {},
) {
  return Bun.spawn(
    [
      process.execPath,
      "run",
      "src/index.ts",
      "run",
      "--server",
      url,
      ...(options.model ? ["--model", options.model] : []),
      ...message,
    ],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: isolatedEnv(directory, { PWD: directory, ...options.env }),
      signal: AbortSignal.timeout(25_000),
      stdin,
      stdout: "pipe",
      stderr: "pipe",
    },
  )
}

const fixtureModel = {
  id: "fixture",
  modelID: "fixture",
  providerID: "kilo",
  name: "Fixture",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 100_000, output: 10_000 },
}

async function until(condition: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await Bun.sleep(20)
  }
  throw new Error("Timed out waiting for the run to read the model catalog")
}

test("run sends the message as typed", async () => {
  await using directory = await tmpdir()
  const fake = await serve(directory.path)
  const child = spawnRun(fake.server.url.toString(), directory.path, ["say hello world", `it's "quoted"`], "ignore")
  try {
    await fake.prompted
    expect(fake.requests.find((item) => item.path.endsWith("/prompt"))?.body).toMatchObject({
      text: `say hello world it's "quoted"`,
    })
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await fake.server.stop(true)
  }
}, 30_000)

test("run waits for the requested model before admitting the prompt", async () => {
  await using directory = await tmpdir()
  const fake = await serve(directory.path, { models: [fixtureModel] })
  const child = spawnRun(fake.server.url.toString(), directory.path, ["hello"], "ignore", {
    model: "kilo/fixture",
    env: { OPENCODE_APP_DIR_NAME: "kilo2" },
  })
  try {
    await until(() => fake.requests.some((item) => item.path === "/api/model"))
    expect(fake.requests.some((item) => item.path.endsWith("/prompt"))).toBe(false)
    await Bun.sleep(300)
    expect(fake.requests.some((item) => item.path.endsWith("/prompt"))).toBe(false)
    fake.releaseModels()
    await fake.prompted
    expect(fake.requests.findIndex((item) => item.path.endsWith("/prompt"))).toBeGreaterThan(
      fake.requests.findIndex((item) => item.path === "/api/model"),
    )
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await fake.server.stop(true)
  }
}, 30_000)

const posix = test.skipIf(process.platform === "win32")

// Windows has no SIGTERM delivery: kill() terminates the process outright.
posix(
  "run does not wait on spawn's open stdin, and SIGTERM interrupts the Session with 143",
  async () => {
    await using directory = await tmpdir()
    const fake = await serve(directory.path)
    // A stdin pipe that stays open and silent, as with spawn's default stdio.
    const child = spawnRun(fake.server.url.toString(), directory.path, ["hello"], "pipe")
    try {
      await fake.prompted
      await Bun.sleep(200)
      child.kill("SIGTERM")
      expect(await child.exited).toBe(143)
      expect(fake.requests.some((item) => item.path === "/api/session/ses_1/interrupt")).toBe(true)
    } finally {
      child.kill("SIGKILL")
      await child.exited
      await fake.server.stop(true)
    }
  },
  30_000,
)

posix(
  "run reads a slow shell pipe in full alongside a message argument",
  async () => {
    await using directory = await tmpdir()
    const fake = await serve(directory.path)
    const command = `(sleep 4; echo slow context) | "${process.execPath}" run src/index.ts run --server ${fake.server.url} review`
    const child = Bun.spawn(["sh", "-c", command], {
      cwd: path.join(import.meta.dir, "../.."),
      env: isolatedEnv(directory.path, { PWD: directory.path }),
      signal: AbortSignal.timeout(25_000),
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      await fake.prompted
      expect(fake.requests.find((item) => item.path.endsWith("/prompt"))?.body).toMatchObject({
        text: "review\nslow context\n",
      })
    } finally {
      child.kill("SIGKILL")
      await child.exited
      await fake.server.stop(true)
    }
  },
  30_000,
)
