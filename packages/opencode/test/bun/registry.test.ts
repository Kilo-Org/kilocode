import { describe, expect, test } from "bun:test"
import semver from "semver"

// kilocode_change — test the semver guard logic that prevents crashes on invalid version strings

describe("semver guard for isOutdated", () => {
  function isOutdated(cachedVersion: string, latestVersion: string | null): boolean {
    if (!latestVersion) return false

    if (!cachedVersion || (!semver.valid(cachedVersion) && !semver.validRange(cachedVersion))) {
      return false
    }
    if (!latestVersion || !semver.valid(latestVersion)) {
      return false
    }

    const isRange = /[\s^~*xX<>|=]/.test(cachedVersion)
    if (isRange) return !semver.satisfies(latestVersion, cachedVersion)

    return semver.lt(cachedVersion, latestVersion)
  }

  test("returns true when cached is older", () => {
    expect(isOutdated("1.0.0", "2.0.0")).toBe(true)
  })

  test("returns false when cached is newer", () => {
    expect(isOutdated("2.0.0", "1.0.0")).toBe(false)
  })

  test("returns false when equal", () => {
    expect(isOutdated("1.0.0", "1.0.0")).toBe(false)
  })

  test("returns false when latest is null", () => {
    expect(isOutdated("1.0.0", null)).toBe(false)
  })

  test("handles range in cached version", () => {
    expect(isOutdated("^1.0.0", "1.5.0")).toBe(false) // 1.5.0 satisfies ^1.0.0
    expect(isOutdated("^1.0.0", "2.0.0")).toBe(true) // 2.0.0 does not satisfy ^1.0.0
  })

  // kilocode_change — invalid semver guard tests
  test("returns false for workspace:* cached version", () => {
    expect(isOutdated("workspace:*", "1.0.0")).toBe(false)
  })

  test("returns false for invalid latest version", () => {
    expect(isOutdated("1.0.0", "not-a-version")).toBe(false)
  })

  test("returns false for empty cached version", () => {
    expect(isOutdated("", "1.0.0")).toBe(false)
  })

  test("returns false for 'latest' as cached version", () => {
    expect(isOutdated("latest", "1.0.0")).toBe(false)
  })

  test("does not throw on any invalid input", () => {
    expect(() => isOutdated("workspace:*", "1.0.0")).not.toThrow()
    expect(() => isOutdated("1.0.0", "workspace:*")).not.toThrow()
    expect(() => isOutdated("", "")).not.toThrow()
    expect(() => isOutdated("latest", "latest")).not.toThrow()
    expect(() => isOutdated("abc", "def")).not.toThrow()
  })

  test("handles prerelease versions correctly", () => {
    expect(isOutdated("0.0.0-test-123", "1.0.0")).toBe(true)
    expect(isOutdated("1.0.0-alpha", "1.0.0")).toBe(true)
  })

  test("real version comparison works", () => {
    expect(isOutdated("0.2.141", "0.2.148")).toBe(true)
    expect(isOutdated("0.2.148", "0.2.141")).toBe(false)
    expect(isOutdated("7.1.23", "7.2.0")).toBe(true)
  })
})
