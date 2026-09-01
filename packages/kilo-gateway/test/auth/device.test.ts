import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { KILO_API_BASE } from "../../src/api/constants.js"
import { initiateDeviceAuth, pollDeviceAuth } from "../../src/auth/device.js"

afterEach(() => {
  mock.restore()
})

describe("initiateDeviceAuth", () => {
  test("posts without a body and passes through JSON", async () => {
    const data = { code: "ABCD", verificationUrl: "https://example.com/device", expiresIn: 600, extra: true }
    const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data))

    await expect(initiateDeviceAuth()).resolves.toEqual(data)
    expect(request.mock.calls).toStrictEqual([
      [`${KILO_API_BASE}/api/device-auth/codes`, { method: "POST", headers: { "Content-Type": "application/json" } }],
    ])
  })

  test.each([
    [429, "Too many pending authorization requests. Please try again later."],
    [500, "Failed to initiate device authorization: 500"],
  ])("rejects HTTP %i", async (status, message) => {
    spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status }))

    await expect(initiateDeviceAuth()).rejects.toThrow(message)
  })
})

describe("pollDeviceAuth", () => {
  test("uses a bare GET with the code unchanged and passes through JSON", async () => {
    const code = "code/with space"
    const data = { status: "approved", token: "token", userEmail: "user@example.com", extra: true }
    const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data))

    await expect(pollDeviceAuth(code)).resolves.toEqual(data)
    expect(request.mock.calls).toStrictEqual([[`${KILO_API_BASE}/api/device-auth/codes/${code}`]])
  })

  test.each([
    [202, "pending"],
    [403, "denied"],
    [410, "expired"],
  ])("maps HTTP %i to %s without parsing JSON", async (status, state) => {
    const response = new Response("not json", { status })
    const json = spyOn(response, "json")
    spyOn(globalThis, "fetch").mockResolvedValue(response)

    await expect(pollDeviceAuth("code")).resolves.toEqual({ status: state })
    expect(json).not.toHaveBeenCalled()
  })

  test("rejects other unsuccessful responses", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 500 }))

    await expect(pollDeviceAuth("code")).rejects.toThrow("Failed to poll device authorization: 500")
  })
})

describe.each([
  ["initiateDeviceAuth", initiateDeviceAuth],
  ["pollDeviceAuth", () => pollDeviceAuth("code")],
] as const)("%s failures", (_name, run) => {
  test("propagates network failures", async () => {
    const error = new TypeError("Network unavailable")
    spyOn(globalThis, "fetch").mockRejectedValue(error)

    await expect(run()).rejects.toBe(error)
  })

  test("propagates invalid JSON failures", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json"))

    await expect(run()).rejects.toBeInstanceOf(SyntaxError)
  })
})
