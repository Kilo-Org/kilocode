import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { HttpApiApp } from "../../../src/server/routes/instance/httpapi/server"
import { ServerAuth } from "../../../src/server/auth"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

const original = {
  password: Flag.KILO_SERVER_PASSWORD,
  username: Flag.KILO_SERVER_USERNAME,
  envPassword: process.env.KILO_SERVER_PASSWORD,
  envUsername: process.env.KILO_SERVER_USERNAME,
}

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = original.password
  Flag.KILO_SERVER_USERNAME = original.username
  if (original.envPassword === undefined) delete process.env.KILO_SERVER_PASSWORD
  else process.env.KILO_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.KILO_SERVER_USERNAME
  else process.env.KILO_SERVER_USERNAME = original.envUsername
  await disposeAllInstances()
  await resetDatabase()
})

function app(password: string) {
  Flag.KILO_SERVER_PASSWORD = password
  Flag.KILO_SERVER_USERNAME = undefined
  process.env.KILO_SERVER_PASSWORD = password
  delete process.env.KILO_SERVER_USERNAME
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            KILO_SERVER_PASSWORD: password,
            KILO_SERVER_USERNAME: undefined,
            KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "true",
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return (input: string, init?: RequestInit) =>
    handler(
      new Request(new URL(input, "http://localhost"), init),
      HttpApiApp.context,
    )
}

describe("telemetry level", () => {
  test("persists the config value and reads it back", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const password = "secret"
    const request = app(password)
    const auth = ServerAuth.header({ username: "kilo", password }) ?? ""
    const route = (path: string) => `${path}?directory=${encodeURIComponent(tmp.path)}`
    const headers = { authorization: auth, "content-type": "application/json" }

    const off = await request(route("/telemetry/level"), {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: false }),
    })
    expect(off.status).toBe(200)
    expect(await off.json()).toEqual({ enabled: false })

    const read = await request(route("/telemetry/level"), { headers })
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ enabled: false })

    const on = await request(route("/telemetry/level"), {
      method: "POST",
      headers,
      body: JSON.stringify({ enabled: true }),
    })
    expect(on.status).toBe(200)
    expect(await on.json()).toEqual({ enabled: true })
  })

  test("requires auth", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const request = app("secret")
    const res = await request(`/telemetry/level?directory=${encodeURIComponent(tmp.path)}`)
    expect(res.status).toBe(401)
  })
})
