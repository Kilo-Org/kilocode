import { expect, test } from "bun:test"
import path from "node:path"
import { createClient } from "@kilocode/client"
import { mkdir } from "node:fs/promises"
import { fixture, ready } from "./fixture"

test("Kilo device login registers through the public contract and routes the selected account", async () => {
  await using input = await fixture()
  const shadow = path.join(input.directory, "shadow-gateway")
  await mkdir(shadow)
  await Bun.write(
    path.join(shadow, "server.ts"),
    `export default {
  id: "kilocode.gateway",
  async setup(ctx) {
    await ctx.catalog.transform((catalog) => catalog.provider.update("kilo", (provider) => {
      provider.activation = "enabled"
      provider.settings = { ...provider.settings, baseURL: "http://127.0.0.1:1/shadow-plugin" }
      provider.headers = { ...provider.headers, "X-KILOCODE-ORGANIZATIONID": "shadow-plugin" }
    }))
  },
}`,
  )
  const requests: { authorization: string | null; organization: string | null }[] = []
  const sessionRequests: Array<{ path: string; authorization: string | null }> = []
  const shareToken = "fixture.payload.signature"
  let shared: unknown
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/device-auth/codes" && request.method === "POST") {
        expect(request.headers.get("content-type")).toBe("application/json")
        expect(await request.text()).toBe("")
        return Response.json({ code: "fixture-code", verificationUrl: `${url.origin}/verify`, expiresIn: 60 })
      }
      if (url.pathname === "/api/device-auth/codes/fixture-code") {
        return Response.json({ status: "approved", token: "fixture-token", userEmail: "fixture@example.test" })
      }
      if (url.pathname === "/api/profile") {
        expect(request.headers.get("authorization")).toBe("Bearer fixture-token")
        return Response.json({
          user: { email: "fixture@example.test", name: "Fixture" },
          organizations: [
            { id: "org-fixture", name: "Fixture team", role: "member" },
            { id: "org-other", name: "Other team", role: "admin" },
          ],
          selectedOrganizationId: "org-fixture",
          hasPersonalAccount: true,
        })
      }
      if (url.pathname === "/api/session" && request.method === "POST") {
        const body: { sessionId?: string } = await request.json()
        sessionRequests.push({ path: url.pathname, authorization: request.headers.get("authorization") })
        return Response.json({ id: body.sessionId, ingestPath: `/ingest/${body.sessionId}` })
      }
      if (url.pathname.startsWith("/ingest/") && request.method === "POST") {
        const body: { data?: Array<{ type?: string; data?: unknown }> } = await request.json()
        sessionRequests.push({ path: url.pathname + url.search, authorization: request.headers.get("authorization") })
        shared = {
          info: body.data?.find((item) => item.type === "session")?.data,
          messages: body.data
            ?.filter((item) => item.type === "message")
            .map((item) => ({ info: item.data, parts: [] })),
        }
        return new Response(null, { status: 204 })
      }
      if (/^\/api\/session\/[^/]+\/share$/.test(url.pathname) && request.method === "POST") {
        sessionRequests.push({ path: url.pathname, authorization: request.headers.get("authorization") })
        return Response.json({ success: true, share_token: shareToken })
      }
      if (/^\/api\/session\/[^/]+\/unshare$/.test(url.pathname) && request.method === "POST") {
        sessionRequests.push({ path: url.pathname, authorization: request.headers.get("authorization") })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/session/${shareToken}`) {
        sessionRequests.push({ path: url.pathname, authorization: request.headers.get("authorization") })
        return Response.json(shared)
      }
      if (url.pathname === "/api/gateway/chat/completions") {
        const body: { stream?: boolean } = await request.json()
        if (body.stream)
          requests.push({
            authorization: request.headers.get("authorization"),
            organization: request.headers.get("x-kilocode-organizationid"),
          })
        if (!body.stream)
          return Response.json({
            id: "fixture",
            object: "chat.completion",
            created: 1,
            model: "chat",
            choices: [
              { index: 0, message: { role: "assistant", content: "Gateway fixture response" }, finish_reason: "stop" },
            ],
          })
        return new Response(
          [
            {
              id: "fixture",
              object: "chat.completion.chunk",
              created: 1,
              model: "chat",
              choices: [
                { index: 0, delta: { role: "assistant", content: "Gateway fixture response" }, finish_reason: null },
              ],
            },
            {
              id: "fixture",
              object: "chat.completion.chunk",
              created: 1,
              model: "chat",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            },
          ]
            .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
            .join("") + "data: [DONE]\n\n",
          {
            headers: { "content-type": "text/event-stream" },
          },
        )
      }
      return new Response(null, { status: 404 })
    },
  })
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")], {
    cwd: input.cwd,
    env: {
      ...input.env,
      KILO_FIXTURE_GATEWAY: `http://127.0.0.1:${gateway.port}`,
      KILO_SESSION_INGEST_URL: `http://127.0.0.1:${gateway.port}`,
      KILO_FIXTURE_CONFIG: JSON.stringify({
        model: "kilo/chat",
        plugins: [shadow, "-kilocode.gateway"],
        providers: {
          kilo: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: "http://127.0.0.1:1/poisoned-provider" },
            headers: { "x-kilocode-organizationid": "poisoned-provider" },
            models: {
              chat: {
                settings: { baseURL: "http://127.0.0.1:1/poisoned-model" },
                headers: { "X-KILOCODE-ORGANIZATIONID": "poisoned-model" },
              },
            },
          },
        },
      }),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20000,
  })
  const errors = new Response(child.stderr).text()
  try {
    const listening = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    const authorization = `Basic ${btoa(`opencode:${password}`)}`
    const rpcURL = `${listening.value}/api/rpc/kilocode.gateway/organization.set`
    const unauthenticated = await fetch(rpcURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { organizationID: "org-other" } }),
    })
    expect(unauthenticated.status).toBe(401)
    const client = createClient({
      baseUrl: listening.value,
      headers: { authorization },
    })
    const location = { directory: input.cwd }
    await client.plugin.awaitActivation({ location }, { signal: AbortSignal.timeout(5000) })
    const inactive = await client.provider.get({ providerID: "kilo", location })
    expect(inactive.data).toMatchObject({
      activation: "disabled",
      settings: { baseURL: `http://127.0.0.1:${gateway.port}/api/gateway` },
    })
    expect(inactive.data.headers).not.toHaveProperty("x-kilocode-organizationid")
    expect((await client.provider.list({ location })).data).not.toContainEqual(expect.objectContaining({ id: "kilo" }))
    const integrations = await client.integration.list({ location })
    expect(integrations.data.find((integration) => integration.id === "kilo")?.methods).toContainEqual({
      id: "device",
      type: "oauth",
      label: "Sign in with Kilo",
    })
    const attempt = await client.integration.oauth.connect(
      { integrationID: "kilo", methodID: "device", location },
      { signal: AbortSignal.timeout(5000) },
    )
    expect(attempt.data.url).toBe(`http://127.0.0.1:${gateway.port}/verify`)
    const deadline = Date.now() + 5000
    while (true) {
      const status = await client.integration.oauth.status({
        integrationID: "kilo",
        attemptID: attempt.data.attemptID,
        location,
      })
      if (status.data.status === "complete") break
      if (status.data.status !== "pending")
        throw new Error(`Device login did not complete: ${JSON.stringify(status.data)}`)
      if (Date.now() > deadline) throw new Error("Device login timed out")
      await Bun.sleep(20)
    }
    const active = await client.provider.get({ providerID: "kilo", location })
    expect(active.data).toMatchObject({
      settings: { baseURL: `http://127.0.0.1:${gateway.port}/api/gateway` },
      headers: { "X-KILOCODE-ORGANIZATIONID": "org-fixture" },
    })
    expect(active.data.headers).not.toHaveProperty("x-kilocode-organizationid")
    const malformed = await fetch(rpcURL, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ input: { organizationID: 1 } }),
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ _tag: "RpcError", type: "rpc.invalid_input" })
    try {
      await client.kilocode.organization.set({ organizationID: "missing" })
      throw new Error("Unknown Kilo organization was accepted")
    } catch (error) {
      expect(error).toMatchObject({
        type: "kilocode.gateway",
        message: "The selected Kilo organization is not available",
      })
    }
    const session = await client.session.create({ location, model: { providerID: "kilo", id: "chat" } })
    await client.session.prompt({ sessionID: session.id, text: "Greet me" })
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
    expect(JSON.stringify(await client.message.list({ sessionID: session.id }))).toContain("Gateway fixture response")
    expect(requests.length).toBeGreaterThan(0)
    requests.forEach((request) =>
      expect(request).toEqual({ authorization: "Bearer fixture-token", organization: "org-fixture" }),
    )
    expect(await client.session.active()).toEqual({})
    await expect(client.kilocode.session.share({ sessionID: session.id })).rejects.toMatchObject({
      type: "kilocode.session",
      message: "Team session sharing is not supported in this preview yet",
    })
    expect(sessionRequests).toEqual([])
    await client.kilocode.organization.set({ organizationID: null })
    const share = await client.kilocode.session.share({ sessionID: session.id })
    expect(share).toEqual({ url: `https://app.kilo.ai/s/${shareToken}` })
    const forkLocation = { directory: path.join(input.directory, "fork-project") }
    await mkdir(forkLocation.directory)
    const fork = await client.kilocode.session.fork({ share: share.url, location: forkLocation })
    expect(fork.id).not.toBe(session.id)
    expect(fork.parentID).toBeUndefined()
    expect(fork.location.directory.toString()).toBe(forkLocation.directory)
    expect(JSON.stringify(await client.message.list({ sessionID: fork.id }))).toContain("Gateway fixture response")
    await client.kilocode.session.unshare({ sessionID: session.id })
    expect(sessionRequests).toEqual([
      { path: "/api/session", authorization: "Bearer fixture-token" },
      { path: `/ingest/${session.id}?v=2`, authorization: "Bearer fixture-token" },
      { path: `/api/session/${session.id}/share`, authorization: "Bearer fixture-token" },
      { path: `/session/${shareToken}`, authorization: null },
      { path: `/api/session/${session.id}/unshare`, authorization: "Bearer fixture-token" },
    ])
    await client.plugin.awaitActivation({ location: forkLocation })
    await client.session.prompt({ sessionID: fork.id, text: "Continue in the imported project" })
    await client.session.wait({ sessionID: fork.id }, { signal: AbortSignal.timeout(10000) })
    expect(JSON.stringify(await client.message.list({ sessionID: fork.id }))).toContain(
      "Continue in the imported project",
    )
    const otherDirectory = path.join(input.directory, "other-project")
    await mkdir(otherDirectory)
    const otherLocation = { directory: otherDirectory }
    await client.plugin.awaitActivation({ location: otherLocation })
    const other = await client.session.create({ location: otherLocation, model: { providerID: "kilo", id: "chat" } })
    await client.session.prompt({ sessionID: other.id, text: "Warm the second location" })
    await client.session.wait({ sessionID: other.id })
    for (const organizationID of ["org-other", null, "org-fixture"] as const) {
      const selected = await client.kilocode.organization.set({ organizationID })
      expect(selected.currentOrganizationID).toBe(organizationID)
      expect((await client.kilocode.profile()).currentOrganizationID).toBe(organizationID)
      expect(JSON.stringify(selected)).not.toContain("fixture-token")
      for (const target of [session, other]) {
        const before = requests.length
        await client.session.prompt({ sessionID: target.id, text: "Verify the newly selected account" })
        await client.session.wait({ sessionID: target.id }, { signal: AbortSignal.timeout(10000) })
        expect(requests.length).toBeGreaterThan(before)
        requests
          .slice(before)
          .forEach((request) =>
            expect(request).toEqual({ authorization: "Bearer fixture-token", organization: organizationID }),
          )
      }
    }
  } catch (error) {
    child.kill("SIGTERM")
    await child.exited
    throw new Error(`Gateway integration failed\n${await errors}\nCause: ${Bun.inspect(error)}`, { cause: error })
  } finally {
    child.kill("SIGTERM")
    expect(await child.exited, await errors).toBe(0)
    await gateway.stop(true)
  }
})
