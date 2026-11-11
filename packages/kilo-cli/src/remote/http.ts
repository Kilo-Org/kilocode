export * as RemoteHttp from "./http"

import type { ServerProcess } from "@opencode/server/process"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

// These compatibility paths enter the same authenticated RPC handler and location/plugin
// activation as every native client. They never bypass the server's authorization middleware.
export const transform: ServerProcess.Transform = (app) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const url = new URL(request.url, "http://localhost")
    const method =
      url.pathname === "/remote/status" && request.method === "GET"
        ? "status"
        : url.pathname === "/remote/enable" && request.method === "POST"
          ? "enable"
          : url.pathname === "/remote/disable" && request.method === "POST"
            ? "disable"
            : undefined
    if (!method) return yield* app
    url.pathname = `/api/rpc/kilocode.remote/${method}`
    if (!url.searchParams.has("location[directory]") && !request.headers["x-opencode-directory"])
      url.searchParams.set("location[directory]", process.cwd())
    const headers = new Headers(request.headers)
    headers.set("content-type", "application/json")
    headers.delete("content-length")
    const forwarded = HttpServerRequest.fromWeb(
      new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: {} }),
      }),
    )
    const response = yield* app.pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, forwarded))
    if (response.status !== 200) return response
    const body = yield* Effect.tryPromise(() => HttpServerResponse.toWeb(response).json())
    return HttpServerResponse.jsonUnsafe(body.output)
  })
