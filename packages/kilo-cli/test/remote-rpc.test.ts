import { expect, test } from "bun:test"
import { createClient } from "@kilocode/client"
import path from "node:path"
import { RemoteRpc } from "../src/remote-rpc"
import { fixture, ready } from "./fixture"

test("Remote requires explicit account-backed enable, remains location-scoped, and closes on logout", async () => {
  await using input = await fixture()
  const token = "fixture-remote-secret"
  const frames: string[] = []
  let opened = 0
  let closed = 0
  let socket: { send(value: string): void } | undefined
  const relay = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      expect(url.pathname).toBe("/api/user/cli")
      expect(url.searchParams.get("token")).toBe(token)
      if (server.upgrade(request)) return
      return new Response(null, { status: 400 })
    },
    websocket: {
      open(ws) {
        opened++
        socket = ws
      },
      message(_ws, message) {
        frames.push(String(message))
      },
      close() {
        closed++
      },
    },
  })
  const gateway = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/device-auth/codes")
        return Response.json({ code: "remote-fixture", verificationUrl: `${url.origin}/verify`, expiresIn: 60 })
      if (url.pathname === "/api/device-auth/codes/remote-fixture")
        return Response.json({ status: "approved", token, userEmail: "fixture@example.test" })
      if (url.pathname === "/api/profile")
        return Response.json({ user: { email: "fixture@example.test" }, organizations: [], hasPersonalAccount: true })
      return new Response(null, { status: 404 })
    },
  })
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "cloud-fixture.ts")], {
    cwd: input.cwd,
    env: { ...input.env, KILO_FIXTURE_GATEWAY: gateway.url.origin, KILO_FIXTURE_RELAY: relay.url.origin },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  })
  const errors = new Response(child.stderr).text()
  try {
    const listening = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    const client = createClient({
      baseUrl: listening.value,
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    })
    const location = { directory: input.cwd }
    await client.plugin.awaitActivation({ location })
    const rpc = client.rpc(RemoteRpc)
    expect(await rpc.status({}, { location })).toMatchObject({ enabled: false, connected: false, directory: input.cwd })
    await expect(rpc.enable({}, { location })).rejects.toThrow("Remote account is unavailable")
    expect(opened).toBe(0)
    const attempt = await client.integration.oauth.connect({ integrationID: "kilo", methodID: "device", location })
    await until(
      async () =>
        (await client.integration.oauth.status({ integrationID: "kilo", attemptID: attempt.data.attemptID, location }))
          .data.status === "complete",
    )
    expect((await rpc.status({}, { location })).enabled).toBe(false)
    expect(opened).toBe(0)
    const session = await client.session.create({ location, title: "Remote RPC fixture" })
    const status = await rpc.enable({}, { location })
    expect(status.enabled).toBe(true)
    expect(JSON.stringify(status)).not.toContain(token)
    await until(async () => (await rpc.status({}, { location })).connected && frames.length > 0)
    await rpc.enable({}, { location })
    expect(opened).toBe(1)
    expect(frames.some((frame) => frame.includes(session.id))).toBe(true)
    expect(frames.join("\n")).not.toContain(token)

    socket?.send(
      JSON.stringify({ type: "command", id: "create-rpc", command: "create_session", data: { protocolVersion: 1 } }),
    )
    await until(async () => frames.some((frame) => frame.includes("create-rpc")))
    expect((await client.session.list({ directory: input.cwd })).data).toHaveLength(2)
    expect(await rpc.disable({}, { location })).toMatchObject({ enabled: false, connected: false })
    await until(async () => closed === 1)
    await rpc.enable({}, { location })
    await until(async () => opened === 2)
    const integration = await client.integration.get({ integrationID: "kilo", location })
    const connection = integration.data?.connections.find((value) => value.type === "credential")
    if (!connection || connection.type !== "credential") throw new Error("Fixture credential missing")
    await client.credential.remove({ credentialID: connection.id, location })
    await until(async () => !(await rpc.status({}, { location })).enabled && closed === 2)
    await expect(rpc.enable({}, { location })).rejects.toThrow("Remote account is unavailable")
    expect(opened).toBe(2)
  } finally {
    child.kill("SIGTERM")
    await child.exited
    relay.stop(true)
    gateway.stop(true)
    expect(await errors).not.toContain(token)
  }
}, 30000)

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for Remote fixture")
    await Bun.sleep(20)
  }
}
