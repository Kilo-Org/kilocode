import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Installer } from "../src/marketplace/installer"
import { McpError, build, configFile, parameters, remove, write } from "../src/marketplace/mcp"

const param = (key: string, optional = false) => ({ key, name: key, optional })
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-mcp-"))

describe("MCP config translation", () => {
  test("converts a v1 local config and fills parameters", () => {
    expect(
      build({
        template: `{ "command": "npx", "args": ["-y", "@apify/actors-mcp-server", "--actors", "{{ACTOR_LIST}}"], "env": { "APIFY_TOKEN": "{{APIFY_TOKEN}}" } }`,
        parameters: [param("APIFY_TOKEN"), param("ACTOR_LIST")],
        params: { APIFY_TOKEN: "tok", ACTOR_LIST: "a,b" },
      }),
    ).toEqual({
      type: "local",
      command: ["npx", "-y", "@apify/actors-mcp-server", "--actors", "a,b"],
      environment: { APIFY_TOKEN: "tok" },
    })
  })

  test("converts streamable-http and sse configs to remote servers", () => {
    expect(
      build({
        template: `{ "type": "streamable-http", "url": "https://{{HOST}}/mcp", "headers": { "Authorization": "Bearer {{TOKEN}}" } }`,
        parameters: [param("HOST"), param("TOKEN")],
        params: { HOST: "example.com", TOKEN: "t" },
      }),
    ).toEqual({ type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer t" } })
    // v2 remote servers have no environment, so `env` is dropped.
    expect(
      build({ template: `{ "type": "sse", "url": "https://x/sse", "env": { "A": "b" } }`, parameters: [], params: {} }),
    ).toEqual({ type: "remote", url: "https://x/sse" })
  })

  test("passes v2 local configs through", () => {
    expect(
      build({ template: `{ "type": "local", "command": ["npx", "-y", "server"] }`, parameters: [], params: {} }),
    ).toEqual({ type: "local", command: ["npx", "-y", "server"] })
  })

  test("preserves supported v2 local and remote settings", () => {
    const settings = { disabled: true, codemode: false, timeout: { startup: 60_000 }, protocol: "auto" } as const
    const local = { type: "local", command: ["node", "server.js"], cwd: "/opt/server", ...settings } as const
    const remote = { type: "remote", url: "https://example.com/mcp", oauth: false, ...settings } as const
    expect(build({ template: JSON.stringify(local), parameters: [], params: {} })).toEqual(local)
    expect(build({ template: JSON.stringify(remote), parameters: [], params: {} })).toEqual(remote)
  })

  test("drops empty optional values and rejects missing required ones", () => {
    const template = `{ "command": "x", "env": { "TOKEN": "{{TOKEN}}", "LIMIT": "{{LIMIT}}" } }`
    const parameters = [param("TOKEN"), param("LIMIT", true)]
    expect(build({ template, parameters, params: { TOKEN: "t" } })).toEqual({
      type: "local",
      command: ["x"],
      environment: { TOKEN: "t" },
    })
    expect(() => build({ template, parameters, params: {} })).toThrow(/Missing required parameters: TOKEN/)
  })

  test("omits fully empty optional v2 environment and header maps", () => {
    expect(
      build({
        template: JSON.stringify({ type: "local", command: ["x"], environment: { TOKEN: "{{TOKEN}}" } }),
        parameters: [param("TOKEN", true)],
        params: {},
      }),
    ).toEqual({ type: "local", command: ["x"] })
    expect(
      build({
        template: JSON.stringify({ type: "remote", url: "https://example.com/mcp", headers: { TOKEN: "{{TOKEN}}" } }),
        parameters: [param("TOKEN", true)],
        params: {},
      }),
    ).toEqual({ type: "remote", url: "https://example.com/mcp" })
  })

  test("escapes values so they cannot change the config structure", () => {
    const server = build({
      template: `{ "command": "x", "env": { "TOKEN": "{{TOKEN}}" } }`,
      parameters: [param("TOKEN")],
      params: { TOKEN: `a", "EVIL": "1` },
    })
    expect(server).toEqual({ type: "local", command: ["x"], environment: { TOKEN: `a", "EVIL": "1` } })
  })

  test("preserves literal dollar sequences in both placeholder syntaxes", () => {
    for (const value of ["a$$b", "a$&b", "a$`b", "a$'b"]) {
      const server = build({
        template: JSON.stringify({ command: "x", env: { TOKEN: "{{TOKEN}}", LEGACY: "${TOKEN}" } }),
        parameters: [param("TOKEN")],
        params: { TOKEN: value },
      })
      expect(server).toEqual({ type: "local", command: ["x"], environment: { TOKEN: value, LEGACY: value } })
    }
  })

  test("rejects placeholders that no parameter declares", () => {
    expect(() => build({ template: `{ "command": "{{BIN}}/x" }`, parameters: [], params: {} })).toThrow(McpError)
    expect(() => build({ template: '{ "command": "${BIN}/x" }', parameters: [], params: {} })).toThrow(McpError)
  })

  test("substitutes only original placeholders and preserves placeholder-like parameter values", () => {
    const value = '{{SECOND}} ${SECOND} {{UNKNOWN}} ${UNKNOWN} "quoted" \\path'
    expect(
      build({
        template: JSON.stringify({
          command: "x",
          env: { FIRST: "{{FIRST}}", LEGACY: "${FIRST}", SECOND: "{{SECOND}}" },
        }),
        parameters: [param("FIRST"), param("SECOND")],
        params: { FIRST: value, SECOND: "resolved" },
      }),
    ).toEqual({ type: "local", command: ["x"], environment: { FIRST: value, LEGACY: value, SECOND: "resolved" } })
  })

  test("merges item and option parameters, the option winning", () => {
    const item = { parameters: [param("A"), param("B")] } as never
    expect(parameters(item, { parameters: [param("B", true), param("C")] } as never)).toEqual([
      param("A"),
      param("B", true),
      param("C"),
    ])
  })
})

describe("MCP config files", () => {
  test.skipIf(process.platform === "win32")("keeps new and replaced secret-bearing configs private", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: false })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    await fs.chmod(file, 0o600)
    await write({ file, name: "demo", server: { type: "local", command: ["y"] }, replace: true })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    await remove({ file, name: "demo" })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  })

  test("writes a new kilo2.json, keeps comments, refuses foreign entries and removes", async () => {
    const directory = await tmp()
    const file = await configFile(directory, true)
    expect(file).toBe(path.join(directory, "kilo2.json"))
    await write({ file, name: "demo", server: { type: "remote", url: "https://x" }, replace: false })
    expect(await Bun.file(file).json()).toEqual({ mcp: { servers: { demo: { type: "remote", url: "https://x" } } } })

    await Bun.write(
      file,
      `{\n  // keep me\n  "model": "m",\n  "mcp": { "servers": { "mine": { "type": "remote", "url": "https://m" } } }\n}\n`,
    )
    await expect(
      write({ file, name: "mine", server: { type: "remote", url: "https://x" }, replace: false }),
    ).rejects.toMatchObject({ reason: "conflict" })
    await write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: false })
    const text = await Bun.file(file).text()
    expect(text).toContain("// keep me")
    expect(text).toContain(`"demo"`)

    await remove({ file, name: "demo" })
    const after = await Bun.file(file).text()
    expect(after).toContain("// keep me")
    expect(after).toContain(`"mine"`)
    expect(after).not.toContain(`"demo"`)
    await remove({ file, name: "demo" })
    expect(await fs.readdir(directory)).toEqual(["kilo2.json"])
  })

  test("keeps both entries when two installs write the same file at once", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Promise.all(
      ["a", "b", "c"].map((name) =>
        write({ file, name, server: { type: "remote", url: `https://${name}` }, replace: false }),
      ),
    )
    expect(Object.keys((await Bun.file(file).json()).mcp.servers).toSorted()).toEqual(["a", "b", "c"])
  })

  test("prefers an existing project .kilo2/kilo2.jsonc", async () => {
    const directory = await tmp()
    await fs.mkdir(path.join(directory, ".kilo2"))
    await Bun.write(path.join(directory, ".kilo2", "kilo2.jsonc"), "{}")
    expect(await configFile(directory, false)).toBe(path.join(directory, ".kilo2", "kilo2.jsonc"))
  })

  test("refuses to edit a config that does not parse", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await Bun.write(file, "{ broken")
    await expect(
      write({ file, name: "demo", server: { type: "remote", url: "https://x" }, replace: false }),
    ).rejects.toMatchObject({ reason: "invalid_params" })
    expect(await Bun.file(file).text()).toBe("{ broken")
    await expect(remove({ file, name: "demo" })).rejects.toMatchObject({ reason: "invalid_params" })
  })

  test("remove ignores missing files but propagates other filesystem read errors", async () => {
    const directory = await tmp()
    await remove({ file: path.join(directory, "missing.json"), name: "demo" })
    await expect(remove({ file: directory, name: "demo" })).rejects.toMatchObject({ code: "EISDIR" })
  })
})

describe("MCP install with companion skills", () => {
  test("installs the server and its skills, rolls back on conflict, and uninstalls everything", async () => {
    const archive = await new Bun.Archive(
      { "guide/SKILL.md": "---\nname: guide\ndescription: Guide\n---\n" },
      { compress: "gzip" },
    ).bytes()
    using server = Bun.serve({ port: 0, fetch: () => new Response(archive) })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "kilo2.json")
    const entry = {
      item: {
        registry: "kilo",
        kind: "mcp" as const,
        id: "demo",
        name: "Demo",
        description: "",
        tags: [],
        prerequisites: [],
        parameters: [param("TOKEN")],
        options: [
          { name: "NPX", prerequisites: [], parameters: [] },
          { name: "Remote", prerequisites: [], parameters: [] },
        ],
      },
      payloads: [`{ "command": "npx", "env": { "TOKEN": "{{TOKEN}}" } }`, `{ "type": "sse", "url": "https://x" }`],
      companions: [{ id: "guide", archive: server.url.href }],
    }

    await expect(Installer.install({ entry, skills, config, params: {} })).rejects.toMatchObject({
      reason: "invalid_params",
    })
    expect(await fs.readdir(directory)).toEqual([])

    const written = await Installer.install({ entry, skills, config, option: "Remote", params: { TOKEN: "t" } })
    expect(written).toEqual({ paths: [path.join(skills, "guide")], config, server: "demo" })
    expect((await Bun.file(config).json()).mcp.servers.demo).toEqual({ type: "remote", url: "https://x" })

    // A second install without a previous record conflicts and leaves the first install intact.
    await expect(Installer.install({ entry, skills, config, params: { TOKEN: "t" } })).rejects.toMatchObject({
      reason: "conflict",
    })
    expect(await fs.readdir(skills)).toEqual(["guide"])

    await Installer.uninstall({ id: "demo", ...written })
    expect(await Bun.file(config).json()).toEqual({ mcp: { servers: {} } })
    expect(await fs.readdir(skills)).toEqual([])
  })

  test("a reinstall reports obsolete resources without removing them before ownership is persisted", async () => {
    const archive = (name: string) =>
      new Bun.Archive(
        { [`${name}/SKILL.md`]: `---\nname: ${name}\ndescription: ${name}\n---\n` },
        { compress: "gzip" },
      ).bytes()
    const archives = { guide: await archive("guide"), extra: await archive("extra") }
    using server = Bun.serve({
      port: 0,
      fetch: (request) => new Response(archives[new URL(request.url).pathname.slice(1) as keyof typeof archives]),
    })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const first = path.join(directory, "first.json")
    const second = path.join(directory, "second.json")
    const item = {
      registry: "kilo",
      kind: "mcp" as const,
      id: "demo",
      name: "Demo",
      description: "",
      tags: [],
      prerequisites: [],
      parameters: [],
      options: [{ name: "Remote", prerequisites: [], parameters: [] }],
    }
    const payloads = [`{ "type": "sse", "url": "https://x" }`]
    const companion = (id: string) => ({ id, archive: new URL(id, server.url).href })

    const written = await Installer.install({
      entry: { item, payloads, companions: [companion("guide"), companion("extra")] },
      skills,
      config: first,
    })
    expect((await fs.readdir(skills)).toSorted()).toEqual(["extra", "guide"])

    const again = await Installer.install({
      entry: { item, payloads, companions: [companion("guide")] },
      skills,
      config: second,
      previous: { registry: "kilo", kind: "mcp", id: "demo", scope: "global", installedAt: 0, ...written },
    })
    expect(again).toEqual({
      paths: [path.join(skills, "guide")],
      config: second,
      server: "demo",
      pending: [{ path: path.join(skills, "extra") }, { config: first, server: "demo" }],
    })
    expect((await fs.readdir(skills)).toSorted()).toEqual(["extra", "guide"])
    expect((await Bun.file(first).json()).mcp.servers.demo).toBeDefined()
    for (const resource of again.pending ?? []) await Installer.cleanup(resource)
    expect(await fs.readdir(skills)).toEqual(["guide"])
    expect(await Bun.file(first).json()).toEqual({ mcp: { servers: {} } })
    expect((await Bun.file(second).json()).mcp.servers.demo).toEqual({ type: "remote", url: "https://x" })
  })

  test("reinstall retains failed cleanup, can reclaim pending resources, and uninstall retries them", async () => {
    const directory = await tmp()
    const first = path.join(directory, "first.json")
    const second = path.join(directory, "second.json")
    const skills = path.join(directory, "skills")
    const entry = {
      item: {
        registry: "kilo",
        kind: "mcp" as const,
        id: "demo",
        name: "Demo",
        description: "",
        tags: [],
        prerequisites: [],
        parameters: [],
        options: [],
      },
      payloads: ['{"url":"https://new.example.com"}'],
    }
    await Bun.write(first, "{ broken")
    const previous = {
      registry: "kilo",
      kind: "mcp" as const,
      id: "demo",
      scope: "global" as const,
      installedAt: 0,
      paths: [],
      config: first,
    }
    const written = await Installer.install({ entry, skills, config: second, previous })
    expect(written.pending).toEqual([{ config: first, server: "demo" }])
    await expect(Installer.cleanup(written.pending![0])).rejects.toMatchObject({ reason: "invalid_params" })
    expect((await Bun.file(second).json()).mcp.servers.demo.url).toBe("https://new.example.com")

    const again = await Installer.install({ entry, skills, config: second, previous: { ...previous, ...written } })
    expect(again.pending).toEqual(written.pending)
    await expect(Installer.uninstall({ id: "demo", ...again })).rejects.toMatchObject({ reason: "invalid_params" })
    await Bun.write(
      first,
      JSON.stringify({ mcp: { servers: { demo: { type: "remote", url: "https://old.example.com" } } } }),
    )
    const reclaimed = await Installer.install({ entry, skills, config: first, previous: { ...previous, ...again } })
    expect(reclaimed.pending).toEqual([{ config: second, server: "demo" }])
    await Installer.uninstall({ id: "demo", ...reclaimed })
    expect((await Bun.file(first).json()).mcp.servers).toEqual({})
    expect((await Bun.file(second).json()).mcp.servers).toEqual({})
  })
})
