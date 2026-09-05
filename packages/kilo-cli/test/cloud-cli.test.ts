import { expect, test } from "bun:test"
import path from "node:path"
import { createClient } from "@kilocode/client"
import { fixture, ready } from "./fixture"
import { CloudRpc } from "../src/cloud-rpc"

// Real-launch cloud CLI test. The host is spawned as a subprocess via
// cloud-fixture.ts, a credential is seeded through the real device-auth flow
// against a loopback gateway, and the cloud RPC is driven through the public
// createClient over authenticated HTTP. The cloud-agent and web-app services are
// loopback Bun.serve stubs reached through the explicit dev origin overrides.
// No real account, live cloud endpoint, or paid inference is used.

const ORG_SELECTED = "123e4567-e89b-12d3-a456-426614174000"
const ORG_OTHER = "abcdefab-cdef-4abc-8def-abcdefabcdef"
const SESSION = "agent_12345678-1234-1234-1234-123456789abc"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"
const TOKEN = "fixture-cloud-token"

type Admission = { path: string; body: string; authorization: string | null }

// Loopback cloud-agent stub: serves the tRPC start/send/getMessageResult
// envelopes and records admissions for assertion.
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
        const sessionId = url.pathname === "/trpc/send" ? input.cloudAgentSessionId : SESSION
        return Response.json({
          result: {
            data: {
              cloudAgentSessionId: sessionId,
              ...(url.pathname === "/trpc/start" ? { kiloSessionId: "ses_1" } : { status: "started" }),
              messageId: input.message.id,
              delivery: "queued",
              // Deliberately include a streamUrl so the CLI must redact it.
              streamUrl: `wss://cloud.example/stream?ticket=secret-ticket`,
            },
          },
        })
      }
      if (url.pathname === "/trpc/getMessageResult") {
        const raw = url.searchParams.get("input")
        const input = JSON.parse(raw ?? "null") as { cloudAgentSessionId: string; messageId: string }
        const completed = input.messageId.endsWith("AbCdEfGhIjKlMn")
        // Respect the lifecycle invariants: gateResult/assistant only on
        // completed, failure only on failed/interrupted.
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

// Loopback web-app stub serving the stream-ticket endpoint.
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

// Loopback gateway that seeds a credential through device auth and serves the
// profile with a selectable organization.
function gateway(profile: unknown) {
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
        return Response.json(profile)
      }
      return new Response(null, { status: 404 })
    },
  })
  return { origin: server.url.origin, stop: () => server.stop(true) }
}

function profileBody(organizationID: string | null) {
  return {
    user: { email: "fixture@example.test", name: "Fixture" },
    organizations: organizationID === null ? [] : [{ id: organizationID, name: "Selected", role: "owner" }],
    selectedOrganizationId: organizationID,
    hasPersonalAccount: true,
  }
}

async function login(client: ReturnType<typeof createClient>, location: { directory: string }) {
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
    if (status.data.status === "complete") return
    if (status.data.status !== "pending") throw new Error(`Device login failed: ${JSON.stringify(status.data)}`)
    if (Date.now() > deadline) throw new Error("Device login timed out")
    await Bun.sleep(20)
  }
}

async function spawnHost(input: Awaited<ReturnType<typeof fixture>>, env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "cloud-fixture.ts")], {
    cwd: input.cwd,
    env: { ...input.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20000,
  })
  const errors = new Response(child.stderr).text()
  const listening = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
  const password = (
    await Bun.file(path.join(input.env.XDG_STATE_HOME!, "kilo2/interactive/server.password")).text()
  ).trim()
  const authorization = `Basic ${btoa(`opencode:${password}`)}`
  const client = createClient({ baseUrl: listening.value, headers: { authorization } })
  return { child, client, errors: () => errors, authorization }
}

test("cloud RPC over a real launch resolves the selected org and keeps the token header-only", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(profileBody(ORG_SELECTED))
  const host = await spawnHost(input, {
    KILO_FIXTURE_GATEWAY: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
    KILO_WEB_APP_URL: cloud.origin,
  })
  try {
    const location = { directory: input.cwd }
    await host.client.plugin.awaitActivation({ location }, { signal: AbortSignal.timeout(5000) })
    await login(host.client, location)
    const rpc = host.client.rpc(CloudRpc.Definition)

    const started = await rpc.start(
      {
        message: { prompt: "Inspect the repository" },
        agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        options: { createdOnPlatform: "kilo-cli" },
      },
      { location },
    )
    expect(started.cloudAgentSessionId).toBe(SESSION)
    // The account bearer token must never cross the RPC boundary; the
    // session-scoped stream ticket may, for the CLI's --stream consumer.
    expect(JSON.stringify(started)).not.toContain(TOKEN)

    const admission = cloud.admissions.find((a) => a.path === "/trpc/start")
    expect(admission?.authorization).toBe(`Bearer ${TOKEN}`)
    const sent = JSON.parse(admission?.body ?? "{}") as { options?: { kilocodeOrganizationId?: string } }
    expect(sent.options?.kilocodeOrganizationId).toBe(ORG_SELECTED)
    expect(admission?.body).not.toContain(TOKEN)
  } finally {
    host.child.kill("SIGTERM")
    await host.child.exited
    cloud.stop()
    gate.stop()
  }
})

test("cloud RPC start rejects a caller-supplied org at the wire boundary", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(profileBody(ORG_SELECTED))
  const host = await spawnHost(input, {
    KILO_FIXTURE_GATEWAY: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
    KILO_WEB_APP_URL: cloud.origin,
  })
  try {
    const location = { directory: input.cwd }
    await host.client.plugin.awaitActivation({ location }, { signal: AbortSignal.timeout(5000) })
    await login(host.client, location)
    const rpc = host.client.rpc(CloudRpc.Definition)
    // options.kilocodeOrganizationId is structurally absent from the wire input,
    // so a smuggled value is rejected by RPC validation before reaching the host.
    await expect(
      rpc.start(
        {
          message: { prompt: "Inspect the repository" },
          agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
          repository: { type: "github", repo: "Kilo-Org/kilocode" },
          options: { createdOnPlatform: "kilo-cli", kilocodeOrganizationId: ORG_OTHER } as never,
        },
        { location },
      ),
    ).rejects.toMatchObject({ type: "rpc.invalid_input" })
    expect(cloud.admissions).toEqual([])
  } finally {
    host.child.kill("SIGTERM")
    await host.child.exited
    cloud.stop()
    gate.stop()
  }
})

test("cloud RPC start omits the org field for a personal (null) selection", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(profileBody(null))
  const host = await spawnHost(input, {
    KILO_FIXTURE_GATEWAY: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
    KILO_WEB_APP_URL: cloud.origin,
  })
  try {
    const location = { directory: input.cwd }
    await host.client.plugin.awaitActivation({ location }, { signal: AbortSignal.timeout(5000) })
    await login(host.client, location)
    const rpc = host.client.rpc(CloudRpc.Definition)
    await rpc.start(
      {
        message: { prompt: "Inspect the repository" },
        agent: { mode: "code", model: "anthropic/claude-sonnet-4" },
        repository: { type: "github", repo: "Kilo-Org/kilocode" },
        options: { createdOnPlatform: "kilo-cli" },
      },
      { location },
    )
    const admission = cloud.admissions.find((a) => a.path === "/trpc/start")
    const sent = JSON.parse(admission?.body ?? "{}") as { options?: Record<string, unknown> }
    expect(sent.options && "kilocodeOrganizationId" in sent.options).toBe(false)
  } finally {
    host.child.kill("SIGTERM")
    await host.child.exited
    cloud.stop()
    gate.stop()
  }
})

test("cloud RPC fails closed without a credential and never contacts the cloud", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(profileBody(ORG_SELECTED))
  const host = await spawnHost(input, {
    KILO_FIXTURE_GATEWAY: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
    KILO_WEB_APP_URL: cloud.origin,
  })
  try {
    const location = { directory: input.cwd }
    await host.client.plugin.awaitActivation({ location }, { signal: AbortSignal.timeout(5000) })
    // No login: the account Effect must fail closed.
    const rpc = host.client.rpc(CloudRpc.Definition)
    await expect(
      rpc.send({ cloudAgentSessionId: SESSION, message: { prompt: "Continue" } }, { location }),
    ).rejects.toMatchObject({ type: "kilocode.cloud_unavailable" })
    expect(cloud.admissions).toEqual([])
  } finally {
    host.child.kill("SIGTERM")
    await host.child.exited
    cloud.stop()
    gate.stop()
  }
})

test("cloud result maps exit codes through the public RPC", async () => {
  await using input = await fixture()
  const cloud = cloudAgent()
  const gate = gateway(profileBody(ORG_SELECTED))
  const host = await spawnHost(input, {
    KILO_FIXTURE_GATEWAY: gate.origin,
    CLOUD_AGENT_NEXT_BASE_URL: cloud.origin,
    KILO_WEB_APP_URL: cloud.origin,
  })
  try {
    const location = { directory: input.cwd }
    await host.client.plugin.awaitActivation({ location }, { signal: AbortSignal.timeout(5000) })
    await login(host.client, location)
    const rpc = host.client.rpc(CloudRpc.Definition)
    const completed = await rpc.result({ cloudAgentSessionId: SESSION, messageId: MESSAGE }, { location })
    expect(completed.status).toBe("completed")
    const failed = await rpc.result(
      { cloudAgentSessionId: SESSION, messageId: "msg_018f1e2d3c4bZyXwVuTsRqPoNm" },
      { location },
    )
    expect(failed.status).toBe("failed")
  } finally {
    host.child.kill("SIGTERM")
    await host.child.exited
    cloud.stop()
    gate.stop()
  }
})
