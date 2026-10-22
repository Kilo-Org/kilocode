import { afterEach, expect, test } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2"
import { Server } from "../../src/server/server"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("blocking TUI bootstrap requests complete", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const client = createKiloClient({
    baseUrl: "http://kilo.internal",
    directory: tmp.path,
    fetch: ((request: RequestInfo | URL, init?: RequestInit) =>
      Server.Default().app.fetch(new Request(request, init))) as typeof fetch,
  })

  const responses = await Promise.all([
    client.config.providers({}, { throwOnError: true }),
    client.provider.list({}, { throwOnError: true }),
    client.experimental.capabilities.get({}, { throwOnError: true }),
    client.app.agents({}, { throwOnError: true }),
    client.config.get({}, { throwOnError: true }),
    client.global.config.get({ throwOnError: true }),
  ])

  for (const response of responses) expect(response.data).toBeDefined()
})
