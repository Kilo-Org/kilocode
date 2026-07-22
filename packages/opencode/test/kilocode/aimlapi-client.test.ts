// kilocode_change - new file
import { afterEach, expect, test } from "bun:test"
import { AimlapiClient } from "../../src/kilocode/aimlapi/client"
import { DEFAULT_PARTNER_ID, type AimlapiEndpoints } from "../../src/kilocode/aimlapi/config"

const endpoints: AimlapiEndpoints = {
  authBaseUrl: "https://auth.test",
  appBaseUrl: "https://app.test",
  payBaseUrl: "https://pay.test",
  inferenceBaseUrl: "https://api.test/v1",
  verificationBaseUrl: "https://front.test/app",
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function captureHeaders(): { headers: () => Headers } {
  let captured: Headers | undefined
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured = new Headers(init?.headers)
    return Response.json({ action: "sign-in" })
  }) as typeof fetch
  return { headers: () => captured ?? new Headers() }
}

test("onboarding client sends the attribution headers on every request", async () => {
  const cap = captureHeaders()

  await new AimlapiClient(endpoints).checkAccount("user@example.com")

  const headers = cap.headers()
  expect(headers.get("x-aimlapi-source")).toBe("agent")
  // Fixed compiled-in partner id, provisioned on both backends.
  expect(DEFAULT_PARTNER_ID).not.toBe("")
  expect(headers.get("x-aimlapi-partner-id")).toBe(DEFAULT_PARTNER_ID)
})
