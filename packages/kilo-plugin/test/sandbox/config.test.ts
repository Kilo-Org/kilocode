import { describe, expect, test } from "bun:test"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Config } from "@opencode/schema/config"
import { AbsolutePath } from "@opencode/schema/schema"
import { SandboxConfig } from "../../src/sandbox/config"

const global = "/kilo/global"
const project = "/workspace/project"

function document(file: string | undefined, sandbox: SandboxConfig.Info) {
  return new Config.Document({
    type: "document",
    path: file ? AbsolutePath.make(file) : undefined,
    info: new KiloConfigPolicy.Info({ sandbox }),
  })
}

describe("sandbox configuration defaults", () => {
  test("is off with a deny network by default", () => {
    expect(SandboxConfig.resolve({})).toEqual({
      enabled: false,
      mode: "deny",
      allowedHosts: [],
      writablePaths: [],
    })
  })

  test("uses the configured enabled flag, network mode, hosts, and writable paths", () => {
    expect(
      SandboxConfig.resolve({
        sandbox: {
          enabled: true,
          network: "allow",
          allowed_hosts: ["api.github.com:443"],
          writable_paths: ["/tmp/output"],
        },
      }),
    ).toEqual({
      enabled: true,
      mode: "allow",
      allowedHosts: [],
      writablePaths: ["/tmp/output"],
    })

    expect(
      SandboxConfig.resolve({
        sandbox: { enabled: true, network: "deny", allowed_hosts: ["API.GITHUB.COM."] },
      }),
    ).toEqual({
      enabled: true,
      mode: "proxy",
      allowedHosts: ["api.github.com:443"],
      writablePaths: [],
    })
  })

  test("drops destinations that are not a host and port", () => {
    expect(
      SandboxConfig.resolve({
        sandbox: { network: "deny", allowed_hosts: ["bad host", "example.com/path", "https://example.com"] },
      }),
    ).toMatchObject({ mode: "deny", allowedHosts: [] })
  })
})

function scoped(input: { sandbox?: SandboxConfig.Info }, source: "global" | "local") {
  return SandboxConfig.scope(input, source)
}

describe("sandbox configuration scoping", () => {
  test("leaves a global document unchanged", () => {
    const config = {
      sandbox: {
        enabled: true,
        network: "deny" as const,
        allowed_hosts: ["api.github.com"],
        writable_paths: ["/tmp/global"],
      },
    }
    expect(scoped(config, "global")).toEqual(config)
  })

  test("a project document can only enable the sandbox and deny the network", () => {
    expect(
      scoped(
        {
          sandbox: {
            enabled: true,
            network: "deny" as const,
            allowed_hosts: ["evil.example"],
            writable_paths: ["/tmp/project"],
          },
        },
        "local",
      ),
    ).toEqual({ sandbox: { enabled: true, network: "deny", allowed_hosts: [] } })

    expect(scoped({ sandbox: { enabled: false, network: "allow" as const } }, "local")).toEqual({})
    expect(scoped({ sandbox: { writable_paths: ["/tmp/project"] } }, "local")).toEqual({})
    expect(scoped({ sandbox: { network: "deny" } }, "local")).toEqual({
      sandbox: { network: "deny", allowed_hosts: [] },
    })
  })

  test("leaves a document without a sandbox key unchanged", () => {
    const config: { shell?: string; sandbox?: SandboxConfig.Info } = { shell: "/bin/zsh" }
    expect(SandboxConfig.scope(config, "local")).toBe(config)
  })
})

describe("sandbox configuration entries", () => {
  test("a later global document replaces the arrays of an earlier one", () => {
    const entries = [
      document(`${global}/kilo.json`, { writable_paths: ["/tmp/one"], allowed_hosts: ["api.github.com"] }),
      document(`${global}/kilo2.json`, { writable_paths: ["/tmp/two"], allowed_hosts: ["github.com"] }),
    ]
    expect(SandboxConfig.fromEntries(entries, global)).toEqual({
      sandbox: {
        writable_paths: ["/tmp/two"],
        allowed_hosts: ["github.com"],
      },
    })
  })

  test("treats a document without a path and a directory entry as global", () => {
    const entries = [
      document(undefined, { enabled: true }),
      new Config.Directory({ type: "directory", path: AbsolutePath.make("/workspace") }),
    ]
    expect(SandboxConfig.fromEntries(entries, global)).toEqual({ sandbox: { enabled: true } })
  })

  test("ignores entries that are not Kilo policy documents or have no sandbox", () => {
    const entries = [
      new Config.Document({
        type: "document",
        path: AbsolutePath.make(`${global}/kilo.json`),
        info: new Config.Info({}),
      }),
      new Config.Document({
        type: "document",
        path: AbsolutePath.make(`${global}/other.json`),
        info: new KiloConfigPolicy.Info({}),
      }),
      new Config.Directory({ type: "directory", path: AbsolutePath.make("/workspace") }),
    ]
    expect(SandboxConfig.fromEntries(entries, global)).toEqual({})
  })

  test("prevents a project document from weakening the sandbox policy", () => {
    const entries = [
      document(`${global}/kilo.json`, {
        enabled: true,
        network: "deny",
        writable_paths: ["/tmp/global"],
        allowed_hosts: ["api.github.com"],
      }),
      document(`${project}/kilo.json`, {
        enabled: false,
        network: "allow",
        writable_paths: ["/tmp/project"],
        allowed_hosts: ["evil.example"],
      }),
    ]
    expect(SandboxConfig.fromEntries(entries, global)).toEqual({
      sandbox: {
        enabled: true,
        network: "deny",
        writable_paths: ["/tmp/global"],
        allowed_hosts: ["api.github.com"],
      },
    })
  })

  test("allows a project document to strengthen the sandbox policy", () => {
    const entries = [
      document(`${global}/kilo.json`, {
        enabled: false,
        network: "allow",
        writable_paths: ["/tmp/global"],
        allowed_hosts: ["api.github.com"],
      }),
      document(`${project}/kilo.json`, {
        enabled: true,
        network: "deny",
        writable_paths: ["/tmp/project"],
        allowed_hosts: ["evil.example"],
      }),
    ]
    expect(SandboxConfig.fromEntries(entries, global)).toMatchObject({
      sandbox: { enabled: true, network: "deny", writable_paths: ["/tmp/global"] },
    })
  })

  test("a project network deny clears the global allowed hosts", () => {
    const entries = [
      document(`${global}/kilo.json`, { network: "deny", allowed_hosts: ["api.github.com"] }),
      document(`${project}/kilo.json`, { network: "deny" }),
    ]
    const result = SandboxConfig.fromEntries(entries, global)
    expect(result).toEqual({ sandbox: { network: "deny", allowed_hosts: [] } })
    expect(SandboxConfig.resolve(result).mode).toBe("deny")
  })
})
