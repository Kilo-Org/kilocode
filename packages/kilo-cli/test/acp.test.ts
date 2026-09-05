import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { acpFixture, artifact, initialize, newSession, ok } from "./acp-fixture"

const root = path.resolve(import.meta.dir, "../../..")

test("initialize reports Kilo and an auth method Kilo can honour", async () => {
  await using acp = await acpFixture()
  const initialized = await initialize(acp.bridge)

  expect(initialized.protocolVersion).toBe(1)
  expect(initialized.agentCapabilities?.loadSession).toBe(true)
  expect(initialized.agentInfo?.name).toBe("Kilo")
  expect(initialized.agentInfo?.title).toBe("Kilo")
  expect(initialized.agentInfo?.version).not.toBe("")
  const method = initialized.authMethods?.find((entry) => entry.id === "opencode-login")
  expect(method?.name).toBe("Kilo host credentials")
  expect(method?.description).not.toContain("opencode auth login")
  // The preview ships no interactive login, so no terminal-auth flow is promised.
  expect(method?._meta).toBeUndefined()
  expect(ok(await acp.bridge.request<Record<string, never>>("authenticate", { methodId: "opencode-login" }))).toEqual(
    {},
  )
}, 120_000)

test("session/new, session/list, and session/load work against the Kilo host", async () => {
  await using acp = await acpFixture()
  await initialize(acp.bridge)
  const session = await newSession(acp.bridge, acp.cwd)
  expect(session.sessionId).toStartWith("ses_")

  const listed = ok(await acp.bridge.request<{ sessions: { sessionId: string }[] }>("session/list", { cwd: acp.cwd }))
  expect(listed.sessions.some((entry) => entry.sessionId === session.sessionId)).toBe(true)

  const loaded = ok(
    await acp.bridge.request<{ configOptions?: { id: string; category?: string }[] }>("session/load", {
      cwd: acp.cwd,
      sessionId: session.sessionId,
      mcpServers: [],
    }),
  )
  expect(loaded.configOptions?.some((option) => option.id === "model")).toBe(true)
}, 120_000)

test("session/prompt streams the fake model response and ends the turn", async () => {
  await using acp = await acpFixture({ reply: "Bridged fixture answer" })
  await initialize(acp.bridge)
  const session = await newSession(acp.bridge, acp.cwd)
  const update = acp.bridge.waitFor(
    "session/update",
    (params) => params.sessionId === session.sessionId && JSON.stringify(params).includes("Bridged fixture answer"),
  )
  const prompted = ok(
    await acp.bridge.request<{ stopReason: string }>("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "Greet me" }],
    }),
  )

  expect(prompted.stopReason).toBe("end_turn")
  await update
  expect(acp.model.requests.some((request) => request.stream)).toBe(true)
  expect(acp.bridge.output().stderr).not.toContain(acp.password)
  expect(acp.bridge.output().stdout).not.toContain(acp.password)
}, 120_000)

test("session/cancel ends an in-flight turn as cancelled", async () => {
  await using acp = await acpFixture()
  await initialize(acp.bridge)
  const session = await newSession(acp.bridge, acp.cwd)
  acp.model.hold("Hold this turn")
  const prompt = acp.bridge.request<{ stopReason: string }>("session/prompt", {
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: "Hold this turn" }],
  })
  await acp.bridge.waitFor("session/update", (params) => params.sessionId === session.sessionId)
  await acp.bridge.notify("session/cancel", { sessionId: session.sessionId })
  const cancelled = ok(await prompt)
  acp.model.release()

  expect(cancelled.stopReason).toBe("cancelled")
}, 120_000)

test("stdin EOF closes the bridge while the caller's host keeps running", async () => {
  await using acp = await acpFixture()
  await initialize(acp.bridge)
  const session = await newSession(acp.bridge, acp.cwd)

  expect(await acp.bridge.endStdin()).toBe(0)
  const response = await fetch(`${acp.url}/api/session/${session.sessionId}`, {
    headers: { authorization: `Basic ${btoa(`opencode:${acp.password}`)}` },
  })
  expect(response.status).toBe(200)
}, 120_000)

test("the bridge bundle excludes Core, Server, and the standalone launcher", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "kilo-acp-graph-"))
  try {
    const metafile = path.join(temporary, "meta.json")
    const child = Bun.spawn(
      [
        process.execPath,
        "build",
        "packages/cli/src/kilocode/acp.ts",
        "--target=bun",
        "--format=esm",
        "--packages=bundle",
        `--metafile=${metafile}`,
        `--outdir=${path.join(temporary, "out")}`,
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, stdout + stderr).toBe(0)
    const inputs: string[] = Object.keys((await Bun.file(metafile).json()).inputs).map((input) =>
      path.relative(root, path.resolve(root, input)).replaceAll(path.sep, "/"),
    )

    expect(inputs).toContain("packages/cli/src/acp/agent.ts")
    expect(inputs.filter((input) => input.startsWith("packages/core/"))).toEqual([])
    expect(inputs.filter((input) => input.startsWith("packages/server/"))).toEqual([])
    expect(inputs).not.toContain("packages/cli/src/services/standalone.ts")
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 60_000)

test("the launcher cancels an idle bridge once and restores its signal handlers", async () => {
  const built = await artifact()
  const { runAcp } = await import("../src/acp")
  const listeners = () => process.listenerCount("SIGINT") + process.listenerCount("SIGTERM")
  const before = listeners()
  const endpoint = { url: "http://127.0.0.1:1", auth: { password: "unused" } }
  const controller = new AbortController()
  const running = runAcp(endpoint, { artifact: built, signal: controller.signal })
  await Bun.sleep(250)
  controller.abort()

  // A running bridge shuts itself down on SIGTERM, so cancellation exits cleanly.
  expect(await running).toBe(0)
  // A repeated abort after the child is gone stays harmless and leaks no handler.
  controller.abort()
  expect(listeners()).toBe(before)

  // An already-aborted caller kills the bridge before it installs its handlers.
  const began = performance.now()
  expect(await runAcp(endpoint, { artifact: built, signal: AbortSignal.abort() })).toBe(143)
  expect(performance.now() - began).toBeLessThan(5_000)
  expect(listeners()).toBe(before)
}, 60_000)

test("the launcher refuses to run without a built artifact", async () => {
  const built = await artifact()
  const { runAcp } = await import("../src/acp")
  const empty = await mkdtemp(path.join(os.tmpdir(), "kilo-acp-missing-"))
  try {
    expect(runAcp({ url: "http://127.0.0.1:1", auth: { password: "unused" } }, { artifact: empty })).rejects.toThrow(
      /Missing the Kilo ACP bridge artifact/,
    )
    expect(await Bun.file(path.join(built, "acp.js")).exists()).toBe(true)
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
}, 120_000)
