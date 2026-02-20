import { describe, it, expect } from "bun:test"
import { generateQRCode } from "../../webview-ui/src/utils/qrcode"

describe("generateQRCode", () => {
  it("returns a data URL for a valid string", async () => {
    const result = await generateQRCode("https://example.com")
    expect(result).toMatch(/^data:image\/png;base64,/)
  })

  it("returns a non-empty base64 payload", async () => {
    const result = await generateQRCode("hello")
    const base64 = result.replace("data:image/png;base64,", "")
    expect(base64.length).toBeGreaterThan(0)
  })

  it("produces different outputs for different inputs", async () => {
    const a = await generateQRCode("https://example.com/a")
    const b = await generateQRCode("https://example.com/b")
    expect(a).not.toBe(b)
  })

  it("throws on empty string", async () => {
    expect(generateQRCode("")).rejects.toThrow()
  })
})
