import { describe, expect, test } from "bun:test"
import { openUrl } from "../../src/open"

describe("openUrl", () => {
  test.each(["not a url", "", "/tmp/authorize", "C:\\Windows\\System32\\calc.exe", "\\\\server\\share\\file.html"])(
    "rejects non-browser targets: %j",
    (input) => expect(openUrl(input)).rejects.toThrow("Only http and https links"),
  )

  test.each(["file:///tmp/authorize", "javascript:alert(1)", "data:text/html,test", "ms-msdt:/id PCWDiagnostic"])(
    "rejects non-http schemes: %j",
    (input) => expect(openUrl(input)).rejects.toThrow("Only http and https links"),
  )
})
