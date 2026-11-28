import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { command } from "../../src/auth/browser.js"
import { authenticateWithDeviceAuthTUI } from "../../src/auth/device-auth-tui.js"

afterEach(() => mock.restore())

test("Windows launches the URL handler without a command shell", () => {
  expect(command("https://app.kilo.ai/device?code=A&next=calc", "win32")).toEqual({
    file: "rundll32",
    args: ["url.dll,FileProtocolHandler", "https://app.kilo.ai/device?code=A&next=calc"],
  })
})

test("macOS and Linux pass the URL as a single argument", () => {
  expect(command("http://127.0.0.1:3000/device", "darwin")).toEqual({
    file: "open",
    args: ["http://127.0.0.1:3000/device"],
  })
  expect(command("https://app.kilo.ai/device", "linux")).toEqual({
    file: "xdg-open",
    args: ["https://app.kilo.ai/device"],
  })
})

test("rejects values that are not http or https URLs", () => {
  for (const input of ["not a url", "", "file:///etc/hosts", "javascript:alert(1)", "ms-msdt:/id PCWDiagnostic"]) {
    expect(() => command(input, "win32")).toThrow("Only http and https links")
  }
})

test("device login rejects a non-http verification URL before launching", async () => {
  const data = { code: "ABCD", verificationUrl: "file:///etc/hosts", expiresIn: 600 }
  spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data))

  const err = await authenticateWithDeviceAuthTUI().catch((err: unknown) => err)
  expect(err).toMatchObject({ message: expect.stringContaining("Only http and https links") })
})
