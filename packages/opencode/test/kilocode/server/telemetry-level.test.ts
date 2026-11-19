import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { parse } from "jsonc-parser"
import path from "node:path"
import { HttpApiApp } from "../../../src/server/routes/instance/httpapi/server"
import { ServerAuth } from "../../../src/server/auth"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

const original = {
  password: Flag.KILO_SERVER_PASSWORD,
  username: Flag.KILO_SERVER_USERNAME,
  envPassword: process.env.KILO_SERVER_PASSWORD,
  envUsername: process.env.KILO_SERVER_USERNAME,
  level: process.env.KILO_TELEMETRY_LEVEL,
}

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = original.password
  Flag.KILO_SERVER_USERNAME = original.username
  if (original.envPassword === undefined) delete process.env.KILO_SERVER_PASSWORD
  else process.env.KILO_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.KILO_SERVER_USERNAME
  else process.env.KILO_SERVER_USERNAME = original.envUsername
  if (original.level === undefined) delete process.env.KILO_TELEMETRY_LEVEL
  else process.env.KILO_TELEMETRY_LEVEL = original.level
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
    handler(new Request(new URL(input, "http://localhost"), init), HttpApiApp.context)
}

describe("telemetry level", () => {
  test.each(["", "off"])(
    "persists the preference and honors the effective environment level (%j)",
    async (env) => {
      process.env.KILO_TELEMETRY_LEVEL = env
      await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
      const password = "secret"
      const request = app(password)
      const auth = ServerAuth.header({ username: "kilo", password }) ?? ""
      const route = (path: string) => `${path}?directory=${encodeURIComponent(tmp.path)}`
      const headers = { authorization: auth, "content-type": "application/json" }
      const get = () => request(route("/telemetry/level"), { headers })
      const post = (path: string, enabled: boolean) =>
        request(route(path), { method: "POST", headers, body: JSON.stringify({ enabled }) })

      const off = await post("/telemetry/level", false)
      expect(off.status).toBe(200)
      expect(await off.json()).toEqual({ enabled: false })
      expect((await post("/telemetry/setEnabled", true)).status).toBe(200)
      expect(await (await get()).json()).toEqual({ enabled: false })

      expect((await post("/telemetry/setEnabled", false)).status).toBe(200)
      const on = await post("/telemetry/level", true)
      expect(on.status).toBe(200)
      expect(await on.json()).toEqual({ enabled: false })
      expect(parse(await Bun.file(path.join(Global.Path.config, "kilo.jsonc")).text())).toMatchObject({
        experimental: { openTelemetry: true },
      })

      expect((await post("/telemetry/setEnabled", true)).status).toBe(200)
      const read = await get()
      expect(read.status).toBe(200)
      expect(await read.json()).toEqual({ enabled: env !== "off" })
    },
    20_000,
  )

  test("requires auth", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const request = app("secret")
    const res = await request(`/telemetry/level?directory=${encodeURIComponent(tmp.path)}`)
    expect(res.status).toBe(401)
  }, 20_000)
})
