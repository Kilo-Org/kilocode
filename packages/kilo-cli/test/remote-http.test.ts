import { expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { RemoteHttp } from "../src/remote/http"

for (const [method, operation] of [
  ["GET", "status"],
  ["POST", "enable"],
  ["POST", "disable"],
] as const) {
  test(`remote HTTP ${operation} preserves authentication and uses native RPC`, async () => {
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      expect(request.method).toBe("POST")
      expect(new URL(request.url, "http://localhost").pathname).toBe(`/api/rpc/kilocode.remote/${operation}`)
      expect(request.headers.authorization).toBe("Basic fixture")
      expect(yield* request.json).toEqual({ input: {} })
      return HttpServerResponse.jsonUnsafe({ output: { enabled: operation !== "disable", connected: true } })
    })
    const response = await Effect.runPromise(
      RemoteHttp.transform(app).pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request(`http://localhost/remote/${operation}`, {
              method,
              headers: { authorization: "Basic fixture" },
            }),
          ),
        ),
        Effect.scoped,
      ),
    )
    expect(await HttpServerResponse.toWeb(response).json()).toEqual({
      enabled: operation !== "disable",
      connected: true,
    })
  })
}

test("remote HTTP aliases preserve unauthorized responses", async () => {
  const response = await Effect.runPromise(
    RemoteHttp.transform(Effect.succeed(HttpServerResponse.empty({ status: 401 }))).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("http://localhost/remote/status")),
      ),
      Effect.scoped,
    ),
  )
  expect(response.status).toBe(401)
})
