import { afterEach, describe, expect, test } from "bun:test"
import * as Log from "@opencode-ai/core/util/log"
import { KILO_CLOUD_AGENT_API_URL, KILO_CLOUD_AGENT_URL } from "@kilocode/kilo-gateway"
import { Server } from "../../../src/server/server"
import { KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })

type Credentials = {
  token: string
  expiresAt: string
  kiloFacadeUrl: string
  cloudAgentUrl: string
}

const auth = process.env.KILO_AUTH_CONTENT

afterEach(async () => {
  setAuth(auth)
  await disposeAllInstances()
  await resetDatabase()
})

function setAuth(value: string | undefined) {
  if (value === undefined) {
    delete process.env.KILO_AUTH_CONTENT
    return
  }
  process.env.KILO_AUTH_CONTENT = value
}

function request(dir: string) {
  return Server.Default().app.request(KiloGatewayPaths.cloudAgentCredentials, {
    headers: { "x-kilo-directory": dir },
  })
}

async function credentials(dir: string) {
  const response = await request(dir)
  expect(response.status).toBe(200)
  return (await response.json()) as Credentials
}

describe("Cloud Agent credential route", () => {
  test.serial("rejects requests without Kilo auth", async () => {
    await using tmp = await tmpdir()
    setAuth(undefined)

    const response = await request(tmp.path)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ _tag: "Unauthorized" })
  })

  test.serial("preserves OAuth expiry and returns the configured facade URL", async () => {
    await using tmp = await tmpdir()
    const expires = Date.UTC(2030, 0, 1)
    setAuth(JSON.stringify({ kilo: { type: "oauth", refresh: "refresh-token", access: "oauth-token", expires } }))

    const body = await credentials(tmp.path)

    expect(body).toEqual({
      token: "oauth-token",
      expiresAt: new Date(expires).toISOString(),
      kiloFacadeUrl: KILO_CLOUD_AGENT_URL,
      cloudAgentUrl: KILO_CLOUD_AGENT_API_URL,
    })
  })

  test.serial("gives API credentials a synthetic future expiry", async () => {
    await using tmp = await tmpdir()
    setAuth(JSON.stringify({ kilo: { type: "api", key: "api-token" } }))
    const before = Date.now()

    const body = await credentials(tmp.path)
    const expires = Date.parse(body.expiresAt)

    expect(body.token).toBe("api-token")
    expect(body.kiloFacadeUrl).toBe(KILO_CLOUD_AGENT_URL)
    expect(body.cloudAgentUrl).toBe(KILO_CLOUD_AGENT_API_URL)
    expect(body.cloudAgentUrl).toBe(process.env.KILO_CLOUD_AGENT_API_URL || "https://cloud-agent-next.kilosessions.ai")
    expect(body.cloudAgentUrl).not.toBe(body.kiloFacadeUrl)
    expect(expires).toBeGreaterThan(before + 364 * 24 * 60 * 60 * 1000)
    expect(expires).toBeLessThanOrEqual(Date.now() + 365 * 24 * 60 * 60 * 1000)
  })
})
