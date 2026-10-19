import { describe, expect, test } from "bun:test"
import { KiloHeaders } from "../src/index.js"

describe("KiloHeaders.provider", () => {
  test("passes KILOCODE_FEATURE through and falls back to cli when it is unset or empty", () => {
    expect(KiloHeaders.provider({ version: "1" }, { KILOCODE_FEATURE: "cloud-agent" })[KiloHeaders.HEADER_FEATURE]).toBe(
      "cloud-agent",
    )
    expect(KiloHeaders.provider({ version: "1" }, {})[KiloHeaders.HEADER_FEATURE]).toBe("cli")
    expect(KiloHeaders.provider({ version: "1" }, { KILOCODE_FEATURE: "" })[KiloHeaders.HEADER_FEATURE]).toBe("cli")
  })

  test("names the editor from KILOCODE_EDITOR_NAME, else Kilo CLI with the version", () => {
    expect(KiloHeaders.provider({ version: "1.2.3" }, {})[KiloHeaders.HEADER_EDITOR]).toBe("Kilo CLI 1.2.3")
    expect(
      KiloHeaders.provider({ version: "1.2.3" }, { KILOCODE_EDITOR_NAME: "JetBrains", KILOCODE_VERSION: "9" })[
        KiloHeaders.HEADER_EDITOR
      ],
    ).toBe("JetBrains")
  })

  test("suppresses tester warnings only for KILO_TESTER=SUPPRESS or a future disable time", () => {
    const tester = (env: Record<string, string>) => KiloHeaders.provider({ version: "1" }, env)[KiloHeaders.HEADER_TESTER]
    expect(tester({ KILO_TESTER: "SUPPRESS" })).toBe("SUPPRESS")
    expect(tester({ KILO_TESTER_WARNINGS_DISABLED_UNTIL: String(Date.now() + 60_000) })).toBe("SUPPRESS")
    expect(tester({ KILO_TESTER_WARNINGS_DISABLED_UNTIL: String(Date.now() - 60_000) })).toBeUndefined()
    expect(tester({ KILO_TESTER: "other" })).toBeUndefined()
  })
})

describe("KiloHeaders.request", () => {
  test("adds only the request headers that have a value and lower-cases the mode", () => {
    expect(KiloHeaders.request({ version: "2.0.0", sessionID: "ses_1", mode: "Code" }, {})).toEqual({
      ...KiloHeaders.provider({ version: "2.0.0" }, {}),
      "User-Agent": "opencode-kilo-provider/2.0.0",
      "X-KILOCODE-TASKID": "ses_1",
      "x-kilocode-mode": "code",
    })
  })

  test("uses KILOCODE_VERSION for the User-Agent and the editor name", () => {
    const headers = KiloHeaders.request({ version: "local" }, { KILOCODE_VERSION: "7.1.0" })
    expect(headers["User-Agent"]).toBe("opencode-kilo-provider/7.1.0")
    expect(headers[KiloHeaders.HEADER_EDITOR]).toBe("Kilo CLI 7.1.0")
  })
})
