import { describe, expect, it } from "bun:test"
import { mergeStatus, type SandboxStatus } from "../webview-ui/src/v2/sandbox-status"

const status = (version: number, enabled = true): SandboxStatus => ({
  directory: "/repo",
  enabled,
  available: true,
  network: true,
  version,
})

describe("mergeStatus", () => {
  it("keeps a newer snapshot when an older response arrives late", () => {
    const current = { ses_1: status(3) }
    expect(mergeStatus(current, "ses_1", status(2, false))).toBe(current)
  })

  it("accepts an equal or newer version, because the last answer for one version is authoritative", () => {
    const current = { ses_1: status(3) }
    expect(mergeStatus(current, "ses_1", status(3, false)).ses_1.enabled).toBe(false)
    expect(mergeStatus(current, "ses_1", status(4, false)).ses_1.version).toBe(4)
  })

  it("keeps other sessions", () => {
    const current = { ses_1: status(1), ses_2: status(2) }
    const next = mergeStatus(current, "ses_1", status(2))
    expect(Object.keys(next).toSorted()).toEqual(["ses_1", "ses_2"])
    expect(next.ses_2).toBe(current.ses_2)
  })
})
