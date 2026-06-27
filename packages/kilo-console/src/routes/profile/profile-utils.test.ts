import { expect, test } from "bun:test"
import { authError, credits, initials, money, page, parseDeviceCode, safeReturn, usage } from "./profile-utils"

test("parses device auth codes from instructions", () => {
  expect(parseDeviceCode("Open https://app.kilo.ai/device-auth and enter code: ABCD-2345")).toBe("ABCD-2345")
  expect(parseDeviceCode("Use ABCD-2345 to continue")).toBe("ABCD-2345")
  expect(parseDeviceCode(undefined)).toBeUndefined()
})

test("detects Kilo auth failures", () => {
  expect(authError(new Error("Kilo profile: Unauthorized"))).toBe(true)
  expect(authError({ status: 401 })).toBe(true)
  expect(authError(new Error("Kilo profile: temporary network failure"))).toBe(false)
})

test("formats account display helpers", () => {
  expect(money(12.5)).toBe("$12.50")
  expect(money(null)).toBe("Unknown")
  expect(initials("Jane Developer", "jane@example.com")).toBe("JD")
  expect(initials("", "solo@example.com")).toBe("SE")
})

test("keeps login returns internal", () => {
  expect(safeReturn("/profile?server=http%3A%2F%2F127.0.0.1%3A4097")).toBe(
    "/profile?server=http%3A%2F%2F127.0.0.1%3A4097",
  )
  expect(safeReturn("https://app.kilo.ai/profile")).toBe("/profile")
  expect(safeReturn("//app.kilo.ai/profile")).toBe("/profile")
})

test("builds local links while preserving server", () => {
  const params = new URLSearchParams({ server: "http://127.0.0.1:4097", ignored: "1" })
  expect(page(params, "/kilo/login", { return: "/profile" })).toBe(
    "/kilo/login?server=http%3A%2F%2F127.0.0.1%3A4097&return=%2Fprofile",
  )
})

test("builds account-aware cloud links", () => {
  const id = "9d4b144c-0a2b-477b-973d-24fa02bebf13"
  expect(usage(null)).toBe("https://app.kilo.ai/usage")
  expect(usage(id)).toBe(`https://app.kilo.ai/organizations/${id}/usage-details`)
  expect(credits(undefined)).toBe("https://app.kilo.ai/profile")
  expect(credits(id)).toBe(`https://app.kilo.ai/organizations/${id}`)
})
