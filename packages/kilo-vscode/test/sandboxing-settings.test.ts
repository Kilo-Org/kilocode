import { afterEach, describe, expect, test } from "bun:test"
import {
  destination,
  sandboxConfig,
  sandboxControls,
  visible,
  withSandbox,
} from "../webview-ui/src/components/settings/sandboxing"

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window")

function setControls(value: boolean) {
  Object.defineProperty(globalThis, "window", {
    value: { KILO_SANDBOX_CONTROLS: value },
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor)
  else delete (globalThis as { window?: unknown }).window
})

describe("Sandboxing settings visibility", () => {
  test("follows the host platform marker", () => {
    setControls(true)
    expect(sandboxControls()).toBe(true)
    expect(visible()).toBe(true)

    setControls(false)
    expect(sandboxControls()).toBe(false)
    expect(visible()).toBe(false)
    expect(visible(true)).toBe(true)
  })
})

describe("sandbox config", () => {
  test("keeps only the known fields with their valid types", () => {
    expect(
      sandboxConfig({
        enabled: true,
        network: "deny",
        writable_paths: ["/tmp", 3],
        allowed_hosts: ["api.github.com:443"],
        extra: 1,
      }),
    ).toEqual({
      enabled: true,
      network: "deny",
      writable_paths: ["/tmp"],
      allowed_hosts: ["api.github.com:443"],
    })
    expect(sandboxConfig(undefined)).toEqual({})
    expect(sandboxConfig([])).toEqual({})
    expect(sandboxConfig({ enabled: "yes", network: "block" })).toEqual({})
  })

  test("merges a patch without dropping other keys", () => {
    const current = { enabled: true, network: "deny" as const, writable_paths: ["/tmp"] }
    expect(withSandbox(current, { network: "allow" })).toEqual({
      enabled: true,
      network: "allow",
      writable_paths: ["/tmp"],
    })
  })
})

describe("allowed destination", () => {
  test("normalizes a host and adds the default HTTPS port", () => {
    expect(destination("api.github.com")).toBe("api.github.com:443")
    expect(destination("example.com:8443")).toBe("example.com:8443")
  })

  test("rejects invalid hosts and ports", () => {
    expect(destination("")).toBeUndefined()
    expect(destination("https://api.github.com")).toBeUndefined()
    expect(destination("10.0.0.1:443")).toBeUndefined()
    expect(destination("-bad.example.com")).toBeUndefined()
    expect(destination("example.com:0")).toBeUndefined()
    expect(destination("example.com:70000")).toBeUndefined()
  })
})
