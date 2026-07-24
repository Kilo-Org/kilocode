// kilocode_change - new file
// K1 W1: verify `buildInstanceAdvertisement`'s payload shape as real behavior.
//
// The `RemoteCommand` handler itself is a CLI entry point that calls
// `bootstrap(process.cwd(), async () => { ... })` and then awaits an abort
// signal that never resolves in a test — it cannot be driven end-to-end.
// `buildInstanceAdvertisement` is extracted from the handler specifically so
// the advertised payload is independently testable as real behavior, not via
// a source-text/regex assertion on the handler's structure.

import { describe, expect, test } from "bun:test"
import { buildInstanceAdvertisement } from "../../../../src/cli/cmd/remote"

describe("RemoteCommand instance advertisement (K1 W1)", () => {
  test("buildInstanceAdvertisement resolves name/projectName/version from the directory and installation version", () => {
    const advertisement = buildInstanceAdvertisement("/Users/igor/projects/my-app")
    expect(advertisement.projectName).toBe("my-app")
    expect(typeof advertisement.name).toBe("string")
    expect(advertisement.name.length).toBeGreaterThan(0)
    expect(typeof advertisement.version).toBe("string")
  })

  test("buildInstanceAdvertisement truncates an overlong project directory name to 64 chars", () => {
    const longName = "a".repeat(100)
    const advertisement = buildInstanceAdvertisement(`/Users/igor/projects/${longName}`)
    expect(advertisement.projectName.length).toBeLessThanOrEqual(64)
  })

  test("buildInstanceAdvertisement falls back to the full directory when basename is empty (root path)", () => {
    const advertisement = buildInstanceAdvertisement("/")
    expect(advertisement.projectName).toBe("/")
  })
})
