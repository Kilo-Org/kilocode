import { describe, expect, test } from "bun:test"
import { KiloExtension } from "../../src/agent-plugins/extension"
import type { Mcp } from "../../src/agent-plugins/mcp"

const remote: Mcp.Server = {
  name: "slack",
  transport: "streamable-http",
  url: "https://mcp.slack.com/mcp",
  headers: {},
}
const local: Mcp.Server = { name: "db", transport: "stdio", command: "node", args: [], env: {}, cwd: "/plugin" }

const read = (value: unknown, servers: readonly Mcp.Server[] = [remote, local]) =>
  KiloExtension.read({ [KiloExtension.NAMESPACE]: value }, servers)
const messages = (result: KiloExtension.Result) =>
  result.diagnostics.map((item) => [item.severity, item.code, item.item, item.message])

describe("ai.kilo extension", () => {
  test("a plugin without the namespace has no settings and no problems", () => {
    expect(KiloExtension.read(undefined, [remote])).toEqual({ oauth: new Map(), diagnostics: [] })
    expect(KiloExtension.read({ "com.example": { anything: true } }, [remote])).toEqual({
      oauth: new Map(),
      diagnostics: [],
    })
  })

  test("accepts public-client OAuth settings for a remote server the plugin declares", () => {
    const result = read({
      mcp: {
        slack: {
          oauth: {
            client_id: "9876543210.1234567890123",
            callback_port: 3119,
            redirect_uri: "http://127.0.0.1:3119/callback",
            scope: "search:read.public chat:write",
          },
        },
      },
    })
    expect(result.diagnostics).toEqual([])
    expect(result.oauth).toEqual(
      new Map([
        [
          "slack",
          {
            client_id: "9876543210.1234567890123",
            callback_port: 3119,
            redirect_uri: "http://127.0.0.1:3119/callback",
            scope: "search:read.public chat:write",
          },
        ],
      ]),
    )
  })

  test.each(["http://localhost:7777/callback", "http://127.0.0.1:7777/cb", "http://127.0.0.1:7777/"])(
    "a loopback redirect %p is accepted",
    (redirect_uri) => {
      expect(read({ mcp: { slack: { oauth: { client_id: "x", redirect_uri } } } }).oauth.get("slack")).toEqual({
        client_id: "x",
        redirect_uri,
      })
    },
  )

  test.each([
    ["a remote redirect", { client_id: "x", redirect_uri: "https://evil.example/cb" }, "redirect_uri must be"],
    ["an https loopback redirect", { client_id: "x", redirect_uri: "https://127.0.0.1:1/cb" }, "redirect_uri must be"],
    ["a redirect with user info", { client_id: "x", redirect_uri: "http://me@127.0.0.1:1/cb" }, "redirect_uri must be"],
    // Core's callback listener binds 127.0.0.1 on the redirect's port; these would reach nothing.
    ["an IPv6 loopback redirect", { client_id: "x", redirect_uri: "http://[::1]:7777/cb" }, "redirect_uri must be"],
    ["another 127/8 address", { client_id: "x", redirect_uri: "http://127.0.0.2:7777/cb" }, "redirect_uri must be"],
    ["a redirect without a port", { client_id: "x", redirect_uri: "http://127.0.0.1/cb" }, "redirect_uri must be"],
    ["a client secret", { client_id: "x", client_secret: "s3cret" }, "client_secret is not accepted from plugins"],
    [
      "an authorization server metadata URL",
      { auth_server_metadata_url: "https://evil.example/.well-known/oauth-authorization-server" },
      "auth_server_metadata_url is not accepted from plugins",
    ],
    ["an empty client ID", { client_id: "" }, "client_id must be a non-empty string"],
    ["a port out of range", { callback_port: 70000 }, "callback_port must be an integer"],
    ["a fractional port", { callback_port: 3.5 }, "callback_port must be an integer"],
    [
      "a port that differs from the redirect",
      { callback_port: 3119, redirect_uri: "http://127.0.0.1:4000/cb" },
      "must match",
    ],
    ["a non-string scope", { scope: ["a"] }, "scope must be a string"],
    ["a non-object", "client", "it must be an object"],
  ])("%s ignores the whole OAuth entry", (_, oauth, reason) => {
    const result = read({ mcp: { slack: { oauth } } })
    expect(result.oauth).toEqual(new Map())
    expect(messages(result)).toEqual([["warning", "extension-invalid", "slack", expect.stringContaining(reason)]])
  })

  test("settings for a server the plugin does not declare are ignored", () => {
    const result = read({ mcp: { github: { oauth: { client_id: "x" } } } })
    expect(result.oauth).toEqual(new Map())
    expect(messages(result)).toEqual([
      ["warning", "extension-invalid", "github", expect.stringContaining("does not match a loaded server")],
    ])
  })

  test("settings for a stdio server are ignored", () => {
    const result = read({ mcp: { db: { oauth: { client_id: "x" } } } })
    expect(result.oauth).toEqual(new Map())
    expect(messages(result)).toEqual([
      ["warning", "extension-invalid", "db", expect.stringContaining("only apply to remote servers")],
    ])
  })

  test("unknown fields are reported and the known ones still apply", () => {
    const result = read({
      agents: {},
      mcp: { slack: { oauth: { client_id: "x", audience: "y" }, display: "Slack" } },
    })
    expect(result.oauth.get("slack")).toEqual({ client_id: "x" })
    expect(result.diagnostics.map((item) => item.message)).toEqual([
      "Ignored unknown field extensions.ai.kilo.agents",
      'Ignored unknown field extensions.ai.kilo.mcp."slack".display',
      'Ignored unknown field extensions.ai.kilo.mcp."slack".oauth.audience',
    ])
  })

  test.each([
    ["the namespace is not an object", ["mcp"]],
    ["mcp is not an object", { mcp: [] }],
  ])("%s: everything is ignored with a warning", (_, value) => {
    const result = read(value)
    expect(result.oauth).toEqual(new Map())
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.code).toBe("extension-invalid")
  })

  test("a server entry without oauth is fine", () => {
    expect(read({ mcp: { slack: {} } })).toEqual({ oauth: new Map(), diagnostics: [] })
  })
})
