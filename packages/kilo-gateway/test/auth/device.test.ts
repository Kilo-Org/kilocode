import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { KILO_API_BASE } from "../../src/api/constants.js"
import { initiateDeviceAuth, pollDeviceAuth } from "../../src/auth/device.js"

afterEach(() => mock.restore())

test("device initiation preserves the POST, JSON, and rate-limit error", async () => {
  const data = { code: "ABCD", verificationUrl: "https://example.com/device", expiresIn: 600, extra: true }
  const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data))

  await expect(initiateDeviceAuth()).resolves.toEqual(data)
  expect(request.mock.calls).toStrictEqual([
    [`${KILO_API_BASE}/api/device-auth/codes`, { method: "POST", headers: { "Content-Type": "application/json" } }],
  ])
  request.mockResolvedValue(new Response(null, { status: 429 }))
  await expect(initiateDeviceAuth()).rejects.toThrow("Too many pending authorization requests. Please try again later.")
})

test("device polling preserves the bare GET and JSON", async () => {
  const data = { status: "approved", token: "token", userEmail: "user@example.com", extra: true }
  const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data))

  await expect(pollDeviceAuth("code/with space")).resolves.toEqual(data)
  expect(request.mock.calls).toStrictEqual([[`${KILO_API_BASE}/api/device-auth/codes/code/with space`]])
})

test.each([
  [202, "pending"],
  [403, "denied"],
  [410, "expired"],
])("device polling maps HTTP %i to %s without parsing JSON", async (status, state) => {
  spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status }))

  await expect(pollDeviceAuth("code")).resolves.toEqual({ status: state })
})
