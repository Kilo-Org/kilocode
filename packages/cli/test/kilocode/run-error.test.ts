import { describe, expect, test } from "bun:test"
import path from "node:path"
import { formatKiloRunError, kiloErrorLine, parseKiloErrorCode, type StructuredRunError } from "../../src/kilocode/run-error"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

const SIGNED_OUT_BODY = JSON.stringify({
  error: { code: "INVALID_TOKEN", message: "Your authentication token is invalid. Please sign in again." },
  error_type: "authentication_required",
})

const SIGNED_OUT_LINE = "You've been signed out of Kilo. Run `kilo auth login` to connect to Kilo Gateway."

describe("kilo run error formatting", () => {
  test("recognizes INVALID_TOKEN only on HTTP 401", () => {
    expect(parseKiloErrorCode({ status: 401, response: { body: SIGNED_OUT_BODY } })).toBe("INVALID_TOKEN")
    expect(parseKiloErrorCode({ status: 400, response: { body: SIGNED_OUT_BODY } })).toBeUndefined()
    expect(parseKiloErrorCode({ response: { body: SIGNED_OUT_BODY } })).toBeUndefined()
  })

  test("formats a one-line message naming kilo auth login for Kilo errors", () => {
    expect(kiloErrorLine({ status: 401, response: { body: SIGNED_OUT_BODY } })).toBe(SIGNED_OUT_LINE)
    expect(
      kiloErrorLine({ status: 401, response: { body: JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } }) } }),
    ).toBe("You need to sign in to use this model. Run `kilo auth login` to connect to Kilo Gateway.")
    expect(
      kiloErrorLine({ status: 429, response: { body: JSON.stringify({ code: "PROMOTION_MODEL_LIMIT_REACHED" }) } }),
    ).toBe("You need to sign up to keep going. Run `kilo auth login` to connect to Kilo Gateway.")
  })

  test("leaves non-Kilo, non-401 INVALID_TOKEN, and malformed errors unchanged", () => {
    const non401: StructuredRunError = {
      type: "provider.invalid-request",
      message: "Bad request",
      status: 400,
      response: { body: SIGNED_OUT_BODY },
    }
    expect(formatKiloRunError(non401)).toBe(non401)

    const malformed: StructuredRunError = {
      type: "provider.auth",
      message: "Unauthorized",
      status: 401,
      response: { body: "not json {" },
    }
    expect(formatKiloRunError(malformed)).toBe(malformed)
    expect(formatKiloRunError(undefined)).toBeUndefined()
  })
})

async function runWithFailure(fail: StructuredRunError, format: "default" | "json" = "default") {
  await using directory = await tmpdir()
  const prompted = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const location = { directory: directory.path, project: { id: "project", directory: directory.path, canonical: directory.path } }
  let stream: ReadableStreamDefaultController<string> | undefined
  let promptID = "msg_prompt"

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const text = await request.text()
      if (url.pathname === "/api/info")
        return Response.json({ version: "test", pid: 0, urls: [], paths: { tmp: directory.path } })
      if (request.method === "GET" && url.pathname === "/api/location") return Response.json(location)
      if (request.method === "POST" && url.pathname === "/api/session")
        return Response.json({
          data: {
            id: "ses_1",
            projectID: "project",
            location: { directory: directory.path },
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
        stream?.enqueue(
          `data: ${JSON.stringify({
            id: "evt_delivered",
            type: "session.inbox.delivered",
            durable: { aggregateID: "ses_1", seq: 1, version: 1 },
            data: { sessionID: "ses_1", inboxID: promptID },
          })}\n\n`,
        )
        stream?.enqueue(
          `data: ${JSON.stringify({
            id: "evt_failed",
            type: "session.execution.failed",
            durable: { aggregateID: "ses_1", seq: 2, version: 1 },
            data: { sessionID: "ses_1", error: fail },
          })}\n\n`,
        )
        finished.resolve()
        return Response.json({
          data: { id: promptID, sessionID: "ses_1", type: "user", time: { created: 1 }, payload: {}, delivery: "steer" },
        })
      }
      if (request.method === "POST" && url.pathname.endsWith("/wait")) {
        await finished.promise
        return new Response(null, { status: 204 })
      }
      if (request.method === "GET" && url.pathname === "/api/session/ses_1/message")
        return Response.json({
          data: [
            { id: "msg_idle", type: "idle", outcome: "failed", error: fail, time: { created: 5 } },
            { id: promptID, type: "user", text: "hello", time: { created: 1 } },
          ],
          cursor: {},
        })
      if (request.method === "GET") return Response.json({ data: [] })
      return new Response(null, { status: 404 })
    },
  })

  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "src/index.ts",
      "run",
      "--server",
      server.url.toString(),
      ...(format === "json" ? ["--format", "json"] : []),
      "hello",
    ],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: isolatedEnv(directory.path, { PWD: directory.path }),
      signal: AbortSignal.timeout(25_000),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    await prompted.promise
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, exitCode }
  } finally {
    child.kill("SIGKILL")
    await child.exited.catch(() => {})
    await server.stop(true)
  }
}

test("kilo run prints the signed-out line naming kilo auth login on 401 INVALID_TOKEN", async () => {
  const result = await runWithFailure({
    type: "provider.auth",
    message: "Your authentication token is invalid. Please sign in again.",
    status: 401,
    response: { body: SIGNED_OUT_BODY },
  })
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain(SIGNED_OUT_LINE)
}, 30_000)

test("kilo run emits the signed-out line in JSON format on 401 INVALID_TOKEN", async () => {
  const result = await runWithFailure(
    {
      type: "provider.auth",
      message: "Your authentication token is invalid. Please sign in again.",
      status: 401,
      response: { body: SIGNED_OUT_BODY },
    },
    "json",
  )
  expect(result.exitCode).toBe(1)
  const events = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  expect(events.find((event) => event.type === "error")).toMatchObject({
    sessionID: "ses_1",
    error: { type: "provider.auth", message: SIGNED_OUT_LINE },
  })
}, 30_000)
