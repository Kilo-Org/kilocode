import { expect, test } from "bun:test"
import path from "node:path"
import { createClient } from "@kilocode/client"
import { fixture, ready } from "./fixture"

// Subprocess test for the tui-preview cloud CLI verbs. A credential is first
// seeded into the fixture store through the real device-auth flow against a
// loopback gateway (via the long-running cloud-fixture host), then the
// one-shot `tui-preview cloud start/send/status/result` subprocesses run their
// own launch against the same store and contact the loopback cloud-agent stub
// through the explicit dev origin overrides. No real account, live cloud
// endpoint, or paid inference is used.

const ORG_SELECTED = "123e4567-e89b-12d3-a456-426614174000"
const SESSION = "agent_12345678-1234-1234-1234-123456789abc"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"
const OTHER_MESSAGE = "msg_018f1e2d3c4bZyXwVuTsRqPoNm"
const TOKEN = "fixture-cloud-token"

const cloudFixture = path.resolve(import.meta.dir, "cloud-fixture.ts")
// The packaged interactive launcher runs tui-preview.ts with the Solid preload
// and bundled Bun 1.4, which the source-only tui-preview.ts invocation lacks.
const kilo2 = path.resolve(import.meta.dir, "../dist/interactive/kilo2")

type Admission = { path: string; body: string; authorization: string | null }

function cloudAgent() {
  const admissions: Admission[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "POST" ? await request.text() : ""
      if (url.pathname === "/trpc/start" || url.pathname === "/trpc/send") {
        admissions.push({ path: url.pathname, body, authorization: request.headers.get("authorization") })
        const input = JSON.parse(body) as { cloudAgentSessionId?: string; message: { id: string } }
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: url.pathname === "/trpc/send" ? input.cloudAgentSessionId : SESSION,
              ...(url.pathname === "/trpc/start" ? { kiloSessionId: "ses_1" } : { status: "started" }),
              messageId: input.message.id,
              delivery: "queued",
              // The CLI must redact this ticket-bearing URL from stdout.
              streamUrl: "wss://cloud.example/stream?ticket=secret-ticket",
            },
          },
        })
      }
      if (url.pathname === "/trpc/getMessageResult") {
        const input = JSON.parse(url.searchParams.get("input") ?? "null") as {
          cloudAgentSessionId: string
          messageId: string
        }
        const completed = input.messageId === MESSAGE
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: input.cloudAgentSessionId,
              messageId: input.messageId,
              status: completed ? "completed" : "failed",
              createdAt: 1,
              terminalAt: 2,
              completionSource: "runner",
              ...(completed
                ? { gateResult: "passed", assistant: { messageId: "msg_asst", text: "done" } }
                : { failure: { retryable: false } }),
            },
          },
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { admissions, origin: server.url.origin, stop: () => server.stop(true) }
}

function gateway(organizationID: string | null) {
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
        expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`)
        return Response.json({
          user: { email: "fixture@example.test", name: "Fixture" },
          organizations: organizationID === null ? [] : [{ id: organizationID, name: "Selected", role: "owner" }],
          selectedOrganizationId: organizationID,
          hasPersonalAccount: true,
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { origin: server.url.origin, stop: () => server.stop(true) }
}

// Seed a credential into the fixture store by running the real device-auth flow
// against a temporary cloud-fixture host, then stop it so the one-shot CLI
// subprocess can take the store lock.
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

function cloudEnv(gate: { origin: string }, cloud: { origin: string }) {
  return {
    KILO_API_URL: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
    KILO_WEB_APP_URL: cloud.origin,
  }
}

// Run the one-shot tui-preview cloud CLI as a subprocess against the fixture's
// store and env. Unlike the fixture's default headless entry, tui-preview.ts
// owns the cloud verbs and reads the dev origin overrides.
async function runCloud(
  input: Awaited<ReturnType<typeof fixture>>,
  env: Record<string, string>,
  args: string[],
) {
  const child = Bun.spawn([kilo2, ...args], {
    cwd: input.cwd,
    env: { ...input.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    // Generous: each subprocess runs its own launch and must acquire the store
    // lock, which a prior subprocess's cleanup may still be releasing.
    timeout: 60000,
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

function startRequest(file: string) {
  return Bun.write(
    file,
    JSON.stringify({
      message: { prompt: "Inspect the repository" },
      agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
      repository: { type: "github", repo: "Kilo-Org/kilocode" },
    }),
  )
}

test("cloud CLI start admits through the resolved org and redacts the stream URL", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(ORG_SELECTED)
  await seed(input, gate, cloud)
  const file = path.join(input.directory, "start.json")
  await startRequest(file)
  try {
    const result = await runCloud(input, cloudEnv(gate, cloud), ["cloud", "start", file])
    expect(result.code, result.stderr).toBe(0)
    const admission = JSON.parse(result.stdout) as Record<string, unknown>
    expect(admission.cloudAgentSessionId).toBe(SESSION)
    expect(admission.messageId).toMatch(/^msg_/)
    // stdout carries admission identity only: no stream URL, ticket, or token.
    expect(result.stdout).not.toContain("secret-ticket")
    expect(result.stdout).not.toContain("streamUrl")
    expect(result.stdout).not.toContain(TOKEN)
    expect(result.stderr).not.toContain(TOKEN)

    const sent = cloud.admissions.find((a) => a.path === "/trpc/start")
    expect(sent?.authorization).toBe(`Bearer ${TOKEN}`)
    const wire = JSON.parse(sent?.body ?? "{}") as { options?: { kilocodeOrganizationId?: string } }
    expect(wire.options?.kilocodeOrganizationId).toBe(ORG_SELECTED)
    expect(sent?.body).not.toContain(TOKEN)
  } finally {
    cloud.stop()
    gate.stop()
  }
})

test("cloud CLI send admits and redacts the token", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(ORG_SELECTED)
  await seed(input, gate, cloud)
  const env = cloudEnv(gate, cloud)
  try {
    const sent = await runCloud(input, env, ["cloud", "send", SESSION, "Continue"])
    expect(sent.code, sent.stderr).toBe(0)
    const admission = JSON.parse(sent.stdout) as Record<string, unknown>
    expect(admission.cloudAgentSessionId).toBe(SESSION)
    expect(sent.stdout).not.toContain(TOKEN)
    const wire = cloud.admissions.find((a) => a.path === "/trpc/send")
    expect(wire?.authorization).toBe(`Bearer ${TOKEN}`)
  } finally {
    cloud.stop()
    gate.stop()
  }
})

test("cloud CLI status projects the assistant payload away", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(ORG_SELECTED)
  await seed(input, gate, cloud)
  const env = cloudEnv(gate, cloud)
  try {
    const status = await runCloud(input, env, ["cloud", "status", SESSION, MESSAGE])
    expect(status.code, status.stderr).toBe(0)
    const projected = JSON.parse(status.stdout) as Record<string, unknown>
    expect(projected.status).toBe("completed")
    // status projects the assistant payload away.
    expect("assistant" in projected).toBe(false)
  } finally {
    cloud.stop()
    gate.stop()
  }
})

test("cloud CLI result maps a completed status to exit code 0", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(ORG_SELECTED)
  await seed(input, gate, cloud)
  const env = cloudEnv(gate, cloud)
  try {
    const completed = await runCloud(input, env, ["cloud", "result", SESSION, MESSAGE])
    expect(completed.code, completed.stderr).toBe(0)
    expect(JSON.parse(completed.stdout)).toMatchObject({ status: "completed" })
  } finally {
    cloud.stop()
    gate.stop()
  }
})

test("cloud CLI result maps a failed status to exit code 3", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(ORG_SELECTED)
  await seed(input, gate, cloud)
  const env = cloudEnv(gate, cloud)
  try {
    const failed = await runCloud(input, env, ["cloud", "result", SESSION, OTHER_MESSAGE])
    expect(failed.code, `stdout=${failed.stdout} stderr=${failed.stderr}`).toBe(3)
    expect(failed.stdout).not.toContain(TOKEN)
  } finally {
    cloud.stop()
    gate.stop()
  }
})

test("cloud CLI start omits the org field for a personal (null) selection", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(null)
  await seed(input, gate, cloud)
  const file = path.join(input.directory, "start.json")
  await startRequest(file)
  try {
    const result = await runCloud(input, cloudEnv(gate, cloud), ["cloud", "start", file])
    expect(result.code, result.stderr).toBe(0)
    const sent = cloud.admissions.find((a) => a.path === "/trpc/start")
    const wire = JSON.parse(sent?.body ?? "{}") as { options?: Record<string, unknown> }
    expect(wire.options && "kilocodeOrganizationId" in wire.options).toBe(false)
  } finally {
    cloud.stop()
    gate.stop()
  }
})

test("cloud CLI fails closed with no seeded credential and never contacts the cloud", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(ORG_SELECTED)
  const file = path.join(input.directory, "start.json")
  await startRequest(file)
  try {
    const result = await runCloud(input, cloudEnv(gate, cloud), ["cloud", "start", file])
    expect(result.code).not.toBe(0)
    expect(cloud.admissions).toEqual([])
  } finally {
    cloud.stop()
    gate.stop()
  }
})
