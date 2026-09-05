import { expect, test } from "bun:test"
import path from "node:path"
import { createClient } from "@kilocode/client"
import { fixture, ready } from "./fixture"

// Real loopback WebSocket streaming tests for the `cloud start --stream` CLI.
// A credential is seeded through the real device-auth flow; the cloud-agent
// stub serves both the tRPC admission and a real WebSocket /stream endpoint on
// one loopback origin, and the web-app stub serves the stream-ticket endpoint.
// The packaged kilo2 launcher runs the actual CLI; frames arrive over a real
// socket. No live cloud endpoint, account, or paid inference is used.

const ORG = "123e4567-e89b-12d3-a456-426614174000"
const SESSION = "agent_12345678-1234-1234-1234-123456789abc"
const TOKEN = "fixture-cloud-token"

const cloudFixture = path.resolve(import.meta.dir, "cloud-fixture.ts")
const kilo2 = path.resolve(import.meta.dir, "../dist/interactive/kilo2")

type Admission = { path: string; body: string; authorization: string | null }

// Serves the tRPC start admission and a real WebSocket /stream endpoint on a
// single loopback origin (the cloud agent). The admission's streamUrl pins to
// this same origin so the CLI connects back here.
function cloudAgent(events: string[], options: { providedUrl?: boolean } = {}) {
  const admissions: Admission[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, srv) {
      const url = new URL(request.url)
      if (url.pathname === "/stream") {
        if (srv.upgrade(request)) return undefined
        return new Response("upgrade required", { status: 426 })
      }
      const body = request.method === "POST" ? await request.text() : ""
      if (url.pathname === "/trpc/start") {
        admissions.push({ path: url.pathname, body, authorization: request.headers.get("authorization") })
        const input = JSON.parse(body) as { message: { id: string } }
        const origin = `http://127.0.0.1:${srv.port}`
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: SESSION,
              kiloSessionId: "ses_1",
              messageId: input.message.id,
              delivery: "queued",
              // Provided URL pinned to this origin unless the test wants the
              // ticket fallback path (omit streamUrl).
              ...(options.providedUrl === false ? {} : { streamUrl: `${origin}/stream?ticket=provided` }),
            },
          },
        })
      }
      return new Response(null, { status: 404 })
    },
    websocket: {
      open(ws) {
        for (const event of events) ws.send(event)
        ws.close(1000)
      },
      message() {},
    },
  })
  return { admissions, origin: server.url.origin, stop: () => server.stop(true) }
}

function webApp() {
  const tickets: { body: string; authorization: string | null }[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/cloud-agent-next/sessions/stream-ticket" && request.method === "POST") {
        tickets.push({ body: await request.text(), authorization: request.headers.get("authorization") })
        return Response.json({ ticket: "scoped-ticket", expiresAt: Date.now() + 60_000 })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { tickets, origin: server.url.origin, stop: () => server.stop(true) }
}

function gateway() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/device-auth/codes" && request.method === "POST") {
        return Response.json({ code: "fixture-code", verificationUrl: `${url.origin}/verify`, expiresIn: 60 })
      }
      if (url.pathname === "/api/device-auth/codes/fixture-code") {
        return Response.json({ status: "approved", token: TOKEN, userEmail: "fixture@example.test" })
      }
      if (url.pathname === "/api/profile") {
        return Response.json({
          user: { email: "fixture@example.test", name: "Fixture" },
          organizations: [{ id: ORG, name: "Selected", role: "owner" }],
          selectedOrganizationId: ORG,
          hasPersonalAccount: true,
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { origin: server.url.origin, stop: () => server.stop(true) }
}

async function seed(input: Awaited<ReturnType<typeof fixture>>, gate: { origin: string }, cloud: { origin: string }) {
  const child = Bun.spawn([process.execPath, "--no-env-file", cloudFixture], {
    cwd: input.cwd,
    env: {
      ...input.env,
      KILO_FIXTURE_GATEWAY: gate.origin,
      CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
      KILO_WEB_APP_URL: cloud.origin,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20000,
  })
  try {
    const listening = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME!, "kilo2/interactive/server.password")).text()
    ).trim()
    const client = createClient({
      baseUrl: listening.value,
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    })
    const location = { directory: input.cwd }
    await client.plugin.awaitActivation({ location }, { signal: AbortSignal.timeout(5000) })
    const attempt = await client.integration.oauth.connect(
      { integrationID: "kilo", methodID: "device", location },
      { signal: AbortSignal.timeout(5000) },
    )
    const deadline = Date.now() + 5000
    while (true) {
      const status = await client.integration.oauth.status({
        integrationID: "kilo",
        attemptID: attempt.data.attemptID,
        location,
      })
      if (status.data.status === "complete") break
      if (status.data.status !== "pending") throw new Error(`Device login failed: ${JSON.stringify(status.data)}`)
      if (Date.now() > deadline) throw new Error("Device login timed out")
      await Bun.sleep(20)
    }
  } finally {
    child.kill("SIGTERM")
    await child.exited
  }
}

async function runCloud(
  input: Awaited<ReturnType<typeof fixture>>,
  env: Record<string, string>,
  args: string[],
  options: { signal?: AbortSignal; timeout?: number } = {},
) {
  const child = Bun.spawn([kilo2, ...args], {
    cwd: input.cwd,
    env: { ...input.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeout ?? 60000,
  })
  if (options.signal) {
    options.signal.addEventListener("abort", () => child.kill("SIGINT"))
  }
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

async function writeStart(input: Awaited<ReturnType<typeof fixture>>) {
  const file = path.join(input.directory, "start.json")
  await Bun.write(
    file,
    JSON.stringify({
      message: { prompt: "Inspect the repository" },
      agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
      repository: { type: "github", repo: "Kilo-Org/kilocode" },
    }),
  )
  return file
}

const FRAMES = ['{"event":"running"}', '{"streamEventType":"complete","data":{"exitCode":0}}']

test("cloud start --stream prints the admission then streams provided-URL frames", async () => {
  await using input = await fixture()
  const cloud = cloudAgent(FRAMES)
  const gate = gateway()
  const web = webApp()
  await seed(input, gate, cloud)
  const file = await writeStart(input)
  const env = {
    KILO_API_URL: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
    KILO_WEB_APP_URL: web.origin,
  }
  try {
    const result = await runCloud(input, env, ["cloud", "start", file, "--stream"])
    expect(result.code, result.stderr).toBe(0)
    const lines = result.stdout.trim().split("\n")
    const admission = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(admission.cloudAgentSessionId).toBe(SESSION)
    // The admission line carries no stream URL, ticket, or account token.
    expect(lines[0]).not.toContain("ticket")
    expect(lines[0]).not.toContain("streamUrl")
    expect(lines[0]).not.toContain(TOKEN)
    // The streamed frames follow the admission.
    expect(lines.slice(1)).toEqual(FRAMES)
    // The provided URL path does not fetch a ticket.
    expect(web.tickets).toEqual([])
  } finally {
    cloud.stop()
    gate.stop()
    web.stop()
  }
})

test("cloud start --stream falls back to a fetched stream ticket", async () => {
  await using input = await fixture()
  // No provided streamUrl in the admission -> the ticket fallback runs.
  const cloud = cloudAgent(FRAMES, { providedUrl: false })
  const gate = gateway()
  const web = webApp()
  await seed(input, gate, cloud)
  const file = await writeStart(input)
  const env = {
    KILO_API_URL: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
    KILO_WEB_APP_URL: web.origin,
  }
  try {
    const result = await runCloud(input, env, ["cloud", "start", file, "--stream"])
    expect(result.code, result.stderr).toBe(0)
    // The ticket was fetched under the account bearer and scoped to the session.
    expect(web.tickets).toHaveLength(1)
    expect(web.tickets[0]?.authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(web.tickets[0]?.body ?? "{}")).toMatchObject({
      cloudAgentSessionId: SESSION,
      organizationId: ORG,
    })
    const lines = result.stdout.trim().split("\n")
    expect(lines.slice(1)).toEqual(FRAMES)
    // The ticket value is never printed.
    expect(result.stdout).not.toContain("scoped-ticket")
    expect(result.stdout).not.toContain(TOKEN)
  } finally {
    cloud.stop()
    gate.stop()
    web.stop()
  }
})

test("cloud start --stream emits a non-fatal error notice when the socket fails", async () => {
  await using input = await fixture()
  // Serve the admission and a WebSocket endpoint on one loopback origin, but
  // the socket closes abnormally (1006-style) as soon as it opens, so the
  // transport fails after a successful admission.
  const broken = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, srv) {
      const url = new URL(request.url)
      if (url.pathname === "/stream") {
        if (srv.upgrade(request)) return undefined
        return new Response("upgrade required", { status: 426 })
      }
      if (url.pathname === "/trpc/start") {
        const inputBody = (await request.json()) as { message: { id: string } }
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: SESSION,
              kiloSessionId: "ses_1",
              messageId: inputBody.message.id,
              delivery: "queued",
              streamUrl: `ws://127.0.0.1:${srv.port}/stream?ticket=broken`,
            },
          },
        })
      }
      return new Response(null, { status: 404 })
    },
    websocket: {
      open(ws) {
        // Abnormal close triggers the transport failure path.
        ws.close(1011)
      },
      message() {},
    },
  })
  const brokenOrigin = `http://127.0.0.1:${broken.port}`
  const gate = gateway()
  const web = webApp()
  await seed(input, gate, { origin: brokenOrigin })
  const file = await writeStart(input)
  const env = {
    KILO_API_URL: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: brokenOrigin,
    KILO_WEB_APP_URL: web.origin,
  }
  try {
    const result = await runCloud(input, env, ["cloud", "start", file, "--stream"])
    // The admission succeeded; the stream failure is a non-fatal notice and the
    // command still exits 0 (matching v1 semantics).
    expect(result.code, result.stderr).toBe(0)
    const lines = result.stdout.trim().split("\n")
    const admission = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(admission.cloudAgentSessionId).toBe(SESSION)
    const notice = JSON.parse(lines[lines.length - 1]!) as { streamEventType?: string; data?: { message?: string } }
    expect(notice.streamEventType).toBe("error")
    // The notice never echoes the ticket URL or token.
    expect(result.stdout).not.toContain("ticket=broken")
    expect(result.stdout).not.toContain(TOKEN)
  } finally {
    broken.stop(true)
    gate.stop()
    web.stop()
  }
})

test("cloud start --stream aborts the live socket on SIGINT", async () => {
  await using input = await fixture()
  // A socket that streams a frame then stays open (no complete, no close).
  const hanging = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, srv) {
      const url = new URL(request.url)
      if (url.pathname === "/stream") {
        if (srv.upgrade(request)) return undefined
        return new Response("upgrade required", { status: 426 })
      }
      if (url.pathname === "/trpc/start") {
        const inputBody = (await request.json()) as { message: { id: string } }
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: SESSION,
              kiloSessionId: "ses_1",
              messageId: inputBody.message.id,
              delivery: "queued",
              streamUrl: `ws://127.0.0.1:${srv.port}/stream?ticket=hang`,
            },
          },
        })
      }
      return new Response(null, { status: 404 })
    },
    websocket: {
      open(ws) {
        ws.send('{"event":"running"}')
        // Never send complete and never close: the stream hangs.
      },
      message() {},
    },
  })
  const gate = gateway()
  const web = webApp()
  await seed(input, gate, { origin: `http://127.0.0.1:${hanging.port}` })
  const file = await writeStart(input)
  const env = {
    KILO_API_URL: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: `http://127.0.0.1:${hanging.port}`,
    KILO_WEB_APP_URL: web.origin,
  }
  try {
    const controller = new AbortController()
    const pending = runCloud(input, env, ["cloud", "start", file, "--stream"], { signal: controller.signal })
    // Give the stream time to connect and receive the first frame, then abort.
    await Bun.sleep(3000)
    controller.abort()
    const result = await pending
    // SIGINT during a stream maps to the run-interrupt exit code 130.
    expect([0, 130]).toContain(result.code)
    expect(result.stdout).toContain('{"event":"running"}')
    expect(result.stdout).not.toContain(TOKEN)
  } finally {
    hanging.stop(true)
    gate.stop()
    web.stop()
  }
})
