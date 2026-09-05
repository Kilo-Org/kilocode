import path from "node:path"
import { InvalidRequestError, UnauthorizedError } from "@opencode-ai/protocol/errors"
import { authorizedRequest } from "@opencode-ai/server/middleware/authorization"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Effect, Option, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { credential } from "./auth"
import { open } from "./host"
import type { Layout } from "./paths"

const bodyLimit = 1024 * 1024
const bodyTimeout = 5000
const json = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const create = Schema.decodeUnknownOption(
  Schema.Struct({
    id: Schema.optional(Session.ID),
    title: Schema.optional(Schema.String),
    location: Schema.Struct({ directory: Schema.String }),
  }),
  { onExcessProperty: "error" },
)
const prompt = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.optional(SessionMessage.ID), text: Schema.String, resume: Schema.Literal(false) }),
  { onExcessProperty: "error" },
)

export function serve(input: Layout, port: number) {
  return Effect.gen(function* () {
    const password = credential(input.password)
    const auth = { username: "opencode", password: Option.some(password) }
    const handler = yield* open(input, password)
    const server = yield* Effect.acquireRelease(
      Effect.try(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port,
          idleTimeout: 10,
          maxRequestBodySize: bodyLimit,
          fetch: async (request, server) => {
            if (!(await Effect.runPromise(authorizedRequest(HttpServerRequest.fromWeb(request), auth)))) {
              return Response.json(
                Schema.encodeSync(UnauthorizedError)(new UnauthorizedError({ message: "Authentication required" })),
                { status: 401, headers: { "www-authenticate": 'Basic realm="Secure Area"', connection: "close" } },
              )
            }
            const pathname = new URL(request.url).pathname
            const read =
              request.method === "GET" &&
              (["/api/health", "/api/event", "/api/session/active"].includes(pathname) ||
                /^\/api\/session\/[A-Za-z0-9_-]+\/inbox$/.test(pathname))
            const admission = request.method === "POST" && /^\/api\/session\/[A-Za-z0-9_-]+\/prompt$/.test(pathname)
            const creation = request.method === "POST" && pathname === "/api/session"
            if (!read && !admission && !creation) {
              return Response.json(
                { message: "Route unavailable in the admission-only preview" },
                { status: 404, headers: { connection: "close" } },
              )
            }
            if (admission || creation) {
              const bytes = await readBody(request)
              if (bytes instanceof Response) return bytes
              const body = json(new TextDecoder().decode(bytes))
              if (Option.isNone(body)) return invalid("Expected a JSON request body")
              if (creation) {
                const decoded = create(body.value)
                if (Option.isNone(decoded) || !path.isAbsolute(decoded.value.location.directory)) {
                  return invalid(
                    "Session creation requires an explicit absolute local directory; only id/title are optional",
                  )
                }
              }
              if (admission && Option.isNone(prompt(body.value))) {
                return invalid("This preview accepts text-only prompts with resume: false; execution is not enabled")
              }
              const headers = new Headers(request.headers)
              headers.delete("content-length")
              headers.delete("transfer-encoding")
              return handler(
                new Request(request.url, {
                  method: request.method,
                  headers,
                  body: bytes,
                  signal: request.signal,
                }),
              )
            }
            if (pathname === "/api/event") server.timeout(request, 0)
            return handler(request)
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    console.log("Kilo internal preview: admission-only server ready")
    console.log(`URL: http://127.0.0.1:${server.port}`)
    console.log(`Database: ${input.database}`)
    console.log(`Basic auth username: opencode; password file: ${input.password}`)
    console.log("Execution, PTYs, and recovery are unavailable in this slice.")
    return yield* Effect.never
  })
}

async function readBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    void reader.cancel().catch(() => undefined)
  }, bodyTimeout)
  try {
    while (true) {
      const chunk = await reader.read()
      if (timedOut) {
        return Response.json({ message: "Request body timed out" }, { status: 408, headers: { connection: "close" } })
      }
      if (chunk.done) return new Uint8Array(await new Blob(chunks).arrayBuffer())
      size += chunk.value.byteLength
      if (size > bodyLimit) {
        void reader.cancel().catch(() => undefined)
        return Response.json({ message: "Request body too large" }, { status: 413, headers: { connection: "close" } })
      }
      chunks.push(chunk.value)
    }
  } catch {
    return Response.json(
      { message: timedOut ? "Request body timed out" : "Request body unavailable" },
      { status: timedOut ? 408 : 400, headers: { connection: "close" } },
    )
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

function invalid(message: string) {
  return Response.json(Schema.encodeSync(InvalidRequestError)(new InvalidRequestError({ message })), { status: 400 })
}
