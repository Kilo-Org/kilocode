import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import { withTimeout } from "../../../src/util/timeout"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances } from "../../fixture/fixture"

void Log.init({ print: false })

const original = {
  KILO_SERVER_PASSWORD: Flag.KILO_SERVER_PASSWORD,
  KILO_SERVER_USERNAME: Flag.KILO_SERVER_USERNAME,
  envPassword: process.env.KILO_SERVER_PASSWORD,
  envUsername: process.env.KILO_SERVER_USERNAME,
}
const auth = { username: "opencode", password: "listen-secret" }

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = original.KILO_SERVER_PASSWORD
  Flag.KILO_SERVER_USERNAME = original.KILO_SERVER_USERNAME
  if (original.envPassword === undefined) delete process.env.KILO_SERVER_PASSWORD
  else process.env.KILO_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.KILO_SERVER_USERNAME
  else process.env.KILO_SERVER_USERNAME = original.envUsername
  await disposeAllInstances()
  await resetDatabase()
})

async function startListener() {
  Flag.KILO_SERVER_PASSWORD = auth.password
  Flag.KILO_SERVER_USERNAME = auth.username
  process.env.KILO_SERVER_PASSWORD = auth.password
  process.env.KILO_SERVER_USERNAME = auth.username
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

async function startNoAuthListener() {
  Flag.KILO_SERVER_PASSWORD = undefined
  Flag.KILO_SERVER_USERNAME = auth.username
  delete process.env.KILO_SERVER_PASSWORD
  process.env.KILO_SERVER_USERNAME = auth.username
  return Server.listen({ hostname: "127.0.0.1", port: 0 })
}

function authorization() {
  return `Basic ${btoa(`${auth.username}:${auth.password}`)}`
}

function stop(listener: Awaited<ReturnType<typeof startListener>>, label: string) {
  return withTimeout(listener.stop(true), 10_000, label)
}

describe("Kilo HttpApi Server.listen", () => {
  test("keeps authentication isolated across in-process and concurrent listeners", async () => {
    const open = await startNoAuthListener()
    try {
      const local = await Server.Default().app.request("/doc")
      expect(local.status).toBe(200)

      const secured = await startListener()
      try {
        const publicResponse = await fetch(new URL("/doc", open.url))
        expect(publicResponse.status).toBe(200)

        const unauthorized = await fetch(new URL("/doc", secured.url))
        expect(unauthorized.status).toBe(401)

        const authorized = await fetch(new URL("/doc", secured.url), {
          headers: { authorization: authorization() },
        })
        expect(authorized.status).toBe(200)
      } finally {
        await stop(secured, "timed out cleaning up authenticated listener")
      }
    } finally {
      await stop(open, "timed out cleaning up unauthenticated listener")
    }
  })
})
