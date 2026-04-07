import { describe, test, expect } from "bun:test"

describe("B2: checkDiskSpace measures actual disk space", () => {
  test("checkDiskSpace returns a result with GB in the message", async () => {
    const { checkDiskSpace } = await import("@/devilcode/workflow/preflight")

    const result = await checkDiskSpace()
    expect(result.name).toBe("disk_space")
    expect(result.message).toContain("GB")
    expect(result.passed).toBe(true)
  })
})
