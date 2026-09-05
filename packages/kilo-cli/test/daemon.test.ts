import { expect, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import { randomUUID } from "node:crypto"
import { chmodSync, lstatSync } from "node:fs"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import manifest from "../package.json"
import { fixture, type Fixture } from "./fixture"

const entry = path.join(import.meta.dir, "daemon-fixture.ts")

type Endpoint = { url: string; auth: { type: "basic"; username: string; password: string } }
type Status =
  | { state: "stopped"; file: string }
  | { state: "running"; file: string; endpoint: Endpoint; pid: number; version: string }
  | { state: "stale"; file: string; pid: number; version: string; alive: boolean; verified: boolean }

async function control(input: Fixture, command: string, env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, "--no-env-file", entry, command], {
    cwd: input.cwd,
    env: { ...input.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 45000,
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

async function started(input: Fixture, env?: Record<string, string>) {
  const result = await control(input, "start", env)
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as Endpoint
}

async function reported(input: Fixture) {
  const result = await control(input, "status")
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as Status
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function exited(pid: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (!alive(pid)) return
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for daemon process ${pid} to exit`)
}

async function shutdown(input: Fixture) {
  const found = await reported(input)
  if (found.state === "running") {
    expect((await control(input, "stop")).code).toBe(0)
    await exited(found.pid)
    return
  }
  if (found.state === "stale" && found.alive) {
    process.kill(found.pid, "SIGKILL")
    await exited(found.pid)
  }
}

async function plant(input: Fixture, content: string) {
  const state = path.join(input.env.XDG_STATE_HOME, "kilo2", "interactive")
  await mkdir(state, { recursive: true, mode: 0o700 })
  const file = path.join(state, "daemon.json")
  await writeFile(file, content)
  chmodSync(file, 0o600)
  return file
}

test("the managed daemon starts, is discoverable and authenticated, and keeps sessions across a restart", async () => {
  await using input = await fixture()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { stream?: boolean } = await request.json()
      if (!body.stream)
        return Response.json({
          id: "daemon",
          object: "chat.completion",
          created: 1,
          model: "chat",
          choices: [{ index: 0, message: { role: "assistant", content: "Daemon response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      const frames = [
        { choices: [{ index: 0, delta: { role: "assistant", content: "Daemon response" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ]
      return new Response(
        frames
          .map(
            (frame) =>
              `data: ${JSON.stringify({ id: "daemon", object: "chat.completion.chunk", created: 1, model: "chat", ...frame })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  })
  const env = {
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
  try {
    const endpoint = await started(input, env)
    expect(endpoint.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const running = await reported(input)
    if (running.state !== "running") throw new Error(`Expected a running daemon: ${JSON.stringify(running)}`)
    expect(running.endpoint.url).toBe(endpoint.url)
    expect(running.file).toBe(path.join(input.env.XDG_STATE_HOME, "kilo2", "interactive", "daemon.json"))
    expect(lstatSync(running.file).mode & 0o777).toBe(0o600)
    expect(endpoint.auth.password).toBe(
      (await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2", "interactive", "server.password")).text()).trim(),
    )
    // The stable kilo/opencode service registration is never created by the isolated daemon.
    expect(lstatSync(path.join(input.env.XDG_STATE_HOME, "opencode"), { throwIfNoEntry: false })).toBeUndefined()

    const authorization = { authorization: `Basic ${btoa(`${endpoint.auth.username}:${endpoint.auth.password}`)}` }
    expect((await fetch(new URL("/api/health", endpoint.url))).status).toBe(401)
    expect(
      (await fetch(new URL("/api/health", endpoint.url), { headers: { authorization: `Basic ${btoa("opencode:x")}` } }))
        .status,
    ).toBe(401)
    const health = await fetch(new URL("/api/health", endpoint.url), { headers: authorization })
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ healthy: true, pid: running.pid })

    // Starting again adopts the running daemon instead of spawning a second one.
    const again = await started(input, env)
    expect(again.url).toBe(endpoint.url)
    const adopted = await reported(input)
    if (adopted.state !== "running") throw new Error("Expected the daemon to stay running")
    expect(adopted.pid).toBe(running.pid)

    const client = OpenCode.make({ baseUrl: endpoint.url, headers: authorization })
    const session = await client.session.create({
      location: { directory: input.cwd },
      model: { providerID: "fixture", id: "chat" },
    })
    await client.session.prompt({ sessionID: session.id, text: "Greet me" })
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(20000) })
    expect(JSON.stringify(await client.message.list({ sessionID: session.id }))).toContain("Daemon response")

    expect((await control(input, "stop")).code).toBe(0)
    await exited(running.pid)
    expect(await reported(input)).toEqual({ state: "stopped", file: running.file })
    expect(lstatSync(running.file, { throwIfNoEntry: false })).toBeUndefined()

    const restarted = await started(input, env)
    const successor = await reported(input)
    if (successor.state !== "running") throw new Error("Expected the daemon to restart")
    expect(successor.pid).not.toBe(running.pid)
    const reattached = OpenCode.make({
      baseUrl: restarted.url,
      headers: { authorization: `Basic ${btoa(`${restarted.auth.username}:${restarted.auth.password}`)}` },
    })
    expect(JSON.stringify(await reattached.message.list({ sessionID: session.id }))).toContain("Daemon response")
    await reattached.session.prompt({ sessionID: session.id, text: "Greet me again" })
    await reattached.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(20000) })
    expect(await reattached.session.active()).toEqual({})
  } finally {
    await shutdown(input).catch(() => {})
    await model.stop(true)
  }
})

test("stale daemon metadata fails closed and only a fresh start replaces it", async () => {
  await using input = await fixture()
  try {
    await started(input)
    const running = await reported(input)
    if (running.state !== "running") throw new Error("Expected a running daemon")
    process.kill(running.pid, "SIGKILL")
    await exited(running.pid)

    const stale = await reported(input)
    expect(stale).toEqual({
      state: "stale",
      file: running.file,
      pid: running.pid,
      version: running.version,
      alive: false,
      verified: false,
    })
    const refused = await control(input, "stop")
    expect(refused.code).not.toBe(0)
    expect(refused.stderr).toContain("Refusing to stop an unverified Kilo daemon registration")
    expect(lstatSync(running.file, { throwIfNoEntry: false })).toBeDefined()

    await started(input)
    const replacement = await reported(input)
    if (replacement.state !== "running") throw new Error("Expected the daemon to replace stale metadata")
    expect(replacement.pid).not.toBe(running.pid)
  } finally {
    await shutdown(input).catch(() => {})
  }
})

test("a second daemon refuses the contended isolated store instead of replacing the running one", async () => {
  await using input = await fixture()
  try {
    await started(input)
    const running = await reported(input)
    if (running.state !== "running") throw new Error("Expected a running daemon")
    const duplicate = await control(input, "serve")
    expect(duplicate.code).not.toBe(0)
    expect(duplicate.stderr).toContain("Timed out waiting for lock: kilo2-interactive")
    const survivor = await reported(input)
    if (survivor.state !== "running") throw new Error("Expected the first daemon to survive")
    expect(survivor.pid).toBe(running.pid)
    expect(survivor.endpoint.url).toBe(running.endpoint.url)
  } finally {
    await shutdown(input).catch(() => {})
  }
})

test("an unresponsive registration owned by a live unrelated process is never replaced or signaled", async () => {
  await using input = await fixture()
  // A loopback listener that accepts the health request and never answers it, so the probe times out
  // exactly the way upstream's own health timeout escalation does.
  const unresponsive = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => {}) })
  const unrelated = Bun.spawn([process.execPath, "--no-env-file", "-e", "setTimeout(() => {}, 30000)"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  try {
    const content = JSON.stringify({
      id: randomUUID(),
      version: manifest.version,
      url: `http://127.0.0.1:${unresponsive.port}`,
      pid: unrelated.pid,
      password: "a".repeat(64),
    })
    const file = await plant(input, content)

    const refused = await control(input, "start")
    expect(refused.code).not.toBe(0)
    expect(refused.stderr).toContain(
      `Refusing to replace an unverified Kilo daemon registration (pid ${unrelated.pid} is running)`,
    )
    expect(alive(unrelated.pid)).toBe(true)
    expect(await Bun.file(file).text()).toBe(content)

    const stopping = await control(input, "stop")
    expect(stopping.code).not.toBe(0)
    expect(stopping.stderr).toContain(
      `Refusing to stop an unverified Kilo daemon registration (pid ${unrelated.pid} is running)`,
    )
    expect(alive(unrelated.pid)).toBe(true)
    expect(await Bun.file(file).text()).toBe(content)

    const found = await reported(input)
    expect(found).toEqual({
      state: "stale",
      file,
      pid: unrelated.pid,
      version: manifest.version,
      alive: true,
      verified: false,
    })
  } finally {
    unrelated.kill("SIGKILL")
    await unrelated.exited
    await unresponsive.stop(true)
  }
})

test("unreadable, foreign, symlinked, and protected daemon metadata fails closed", async () => {
  await using input = await fixture()
  const owned = {
    id: randomUUID(),
    version: manifest.version,
    url: "http://127.0.0.1:65000",
    pid: process.pid,
    password: "a".repeat(64),
  }

  const file = await plant(input, "{ not json")
  for (const command of ["status", "start", "stop"]) {
    const result = await control(input, command)
    expect(result.code, command).not.toBe(0)
    expect(result.stderr, command).toContain(`Refusing an unreadable daemon registration: ${file}`)
  }
  expect(await Bun.file(file).text()).toBe("{ not json")

  await plant(input, JSON.stringify({ ...owned, url: "http://example.com:8080" }))
  expect((await control(input, "status")).stderr).toContain("is not a loopback endpoint")

  await plant(input, JSON.stringify({ ...owned, password: "short" }))
  expect((await control(input, "status")).stderr).toContain("without an owned server password")

  await plant(input, JSON.stringify(owned))
  chmodSync(file, 0o644)
  expect((await control(input, "status")).stderr).toContain("must be private to its owner")

  const elsewhere = path.join(input.directory, "foreign.json")
  await writeFile(elsewhere, JSON.stringify(owned), { mode: 0o600 })
  await Bun.file(file).delete()
  await symlink(elsewhere, file)
  const linked = await control(input, "status")
  expect(linked.code).not.toBe(0)
  expect(linked.stderr).toContain(`Refusing a symlinked daemon registration: ${file}`)

  // An isolated layout that would resolve inside stable Kilo/OpenCode storage is refused outright.
  const protectedState = await control(input, "status", {
    XDG_STATE_HOME: path.join(input.home, ".local", "state", "kilo"),
  })
  expect(protectedState.code).not.toBe(0)
  expect(protectedState.stderr).toContain("Refusing a protected Kilo/OpenCode path")
})
