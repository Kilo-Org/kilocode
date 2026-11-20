import { expect, test } from "bun:test"
import { EOL } from "node:os"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

const AUTO_REJECTED = "run ended with an auto-rejected permission; pass --auto for autonomous use"
const REJECTED_FEEDBACK =
  "This non-interactive run cannot ask the user for permission, so the request was rejected. Continue without this action."

type Ask = { action: string; resources: string[]; metadata?: Record<string, unknown>; sessionID?: string }

type Scenario = {
  asks?: Ask[]
  format?: "default" | "json"
  auto?: boolean
  fail?: { type: string; message: string }
  replyStatus?: number
}

// A server that admits one prompt, asks for permission when the scenario wants one, and records the
// reply the run sends. Nothing reaches a model.
async function serve(directory: string, scenario: Scenario = {}) {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const prompted = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  let stream: ReadableStreamDefaultController<string> | undefined
  let promptID = "msg_prompt"
  let askIndex = 0

  const send = (event: Record<string, unknown>) => {
    stream?.enqueue(`data: ${JSON.stringify(event)}\n\n`)
  }

  const settle = () => {
    send({
      id: "evt_delivered",
      type: "session.inbox.delivered",
      durable: { aggregateID: "ses_1", seq: 1, version: 1 },
      data: { sessionID: "ses_1", inboxID: promptID },
    })
    if (scenario.fail)
      send({
        id: "evt_failed",
        type: "session.execution.failed",
        durable: { aggregateID: "ses_1", seq: 2, version: 1 },
        data: { sessionID: "ses_1", error: scenario.fail },
      })
    else
      send({
        id: "evt_succeeded",
        type: "session.execution.succeeded",
        durable: { aggregateID: "ses_1", seq: 2, version: 1 },
        data: { sessionID: "ses_1" },
      })
    finished.resolve()
  }

  const ask = () => {
    const next = scenario.asks?.[askIndex++]
    if (!next) return settle()
    send({
      id: `evt_ask_${askIndex}`,
      created: 1,
      type: "permission.asked",
      data: { id: `per_${askIndex}`, ...next, sessionID: next.sessionID ?? "ses_1" },
    })
  }

  const idle = () =>
    scenario.fail
      ? { id: "msg_idle", type: "idle", outcome: "failed", error: scenario.fail, time: { created: 5 } }
      : { id: "msg_idle", type: "idle", outcome: "succeeded", time: { created: 5 } }

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
      if (request.method === "GET" && url.pathname === "/api/session/ses_child")
        return Response.json({
          data: {
            id: "ses_child",
            parentID: "ses_1",
            projectID: "project",
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
          },
        })
      if (url.pathname === "/api/event")
        return new Response(
          new ReadableStream<string>({
            start(controller) {
              stream = controller
              controller.enqueue(
                `data: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n`,
              )
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      if (url.pathname === "/api/session/ses_1/prompt") {
        promptID = (JSON.parse(text) as { id: string }).id
        prompted.resolve()
        ask()
        return Response.json({
          data: { id: promptID, sessionID: "ses_1", type: "user", time: { created: 1 }, payload: {}, delivery: "steer" },
        })
      }
      if (request.method === "POST" && url.pathname.endsWith("/permission/per_1/reply")) {
        // Another client may have answered first on a shared server; the run's reply then fails.
        if (scenario.replyStatus) {
          setTimeout(settle, 10)
          return new Response(null, { status: scenario.replyStatus })
        }
        settle()
        return new Response(null, { status: 204 })
      }
      if (request.method === "POST" && url.pathname.endsWith("/wait")) {
        await finished.promise
        return new Response(null, { status: 204 })
      }
      if (request.method === "GET" && url.pathname === "/api/session/ses_1/message")
        return Response.json({
          data: [idle(), { id: promptID, type: "user", text: "hello", time: { created: 1 } }],
          cursor: {},
        })
      if (request.method === "GET" && url.pathname === "/api/form")
        return Response.json({ location: { ...location, project: { id: "project", directory } }, data: [] })
      if (request.method === "GET") return Response.json({ data: [] })
      return new Response(null, { status: 404 })
    },
  })
  return { server, requests, prompted: prompted.promise }
}

function spawnRun(url: string, directory: string, scenario: Scenario) {
  return Bun.spawn(
    [
      process.execPath,
      "run",
      "src/index.ts",
      "run",
      "--server",
      url,
      ...(scenario.format === "json" ? ["--format", "json"] : []),
      ...(scenario.auto ? ["--auto"] : []),
      "hello",
    ],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: isolatedEnv(directory, { PWD: directory }),
      signal: AbortSignal.timeout(25_000),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
}

async function run(scenario: Scenario = {}) {
  await using directory = await tmpdir()
  const fake = await serve(directory.path, scenario)
  const child = spawnRun(fake.server.url.toString(), directory.path, scenario)
  try {
    await fake.prompted
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, exitCode, requests: fake.requests }
  } finally {
    child.kill("SIGKILL")
    await child.exited.catch(() => {})
    await fake.server.stop(true)
  }
}

const bash: Ask = { action: "bash", resources: ["sed -n 1,5p README.md"] }

test("a plain run that auto-rejected a permission ask exits nonzero with the diagnostic", async () => {
  const result = await run({ asks: [bash] })
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("permission requested: bash")
  expect(result.stderr).toContain("auto-rejecting")
  expect(result.stderr).toContain(AUTO_REJECTED)
  expect(result.requests.find((item) => item.path.endsWith("/reply"))?.body).toEqual({
    decision: "reject",
    message: REJECTED_FEEDBACK,
  })
}, 30_000)

test("a plain run that auto-rejected a permission ask emits the diagnostic as a JSON error event", async () => {
  const result = await run({ asks: [bash], format: "json" })
  expect(result.exitCode).toBe(1)
  const events = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  expect(events.find((event) => event.type === "error")).toMatchObject({
    sessionID: "ses_1",
    error: { message: expect.stringContaining(AUTO_REJECTED) },
  })
  // The event is the only carrier in JSON mode; printing it again would duplicate it.
  expect(result.stderr).not.toContain(AUTO_REJECTED)
}, 30_000)

test("a plain run fails when a subagent's ask was auto-rejected", async () => {
  const result = await run({ asks: [{ ...bash, sessionID: "ses_child" }] })
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain(AUTO_REJECTED)
  expect(result.requests.find((item) => item.path === "/api/session/ses_child/permission/per_1/reply")?.body).toEqual({
    decision: "reject",
    message: REJECTED_FEEDBACK,
  })
}, 30_000)

test("a run with no permission asks exits 0", async () => {
  const result = await run()
  expect(result.exitCode).toBe(0)
  expect(result.stderr).not.toContain(AUTO_REJECTED)
}, 30_000)

test("--auto approves a permission ask and exits 0", async () => {
  const result = await run({ asks: [bash], auto: true })
  expect(result.exitCode).toBe(0)
  expect(result.stderr).not.toContain(AUTO_REJECTED)
  expect(result.requests.find((item) => item.path.endsWith("/reply"))?.body).toEqual({ decision: "once" })
}, 30_000)

test("--auto rejects a request only a person can approve without failing the run", async () => {
  const result = await run({ asks: [{ ...bash, metadata: { interactive: true } }], auto: true })
  expect(result.exitCode).toBe(0)
  expect(result.stderr).not.toContain(AUTO_REJECTED)
  expect(result.requests.find((item) => item.path.endsWith("/reply"))?.body).toEqual({ decision: "reject" })
}, 30_000)

test("does not fail a run whose permission reply failed because another client answered first", async () => {
  const result = await run({ asks: [bash], replyStatus: 404 })
  expect(result.requests.some((item) => item.path.endsWith("/reply"))).toBe(true)
  expect(result.exitCode).toBe(0)
  expect(result.stderr).not.toContain(AUTO_REJECTED)
}, 30_000)

const failure = { type: "provider.transport", message: "provider exploded" }

test("a failed session that also auto-rejected keeps both messages in one diagnostic", async () => {
  const result = await run({ asks: [bash], fail: failure })
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain(`provider exploded${EOL}${AUTO_REJECTED}`)
  expect(result.stderr.split(AUTO_REJECTED)).toHaveLength(2)
}, 30_000)

test("a failed session that also auto-rejected emits one JSON error event with both messages", async () => {
  const result = await run({ asks: [bash], fail: failure, format: "json" })
  expect(result.exitCode).toBe(1)
  const errors = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "error")
  expect(errors).toHaveLength(1)
  expect(errors[0].error).toEqual({ type: "provider.transport", message: `provider exploded${EOL}${AUTO_REJECTED}` })
}, 30_000)
