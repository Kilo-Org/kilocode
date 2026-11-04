import { describe, expect, test } from "bun:test"
import { openUrl } from "../../src/open"

describe("openUrl", () => {
  test("rejects values that are not URLs", async () => {
    for (const input of ["not a url", ""]) {
      const err = await openUrl(input).catch((err: unknown) => err)
      expect(err).toMatchObject({ message: expect.stringContaining("Only http and https links") })
    }
  })

  test("rejects non-http schemes", async () => {
    for (const input of [
      "file:///etc/hosts",
      "javascript:alert(1)",
      "ms-msdt:/id PCWDiagnostic",
      "\\\\server\\share\\file.html",
    ]) {
      const err = await openUrl(input).catch((err: unknown) => err)
      expect(err).toMatchObject({ message: expect.stringContaining("Only http and https links") })
    }
  })
})
