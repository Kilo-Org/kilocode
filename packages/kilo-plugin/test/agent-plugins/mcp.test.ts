import { describe, expect, test } from "bun:test"
import { access, writeFile } from "node:fs/promises"
import path from "node:path"
import { Mcp } from "../../src/agent-plugins/mcp"
import { AgentPlugin } from "../../src/agent-plugins/plugin"
import { MCP_SCHEMA, PLUGIN_SCHEMA, codes, load, mcp, skill, temp } from "./fixture"

const stdio = (loaded: AgentPlugin.Loaded, name: string) => {
  const found = loaded.servers.find((server) => server.name === name)
  if (found?.transport !== "stdio") throw new Error(`no stdio server ${name}`)
  return found
}

// Spec §7.2.1 and §7.2.2: the closed mcp.json document and its failure boundaries.
describe("mcp.json", () => {
  test("a missing mcp.json is not an error", async () => {
    const { loaded } = await load()
    expect(loaded.servers).toEqual([])
    expect(loaded.diagnostics).toEqual([])
  })

  test("an empty mcpServers object is valid", async () => {
    const { loaded } = await load({ "mcp.json": mcp({}) })
    expect(loaded.diagnostics).toEqual([])
  })

  test.each([
    ["invalid JSON", "{ nope", "mcp-invalid"],
    ["an array", [], "mcp-invalid"],
    ["an unknown top-level field", { ...mcp({}), extra: true }, "mcp-invalid"],
    ["a missing $schema", { mcpServers: {} }, "mcp-invalid"],
    ["a missing mcpServers", { $schema: MCP_SCHEMA }, "mcp-invalid"],
    ["mcpServers as an array", { $schema: MCP_SCHEMA, mcpServers: [] }, "mcp-invalid"],
    [
      "an unsupported version",
      mcp({}, "https://agent-plugins.org/schemas/9.0.0/mcp.schema.json"),
      "mcp-unsupported-version",
    ],
    ["the plugin schema instead of the MCP one", mcp({}, PLUGIN_SCHEMA), "mcp-unsupported-version"],
  ])("%s disables MCP while skills still load", async (_, document, code) => {
    const { loaded } = await load({ "mcp.json": document as object, "skills/a/SKILL.md": skill("a") })
    expect(loaded.status).toBe("loaded")
    expect(codes(loaded) as string[]).toEqual([code])
    expect(loaded.servers).toEqual([])
    expect(loaded.skills).toHaveLength(1)
  })

  test("a version different from plugin.json disables MCP", async () => {
    const result = await Mcp.decode(mcp({}), {
      root: "/plugin",
      spec: "2.0.0" as "1.0.0",
      platform: "linux",
      transports: ["stdio"],
      data: { path: "/data", create: async () => "/data" },
    })
    expect(result.diagnostics.map((item) => item.code)).toEqual(["mcp-version-mismatch"])
  })

  test("mcp.json that is a directory or links outside the root disables MCP", async () => {
    const dir = await load({ "mcp.json/x": "x" })
    expect(codes(dir.loaded)).toEqual(["mcp-invalid"])
    const outside = await temp()
    await writeFile(path.join(outside, "mcp.json"), JSON.stringify(mcp({})))
    const linked = await load({ "mcp.json": { symlink: path.join(outside, "mcp.json") } })
    expect(codes(linked.loaded)).toEqual(["mcp-invalid"])
  })

  test("an invalid entry is skipped and the other servers load", async () => {
    const { loaded } = await load({
      "mcp.json": mcp({
        good: { type: "stdio", command: "node" },
        unknownType: { type: "websocket", url: "wss://example.com" },
        noType: { command: "node" },
        crossVariant: { type: "stdio", command: "node", url: "https://example.com" },
        extra: { type: "streamable-http", url: "https://example.com", oauth: {} },
        notObject: "node server.js",
      }),
    })
    expect(loaded.servers.map((server) => server.name)).toEqual(["good"])
    expect(loaded.diagnostics.map((item) => [item.code, item.item])).toEqual([
      ["server-invalid", "unknownType"],
      ["server-invalid", "noType"],
      ["server-invalid", "crossVariant"],
      ["server-invalid", "extra"],
      ["server-invalid", "notObject"],
    ])
  })

  test("a valid entry with an unsupported transport is skipped with a warning", async () => {
    const { loaded } = await load({
      "mcp.json": mcp({
        legacy: { type: "sse", url: "https://legacy.example.com/sse" },
        current: { type: "streamable-http", url: "https://example.com/mcp" },
      }),
    })
    expect(loaded.servers.map((server) => server.name)).toEqual(["current"])
    expect(loaded.diagnostics).toMatchObject([
      { severity: "warning", code: "server-unsupported-transport", item: "legacy" },
    ])
  })

  test("a client that supports sse gets the entry", async () => {
    const { loaded } = await load(
      { "mcp.json": mcp({ legacy: { type: "sse", url: "https://legacy.example.com/sse" } }) },
      { transports: ["sse"] },
    )
    expect(loaded.servers).toEqual([
      { name: "legacy", transport: "sse", url: "https://legacy.example.com/sse", headers: {} },
    ])
  })
})

// Spec §7.2.1 (stdio) and §9: commands, working directories and the plugin environment.
describe("stdio servers", () => {
  test("a bare command passes through, args and env expand, the root is the default cwd", async () => {
    const { loaded, root } = await load({
      "mcp.json": mcp({
        db: {
          type: "stdio",
          command: "npx",
          args: ["--config", "${PLUGIN_ROOT}/config/db.json", "${PLUGIN_DATA}", "${HOME}", "$PLUGIN_ROOT"],
          env: { DATA_DIR: "${PLUGIN_DATA}/database", BOTH: "${PLUGIN_ROOT}:${PLUGIN_DATA}", RAW: "${OTHER}" },
        },
      }),
    })
    const data = loaded.data!
    expect(loaded.diagnostics).toEqual([])
    expect(stdio(loaded, "db")).toEqual({
      name: "db",
      transport: "stdio",
      command: "npx",
      args: ["--config", `${root}/config/db.json`, data, "${HOME}", "$PLUGIN_ROOT"],
      env: {
        DATA_DIR: `${data}/database`,
        BOTH: `${root}:${data}`,
        RAW: "${OTHER}",
        PLUGIN_ROOT: root,
        PLUGIN_DATA: data,
      },
      cwd: root,
    })
  })

  test("the data directory is created, writable and dedicated to the plugin instance", async () => {
    const { loaded, data } = await load({ "mcp.json": mcp({ s: { type: "stdio", command: "node" } }) })
    expect(loaded.data?.startsWith(data)).toBe(true)
    expect(path.basename(loaded.data!)).toMatch(/^demo-[0-9a-f]{12}$/)
    await writeFile(path.join(loaded.data!, "state"), "ok")
    const other = await load({ "mcp.json": mcp({ s: { type: "stdio", command: "node" } }) })
    expect(path.basename(other.loaded.data!)).not.toBe(path.basename(loaded.data!))
  })

  test("the data directory is not created for a plugin without stdio servers", async () => {
    const { loaded } = await load({ "skills/a/SKILL.md": skill("a") })
    expect(
      await access(loaded.data!).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

  test.each([
    ["a command that escapes the root", { command: "./../outside" }],
    ["a cwd that escapes the data directory", { command: "node", cwd: "${PLUGIN_DATA}/../.." }],
    ["a cwd in another form", { command: "node", cwd: "/tmp" }],
  ])("a stdio server rejected for %s does not create the data directory", async (_, fields) => {
    const { loaded } = await load({ "mcp.json": mcp({ s: { type: "stdio", ...fields } }) })
    expect(codes(loaded)).toEqual(["server-invalid"])
    expect(
      await access(loaded.data!).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

  test("expansion is a single pass: replaced text is not scanned again", async () => {
    const base = await temp()
    const root = path.join(base, "${PLUGIN_DATA}")
    const { mkdir } = await import("node:fs/promises")
    await mkdir(root)
    await writeFile(path.join(root, "plugin.json"), JSON.stringify({ $schema: PLUGIN_SCHEMA, name: "demo" }))
    await writeFile(
      path.join(root, "mcp.json"),
      JSON.stringify(mcp({ s: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}"] } })),
    )
    const loaded = await AgentPlugin.load(root, { dataRoot: path.join(base, "data") })
    expect(stdio(loaded, "s").args).toEqual([root])
  })

  test("a plugin-relative command resolves to an absolute path inside the root", async () => {
    const { loaded, root } = await load({
      "bin/server": "#!/bin/sh",
      "mcp.json": mcp({ s: { type: "stdio", command: "./bin/server", args: ["./not-a-path"] } }),
    })
    expect(stdio(loaded, "s").command).toBe(path.join(root, "bin/server"))
    expect(stdio(loaded, "s").args).toEqual(["./not-a-path"])
  })

  test("command is never expanded", async () => {
    const { loaded } = await load({ "mcp.json": mcp({ s: { type: "stdio", command: "${PLUGIN_ROOT}/bin/x" } }) })
    expect(codes(loaded)).toEqual(["server-invalid"])
  })

  test.each([
    ["a shell string", "node server.js"],
    ["an absolute path", "/usr/bin/node"],
    ["a parent path", "../bin/server"],
    ["a path without ./", "bin/server"],
    ["an escaping relative path", "./../outside"],
    ["an empty string", ""],
    ["dot", "."],
  ])("command as %s is invalid", async (_, command) => {
    const { loaded } = await load({ "mcp.json": mcp({ s: { type: "stdio", command } }) })
    expect(codes(loaded)).toEqual(["server-invalid"])
  })

  test("a plugin-relative command linked outside the root is invalid", async () => {
    const outside = await temp()
    await writeFile(path.join(outside, "server"), "#!/bin/sh")
    const { loaded } = await load({
      "bin/server": { symlink: path.join(outside, "server") },
      "mcp.json": mcp({ s: { type: "stdio", command: "./bin/server" } }),
    })
    expect(codes(loaded)).toEqual(["server-invalid"])
  })

  test("every cwd form resolves inside its directory", async () => {
    const { loaded, root } = await load({
      "data/.keep": "",
      "mcp.json": mcp({
        relative: { type: "stdio", command: "node", cwd: "./data" },
        root: { type: "stdio", command: "node", cwd: "${PLUGIN_ROOT}" },
        rootChild: { type: "stdio", command: "node", cwd: "${PLUGIN_ROOT}/data" },
        data: { type: "stdio", command: "node", cwd: "${PLUGIN_DATA}" },
        dataChild: { type: "stdio", command: "node", cwd: "${PLUGIN_DATA}/cache" },
      }),
    })
    expect(loaded.diagnostics).toEqual([])
    expect(Object.fromEntries(loaded.servers.map((server) => [server.name, (server as Mcp.Stdio).cwd]))).toEqual({
      relative: path.join(root, "data"),
      root,
      rootChild: path.join(root, "data"),
      data: loaded.data!,
      dataChild: path.join(loaded.data!, "cache"),
    })
  })

  test.each([
    ["a bare relative path", "data"],
    ["an absolute path", "/tmp"],
    ["another variable", "${HOME}"],
    ["a placeholder prefix without a slash", "${PLUGIN_ROOT}data"],
    ["a root escape", "./../.."],
    ["a root placeholder escape", "${PLUGIN_ROOT}/.."],
    ["a data escape", "${PLUGIN_DATA}/../.."],
  ])("cwd as %s is invalid", async (_, cwd) => {
    const { loaded } = await load({ "mcp.json": mcp({ s: { type: "stdio", command: "node", cwd } }) })
    expect(codes(loaded)).toEqual(["server-invalid"])
  })

  test("a cwd linked outside the root is invalid", async () => {
    const outside = await temp()
    const { loaded } = await load({
      out: { symlink: outside },
      "mcp.json": mcp({ s: { type: "stdio", command: "node", cwd: "./out" } }),
    })
    expect(codes(loaded)).toEqual(["server-invalid"])
  })

  test.each([
    ["PLUGIN_ROOT", "linux"],
    ["PLUGIN_DATA", "linux"],
    ["plugin_root", "win32"],
  ] as const)("env setting reserved %s on %s is invalid", async (name, platform) => {
    const { loaded } = await load(
      { "mcp.json": mcp({ s: { type: "stdio", command: "node", env: { [name]: "x" } } }) },
      { platform },
    )
    expect(codes(loaded)).toEqual(["server-invalid"])
  })

  test("a case variant of a reserved name is an ordinary variable outside Windows", async () => {
    const { loaded } = await load(
      { "mcp.json": mcp({ s: { type: "stdio", command: "node", env: { plugin_root: "x" } } }) },
      { platform: "linux" },
    )
    expect(stdio(loaded, "s").env.plugin_root).toBe("x")
  })

  test.each([
    ["args as a string", { args: "--flag" }],
    ["args with a number", { args: ["--port", 3000] }],
    ["env as an array", { env: ["A=1"] }],
    ["env with a number", { env: { PORT: 3000 } }],
    ["cwd as a number", { cwd: 1 }],
  ])("%s is invalid", async (_, fields) => {
    const { loaded } = await load({ "mcp.json": mcp({ s: { type: "stdio", command: "node", ...fields } }) })
    expect(codes(loaded)).toEqual(["server-invalid"])
  })
})

// Spec §7.2.1 (Streamable HTTP and legacy HTTP+SSE): URLs and literal headers.
describe("remote servers", () => {
  test("an HTTPS server keeps its literal URL and headers", async () => {
    const { loaded } = await load({
      "mcp.json": mcp({
        api: {
          type: "streamable-http",
          url: "https://deploy.example.com/mcp",
          headers: { "X-Tenant": "${PLUGIN_ROOT}" },
        },
      }),
    })
    expect(loaded.servers).toEqual([
      {
        name: "api",
        transport: "streamable-http",
        url: "https://deploy.example.com/mcp",
        headers: { "X-Tenant": "${PLUGIN_ROOT}" },
      },
    ])
  })

  test.each([
    "http://localhost:3000/mcp",
    "http://127.0.0.1/mcp",
    "http://127.8.9.10/mcp",
    "http://[::1]:8080/mcp",
    "https://example.com/mcp?x=1",
  ])("url %p is valid", async (url) => {
    const { loaded } = await load({ "mcp.json": mcp({ s: { type: "streamable-http", url } }) })
    expect(loaded.diagnostics).toEqual([])
  })

  test.each([
    "http://example.com/mcp",
    "http://localhost.example.com/mcp",
    "http://10.0.0.1/mcp",
    "https://user:pass@example.com/mcp",
    "https://user@example.com/mcp",
    "https://example.com/mcp#frag",
    "https://example.com/mcp#",
    "/relative/mcp",
    "ftp://example.com/mcp",
    "not a url",
  ])("url %p is invalid", async (url) => {
    const { loaded } = await load({ "mcp.json": mcp({ s: { type: "streamable-http", url } }) })
    expect(codes(loaded)).toEqual(["server-invalid"])
  })

  test.each([
    ["a duplicate name in different casing", { "X-Key": "a", "x-key": "b" }],
    ["an invalid name", { "Bad Header": "a" }],
    ["a value with a newline", { "X-A": "a\nb" }],
    ["a value with leading space", { "X-A": " a" }],
    ["a non-string value", { "X-A": 1 }],
    ["headers as an array", ["X-A: a"]],
  ])("headers with %s are invalid", async (_, headers) => {
    const { loaded } = await load({
      "mcp.json": mcp({ s: { type: "streamable-http", url: "https://example.com/mcp", headers } }),
    })
    expect(codes(loaded)).toEqual(["server-invalid"])
  })

  test("loopback detection", () => {
    expect(Mcp.loopback("localhost")).toBe(true)
    expect(Mcp.loopback("127.0.0.1")).toBe(true)
    expect(Mcp.loopback("[::1]")).toBe(true)
    expect(Mcp.loopback("128.0.0.1")).toBe(false)
    expect(Mcp.loopback("[::2]")).toBe(false)
  })
})
