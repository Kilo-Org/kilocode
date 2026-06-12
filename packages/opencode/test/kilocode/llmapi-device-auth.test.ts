// kilocode_change - new file
import { expect, test } from "bun:test"
import { authenticateWithLlmapiDeviceAuth } from "../../src/plugin/llmapi-device-auth"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

test("returns success with the minted key after approval", async () => {
  let polls = 0
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url)
    if (u.endsWith("/auth/device/code")) {
      return jsonResponse(200, {
        device_code: "dc-1",
        user_code: "WDJB-MJHT",
        verification_uri: "https://app.test/device",
        verification_uri_complete: "https://app.test/device?user_code=WDJB-MJHT",
        expires_in: 900,
        interval: 0,
      })
    }
    // token endpoint: pending twice, then approved
    polls += 1
    if (polls < 3) return jsonResponse(400, { error: "authorization_pending" })
    return jsonResponse(200, { api_key: "llmapi_minted", project_id: "p1", name: "Kilo Code" })
  }) as unknown as typeof fetch

  let opened = ""
  const result = await authenticateWithLlmapiDeviceAuth({
    apiBaseURL: "https://api.test",
    fetchImpl,
    openBrowser: (url) => {
      opened = url
    },
    pollIntervalMs: 1,
  })

  expect(opened).toBe("https://app.test/device?user_code=WDJB-MJHT")
  expect(result.method).toBe("auto")
  if (result.method !== "auto") throw new Error("expected auto method")
  const final = await result.callback()
  expect(final).toEqual({ type: "success", key: "llmapi_minted" })
})

test("returns failed when the device is denied", async () => {
  const fetchImpl = (async (url: string | URL) => {
    const u = String(url)
    if (u.endsWith("/auth/device/code")) {
      return jsonResponse(200, {
        device_code: "dc-1",
        user_code: "AAAA-BBBB",
        verification_uri: "https://app.test/device",
        verification_uri_complete: "https://app.test/device?user_code=AAAA-BBBB",
        expires_in: 900,
        interval: 0,
      })
    }
    return jsonResponse(400, { error: "access_denied" })
  }) as unknown as typeof fetch

  const result = await authenticateWithLlmapiDeviceAuth({
    apiBaseURL: "https://api.test",
    fetchImpl,
    openBrowser: () => {},
    pollIntervalMs: 1,
  })
  if (result.method !== "auto") throw new Error("expected auto method")
  const final = await result.callback()
  expect(final).toEqual({ type: "failed" })
})
