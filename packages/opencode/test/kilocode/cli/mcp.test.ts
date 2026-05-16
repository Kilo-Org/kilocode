import { describe, expect, test } from "bun:test"
import { configFromAdd, configFromJson } from "../../../src/kilocode/cli/cmd/mcp"

describe("mcp cli config helpers", () => {
  test("builds local config from add args after dash", () => {
    const cfg = configFromAdd({
      name: "demo",
      type: "local",
      "--": ["npx", "my-mcp-server"],
      env: ["API_KEY=secret"],
    })

    expect(cfg).toEqual({
      type: "local",
      command: ["npx", "my-mcp-server"],
      environment: {
        API_KEY: "secret",
      },
    })
  })

  test("coerces numeric args after dash to strings", () => {
    const cfg = configFromAdd({
      name: "demo",
      type: "local",
      // yargs parses `-- npx server --port 3000` with 3000 as a number
      "--": ["npx", "server", "--port", 3000 as unknown as string],
    })

    expect(cfg).toEqual({
      type: "local",
      command: ["npx", "server", "--port", "3000"],
    })
  })

  test("builds remote config from add args", () => {
    const cfg = configFromAdd({
      name: "sentry",
      commandOrUrl: "https://mcp.sentry.dev/mcp",
      type: "remote",
      header: ["Authorization: Bearer token"],
      clientId: "client-id",
      callbackPort: 19876,
    })

    expect(cfg).toEqual({
      type: "remote",
      url: "https://mcp.sentry.dev/mcp",
      headers: {
        Authorization: "Bearer token",
      },
      oauth: {
        clientId: "client-id",
        redirectUri: "http://127.0.0.1:19876/mcp/oauth/callback",
      },
    })
  })

  test("accepts Kilo local JSON", () => {
    const cfg = configFromJson({
      type: "local",
      command: ["node", "server.js"],
      environment: {
        API_KEY: "secret",
      },
      enabled: false,
    })

    expect(cfg).toEqual({
      type: "local",
      command: ["node", "server.js"],
      environment: {
        API_KEY: "secret",
      },
      enabled: false,
    })
  })

  test("accepts Kilo remote JSON", () => {
    const cfg = configFromJson(
      {
        type: "remote",
        url: "https://example.com/mcp",
        headers: {
          "X-Api-Key": "secret",
        },
      },
      "oauth-secret",
    )

    expect(cfg).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: {
        "X-Api-Key": "secret",
      },
      oauth: {
        clientSecret: "oauth-secret",
      },
    })
  })

  test("rejects non-Kilo MCP types", () => {
    expect(() =>
      configFromJson({
        type: "stdio",
        command: "node",
        args: ["server.js"],
      }),
    ).toThrow('MCP JSON type must be "local" or "remote"')

    expect(() =>
      configFromAdd({
        name: "bad",
        commandOrUrl: "https://example.com/mcp",
        type: "http",
      }),
    ).toThrow("Invalid MCP server type")
  })

  test("rejects non-Kilo JSON fields", () => {
    expect(() =>
      configFromJson({
        type: "local",
        command: ["node", "server.js"],
        env: {
          API_KEY: "secret",
        },
      }),
    ).toThrow("Unsupported MCP JSON field: env")

    expect(() =>
      configFromJson({
        type: "remote",
        url: "https://example.com/mcp",
        args: ["unused"],
      }),
    ).toThrow("Unsupported MCP JSON field: args")
  })

  test("rejects options unsupported by server type", () => {
    expect(() =>
      configFromAdd({
        name: "bad-local",
        commandOrUrl: "node",
        type: "local",
        header: ["Authorization: Bearer token"],
      }),
    ).toThrow("Headers are only supported for remote MCP servers")

    expect(() =>
      configFromAdd({
        name: "bad-remote",
        commandOrUrl: "https://example.com/mcp",
        type: "remote",
        args: ["extra"],
      }),
    ).toThrow("Remote MCP servers require exactly one URL")
  })

  test("rejects malformed header args", () => {
    expect(() =>
      configFromAdd({
        name: "bad",
        commandOrUrl: "https://example.com/mcp",
        type: "remote",
        header: ["not-a-header"],
      }),
    ).toThrow("Invalid header")

    expect(() =>
      configFromAdd({
        name: "bad",
        commandOrUrl: "https://example.com/mcp",
        type: "remote",
        header: ["Key=value"],
      }),
    ).toThrow("Invalid header")
  })

  test("rejects non-http(s) URLs", () => {
    expect(() =>
      configFromAdd({
        name: "bad",
        commandOrUrl: "file:///etc/passwd",
        type: "remote",
      }),
    ).toThrow("Invalid MCP server URL")

    expect(() =>
      configFromAdd({
        name: "bad",
        commandOrUrl: "javascript:alert(1)",
        type: "remote",
      }),
    ).toThrow("Invalid MCP server URL")

    expect(() =>
      configFromJson({
        type: "remote",
        url: "data:text/plain,hello",
      }),
    ).toThrow("Invalid MCP server URL")
  })
})
