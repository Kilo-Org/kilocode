import { endpointEnv } from "../../../script/dev-local"
import { expect, test } from "bun:test"

test("dev:local points every cloud endpoint at the discovered local stack", () => {
  const env = endpointEnv({ web: 6500, cloudAgent: 12294, ingest: 12300, events: 12301 })

  expect(env.KILO_API_URL).toBe("http://localhost:6500")
  expect(env.KILO_WEB_APP_URL).toBe("http://localhost:6500")
  expect(env.CLOUD_AGENT_NEXT_BASE_URL).toBe("http://localhost:12294")
  expect(env.KILO_SESSION_INGEST_URL).toBe("http://localhost:12300")
  expect(env.EVENT_SERVICE_URL).toBe("ws://localhost:12301")
})

test("dev:local never falls back to a production origin", () => {
  const env = endpointEnv({ web: 6500, cloudAgent: 12294 })

  expect(env.CLOUD_AGENT_NEXT_BASE_URL).not.toBe("https://cloud-agent-next.kilosessions.ai")
  expect(env.KILO_WEB_APP_URL).not.toBe("https://kilo.ai")
  for (const value of Object.values(env)) {
    expect(value).not.toContain("kilosessions.ai")
    expect(value).not.toContain("kilo.ai")
  }
})

test("dev:local disables optional services when the manifest omits them", () => {
  const env = endpointEnv({ web: 6500, cloudAgent: 12294 })

  expect(env.KILO_DISABLE_SESSION_INGEST).toBe("1")
  expect(env.KILO_SESSION_INGEST_URL).toBeUndefined()
  expect(env.EVENT_SERVICE_URL).toBeUndefined()
  expect(env.KILO_DISABLE_PRESENCE).toBeUndefined()
})
