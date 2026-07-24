import { describe, expect, test } from "bun:test"
import {
  buildRemoteInstance,
  hostLabel,
  projectLabel,
  sanitizeLabel,
  versionLabel,
} from "../../../src/kilo-sessions/kilo-sessions"

describe("remote instance labels", () => {
  test("hostLabel uses hostname and falls back when empty", () => {
    expect(hostLabel("macbook.local")).toBe("macbook.local")
    expect(hostLabel("   ")).toBe("Kilo runtime")
    expect(hostLabel("")).toBe("Kilo runtime")
  })

  test("hostLabel strips controls, collapses whitespace, clamps to 64", () => {
    expect(hostLabel("ab\u0001c\td")).toBe("ab c d")
    expect(hostLabel("x".repeat(80))).toBe("x".repeat(64))
    expect(hostLabel("\u0001\u0002")).toBe("Kilo runtime")
  })

  test("projectLabel takes basename and falls back", () => {
    expect(projectLabel("/Users/igor/Projects/cloud")).toBe("cloud")
    expect(projectLabel("/Users/igor/Projects/cloud/")).toBe("cloud")
    expect(projectLabel("C:\\work\\app\\")).toBe("app")
    expect(projectLabel("/")).toBe("unknown-project")
    expect(projectLabel("")).toBe("unknown-project")
  })

  test("projectLabel sanitizes and clamps", () => {
    expect(projectLabel(`/tmp/${"p".repeat(80)}`)).toBe("p".repeat(64))
    expect(projectLabel("/tmp/my\nproj")).toBe("my proj")
  })

  test("versionLabel clamps to 32 and drops empty", () => {
    expect(versionLabel("7.4.15")).toBe("7.4.15")
    expect(versionLabel("v".repeat(40))).toBe("v".repeat(32))
    expect(versionLabel("   ")).toBeUndefined()
    expect(versionLabel("\u0000")).toBeUndefined()
  })

  test("sanitizeLabel applies fallback after empty sanitize", () => {
    expect(sanitizeLabel("ok", "fb", 64)).toBe("ok")
    expect(sanitizeLabel("\t\n", "fb", 64)).toBe("fb")
  })

  test("buildRemoteInstance validates a complete instance", () => {
    const instance = buildRemoteInstance({
      directory: "/tmp/my-app",
      hostname: "dev-box",
      version: "1.2.3",
    })
    expect(instance).toEqual({
      name: "dev-box",
      projectName: "my-app",
      version: "1.2.3",
    })
  })

  test("buildRemoteInstance applies hostname and project fallbacks", () => {
    const instance = buildRemoteInstance({
      directory: "/",
      hostname: "  ",
      version: "9.0.0",
    })
    expect(instance.name).toBe("Kilo runtime")
    expect(instance.projectName).toBe("unknown-project")
    expect(instance.version).toBe("9.0.0")
  })

  test("buildRemoteInstance omits empty version after clamp", () => {
    const instance = buildRemoteInstance({
      directory: "/tmp/p",
      hostname: "h",
      version: "   ",
    })
    expect(instance).toEqual({ name: "h", projectName: "p" })
    expect(instance).not.toHaveProperty("version")
  })
})
