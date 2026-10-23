import { describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { Installer } from "../src/marketplace/installer"
import {
  MarketplaceMcp,
  McpError,
  build,
  configFile,
  fingerprint,
  parameters,
  preflight,
  remove,
  write,
} from "../src/marketplace/mcp"

const param = (key: string, optional = false) => ({ key, name: key, optional })
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-mcp-"))
const skillEntry = (archive: string) => ({
  item: {
    registry: "kilo",
    kind: "skill" as const,
    id: "demo",
    name: "Demo",
    description: "",
    tags: [],
    prerequisites: [],
    parameters: [],
    options: [],
  },
  payloads: [],
  archive,
})
const mcpEntry = {
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
  payloads: ['{"command":"node"}'],
}

describe("MCP config translation", () => {
  test("malformed templates return invalid_params without including substituted secrets", () => {
    try {
      build({
        template: '{"command":"{{TOKEN}}", broken}',
        parameters: [param("TOKEN")],
        params: { TOKEN: "super-secret" },
      })
      throw new Error("expected malformed template to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(McpError)
      expect(error).toMatchObject({ reason: "invalid_params" })
      expect(String(error)).not.toContain("super-secret")
      expect(String(error)).not.toContain("broken")
    }
  })
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

  test("rejects undeclared double-brace placeholders even when supplied in params", () => {
    expect(() => build({ template: `{ "command": "{{BIN}}/x" }`, parameters: [], params: { BIN: "node" } })).toThrow(
      /The server config uses undeclared parameters: BIN/,
    )
  })

  test("substitutes declared legacy placeholders but preserves undeclared runtime expressions", () => {
    expect(
      build({
        template: JSON.stringify({ command: "node", args: ["${KEY}", "${HOME}/server.js", "${workspaceFolder}"] }),
        parameters: [param("KEY")],
        params: { KEY: 'resolved "value"', HOME: "/ignored", workspaceFolder: "/ignored" },
      }),
    ).toEqual({ type: "local", command: ["node", 'resolved "value"', "${HOME}/server.js", "${workspaceFolder}"] })
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
  test.skipIf(process.platform === "win32").each([0o644, 0o640])(
    "secret installs tighten existing config permissions %i using merged parameter metadata",
    async (mode) => {
      for (const metadata of [
        { item: [{ ...param("VALUE"), secret: true }], option: [] },
        { item: [], option: [{ ...param("VALUE"), secret: true }] },
        { item: [{ ...param("VALUE"), secret: false }], option: [{ ...param("VALUE"), secret: true }] },
      ]) {
        const directory = await tmp()
        const config = path.join(directory, "kilo2.json")
        await fs.writeFile(config, "{}")
        await fs.chmod(config, mode)
        const written = await Installer.install({
          entry: {
            ...mcpEntry,
            item: {
              ...mcpEntry.item,
              parameters: metadata.item,
              options: [{ name: "default", prerequisites: [], parameters: metadata.option }],
            },
            payloads: ['{"command":"node","args":["{{VALUE}}"]}'],
          },
          skills: path.join(directory, "skills"),
          config,
          params: { VALUE: " private-value " },
        })
        expect((await Bun.file(config).json()).mcp.servers.demo.command).toEqual(["node", "private-value"])
        expect((await fs.stat(config)).mode & 0o7777).toBe(0o600)
        await Installer.uninstall({ id: "demo", ...written })
        expect((await fs.stat(config)).mode & 0o7777).toBe(0o600)
      }
    },
  )

  test.skipIf(process.platform === "win32").each([0o644, 0o640])(
    "non-secret installs preserve config permissions %i using merged parameter metadata",
    async (mode) => {
      for (const metadata of [
        {
          item: [{ ...param("TOKEN"), secret: true }],
          option: [{ ...param("TOKEN"), secret: false }],
          value: "public",
        },
        { item: [{ ...param("TOKEN", true), secret: true }], option: [], value: "   " },
        { item: [param("TOKEN")], option: [], value: "public" },
      ]) {
        const directory = await tmp()
        const config = path.join(directory, "kilo2.json")
        await fs.writeFile(config, "{}")
        await fs.chmod(config, mode)
        const written = await Installer.install({
          entry: {
            ...mcpEntry,
            item: {
              ...mcpEntry.item,
              parameters: metadata.item,
              options: [{ name: "default", prerequisites: [], parameters: metadata.option }],
            },
            payloads: ['{"url":"https://example.com/mcp","headers":{"Authorization":"{{TOKEN}}"}}'],
          },
          skills: path.join(directory, "skills"),
          config,
          params: { TOKEN: metadata.value },
        })
        expect((await fs.stat(config)).mode & 0o7777).toBe(mode)
        await Installer.uninstall({ id: "demo", ...written })
        expect((await fs.stat(config)).mode & 0o7777).toBe(mode)
      }
    },
  )

  test.skipIf(process.platform === "win32")("secret installs tighten the actual config symlink target", async () => {
    const directory = await tmp()
    const config = path.join(directory, "kilo2.json")
    const target = path.join(directory, "target.json")
    await fs.writeFile(target, '{ // keep comments\n "model": "user/model" }')
    await fs.chmod(target, 0o644)
    await fs.symlink("target.json", config)
    await Installer.install({
      entry: {
        ...mcpEntry,
        item: { ...mcpEntry.item, parameters: [{ ...param("VALUE"), secret: true }] },
        payloads: ['{"command":"node","args":["{{VALUE}}"]}'],
      },
      skills: path.join(directory, "skills"),
      config,
      params: { VALUE: "private-value" },
    })
    expect((await fs.stat(target)).mode & 0o7777).toBe(0o600)
    expect((await fs.lstat(config)).isSymbolicLink()).toBe(true)
    expect(await fs.readlink(config)).toBe("target.json")
    expect(await fs.readFile(target, "utf8")).toContain("// keep comments")
    expect(await fs.readFile(target, "utf8")).toContain('"model": "user/model"')
    expect(await fingerprint(config, "demo")).toBe(await fingerprint(target, "demo"))
  })

  test.skipIf(process.platform === "win32")(
    "install and uninstall preserve a config symlink, target settings and comments, and logical metadata",
    async () => {
      const directory = await tmp()
      const config = path.join(directory, "kilo2.jsonc")
      const target = path.join(directory, "storage", "settings.jsonc")
      await fs.mkdir(path.dirname(target))
      await fs.writeFile(
        target,
        '{\n  // keep target comments\n  "model": "user/model",\n  "mcp": { "servers": { "foreign": { "type": "local", "command": ["keep"] } } }\n}\n',
      )
      await fs.chmod(target, 0o640)
      await fs.symlink(path.relative(directory, target), config)
      const foreign = await fingerprint(target, "foreign")
      expect(await configFile(directory, true)).toBe(config)
      const written = await Installer.install({
        entry: mcpEntry,
        skills: path.join(directory, "skills"),
        config,
        beforeWrite: async (intent) => {
          expect(intent.config).toBe(config)
          expect(intent.resources![0]).toMatchObject({ config, server: "demo" })
        },
      })
      expect(written.config).toBe(config)
      expect(written.resources![0]).toMatchObject({ config, server: "demo" })
      expect((await fs.lstat(config)).isSymbolicLink()).toBe(true)
      expect(await fs.readlink(config)).toBe(path.relative(directory, target))
      expect((await fs.stat(target)).mode & 0o7777).toBe(0o640)
      expect(await fs.readFile(target, "utf8")).toContain("// keep target comments")
      expect(await fingerprint(config, "demo")).toBe(await fingerprint(target, "demo"))
      await preflight({ file: config, name: "demo", fingerprints: written.resources![0].fingerprints })
      await expect(preflight({ file: target, name: "demo" })).rejects.toMatchObject({ reason: "conflict" })
      expect(await Installer.inspect({ id: "demo", ...written })).toEqual({ status: "ready", warnings: [] })

      await Installer.uninstall({ id: "demo", ...written })
      expect((await fs.stat(target)).mode & 0o7777).toBe(0o640)
      expect((await fs.lstat(config)).isSymbolicLink()).toBe(true)
      expect(await fs.readlink(config)).toBe(path.relative(directory, target))
      const text = await fs.readFile(target, "utf8")
      expect(text).toContain("// keep target comments")
      expect(text).toContain('"model": "user/model"')
      expect(await fingerprint(target, "foreign")).toBe(foreign)
      expect(await fingerprint(config, "demo")).toBeUndefined()
      expect(await fs.readdir(path.dirname(target))).toEqual(["settings.jsonc"])
    },
  )

  test.skipIf(process.platform === "win32")("serializes writes and removals through config aliases", async () => {
    const directory = await tmp()
    const target = path.join(directory, "target.jsonc")
    const alias = path.join(directory, "alias.jsonc")
    const second = path.join(directory, "second.jsonc")
    await fs.writeFile(target, "{ // keep alias comments\n}")
    await fs.symlink("target.jsonc", alias)
    await fs.symlink("alias.jsonc", second)
    const files = [target, alias, second]
    await Promise.all(
      files.map((file, index) =>
        write({ file, name: `server-${index}`, server: { type: "local", command: ["node"] }, replace: false }),
      ),
    )
    const fingerprints = await Promise.all(files.map((file, index) => fingerprint(file, `server-${index}`)))
    expect(fingerprints.every((value) => value !== undefined)).toBe(true)
    await Promise.all(
      files.map((file, index) => remove({ file, name: `server-${index}`, fingerprints: [fingerprints[index]!] })),
    )
    expect(await fingerprint(target, "server-0")).toBeUndefined()
    expect(await fingerprint(target, "server-1")).toBeUndefined()
    expect(await fingerprint(target, "server-2")).toBeUndefined()
    expect(await fs.readFile(target, "utf8")).toContain("// keep alias comments")
    expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true)
    expect((await fs.lstat(second)).isSymbolicLink()).toBe(true)
    const results = await Promise.allSettled(
      files.map((file) => write({ file, name: "same", server: { type: "local", command: ["node"] }, replace: false })),
    )
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected").map((result) => result.reason)).toEqual([
      expect.objectContaining({ reason: "conflict" }),
      expect.objectContaining({ reason: "conflict" }),
    ])
  })

  test.skipIf(process.platform === "win32")("serializes new files below symlinked directories", async () => {
    const directory = await tmp()
    const target = path.join(directory, "storage")
    const alias = path.join(directory, "alias")
    await fs.mkdir(target)
    await fs.symlink("storage", alias)
    const files = [path.join(target, "new", "kilo2.json"), path.join(alias, "new", "kilo2.json")]
    await Promise.all(
      files.map((file, index) =>
        write({ file, name: `server-${index}`, server: { type: "local", command: ["node"] }, replace: false }),
      ),
    )
    expect(Object.keys((await Bun.file(files[0]).json()).mcp.servers).toSorted()).toEqual(["server-0", "server-1"])
    expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true)
  })

  test.skipIf(process.platform === "win32")(
    "creates a missing config symlink target without replacing the link",
    async () => {
      const directory = await tmp()
      const config = path.join(directory, "kilo2.json")
      const target = path.join(directory, "new", "target.json")
      await fs.symlink(path.relative(directory, target), config)
      await write({ file: config, name: "demo", server: { type: "local", command: ["node"] }, replace: false })
      expect((await fs.lstat(config)).isSymbolicLink()).toBe(true)
      expect(await fingerprint(config, "demo")).toBe(await fingerprint(target, "demo"))
      await remove({ file: config, name: "demo", fingerprints: [(await fingerprint(target, "demo"))!] })
      expect((await Bun.file(target).json()).mcp.servers).toEqual({})
      expect((await fs.lstat(config)).isSymbolicLink()).toBe(true)
    },
  )

  test.skipIf(process.platform === "win32")(
    "config discovery and operations propagate non-ENOENT path errors",
    async () => {
      const directory = await tmp()
      const parent = path.join(directory, "not-a-directory")
      const file = path.join(parent, "kilo2.json")
      await fs.writeFile(parent, "keep")
      await expect(configFile(parent, true)).rejects.toMatchObject({ code: "ENOTDIR" })
      await expect(preflight({ file, name: "demo" })).rejects.toMatchObject({ code: "ENOTDIR" })
      await expect(fingerprint(file, "demo")).rejects.toMatchObject({ code: "ENOTDIR" })
      await expect(
        write({ file, name: "demo", server: { type: "local", command: ["node"] }, replace: false }),
      ).rejects.toMatchObject({ code: "ENOTDIR" })
      await expect(remove({ file, name: "demo" })).rejects.toMatchObject({ code: "ENOTDIR" })
      expect(await fs.readFile(parent, "utf8")).toBe("keep")
    },
  )

  test("a regular-file config parent cannot be overwritten", async () => {
    const directory = await tmp()
    const parent = path.join(directory, "not-a-directory")
    const file = path.join(parent, "kilo2.json")
    await fs.writeFile(parent, "keep")
    await expect(
      write({ file, name: "demo", server: { type: "local", command: ["node"] }, replace: false }),
    ).rejects.toBeDefined()
    expect(await fs.readFile(parent, "utf8")).toBe("keep")
  })

  test.skipIf(process.platform === "win32")(
    "project config links may target another supported config candidate",
    async () => {
      const directory = await tmp()
      const target = path.join(directory, "kilo2.json")
      const config = path.join(directory, ".kilo2", "kilo2.jsonc")
      await fs.mkdir(path.dirname(config))
      await fs.writeFile(target, "{}")
      await fs.symlink("../kilo2.json", config)
      expect(await configFile(directory, false)).toBe(config)
      await write({ file: config, name: "demo", server: { type: "local", command: ["node"] }, replace: false })
      expect((await Bun.file(target).json()).mcp.servers.demo).toEqual({ type: "local", command: ["node"] })
      expect(await fs.readlink(config)).toBe("../kilo2.json")
    },
  )

  test.skipIf(process.platform === "win32")(
    "resolves dangling relative config links from their physical parent",
    async () => {
      const directory = await tmp()
      const physical = path.join(directory, "physical", "project")
      const logical = path.join(directory, "alias")
      const target = path.join(directory, "physical", "dotfiles", "config.jsonc")
      await fs.mkdir(physical, { recursive: true })
      await fs.symlink(physical, logical)
      await fs.symlink("../dotfiles/config.jsonc", path.join(physical, "kilo2.jsonc"))
      const files = [path.join(logical, "kilo2.jsonc"), path.join(physical, "kilo2.jsonc"), target]
      expect(await MarketplaceMcp.resolveFile(files[0])).toBe(await MarketplaceMcp.resolveFile(target))
      await Promise.all(
        files.map((file, index) =>
          write({ file, name: `server-${index}`, server: { type: "local", command: ["node"] }, replace: false }),
        ),
      )
      expect(Object.keys((await Bun.file(target).json()).mcp.servers).toSorted()).toEqual([
        "server-0",
        "server-1",
        "server-2",
      ])
      expect((await fs.lstat(path.join(physical, "kilo2.jsonc"))).isSymbolicLink()).toBe(true)
      expect(await Bun.file(path.join(directory, "dotfiles", "config.jsonc")).exists()).toBe(false)
    },
  )

  test.skipIf(process.platform === "win32")(
    "cleanup rejects a changed config target without modifying either file",
    async () => {
      const directory = await tmp()
      const config = path.join(directory, "kilo2.jsonc")
      const original = path.join(directory, "original.jsonc")
      const changed = path.join(directory, "changed.jsonc")
      const content = JSON.stringify({ mcp: { servers: { demo: { type: "local", command: ["node"] } } } })
      await fs.writeFile(original, content)
      await fs.writeFile(changed, content)
      await fs.symlink(original, config)
      const resource = {
        config,
        server: "demo",
        target: await MarketplaceMcp.resolveFile(config),
        fingerprints: [(await fingerprint(config, "demo"))!],
      }
      await fs.unlink(config)
      await fs.symlink(changed, config)
      await expect(Installer.cleanup(resource)).rejects.toMatchObject({
        reason: "conflict",
        message: `MCP config target changed since installation: ${config}`,
      })
      expect(await fs.readFile(original, "utf8")).toBe(content)
      expect(await fs.readFile(changed, "utf8")).toBe(content)
    },
  )

  test("fingerprints normalize JSON object ordering but protect changed and legacy entries", async () => {
    const file = path.join(await tmp(), "kilo2.jsonc")
    await write({
      file,
      name: "demo",
      server: { type: "local", command: ["node"], environment: { TOKEN: "secret", MODE: "safe" } },
      replace: false,
    })
    const owned = (await fingerprint(file, "demo"))!
    await Bun.write(
      file,
      '{ // retain comments\n "mcp":{"servers":{"demo":{"environment":{"MODE":"safe","TOKEN":"secret"},"command":["node"],"type":"local"},"foreign":{"type":"local","command":["x"]}}}}',
    )
    expect(await fingerprint(file, "demo")).toBe(owned)
    await expect(remove({ file, name: "demo" })).rejects.toMatchObject({ reason: "conflict" })
    await expect(
      write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: true }),
    ).rejects.toMatchObject({ reason: "conflict" })
    await write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: true, fingerprints: [owned] })
    await expect(remove({ file, name: "demo", fingerprints: [owned] })).rejects.toMatchObject({ reason: "conflict" })
    await remove({ file, name: "demo", fingerprints: [(await fingerprint(file, "demo"))!] })
    expect(await Bun.file(file).text()).toContain("retain comments")
    expect(await fingerprint(file, "foreign")).toBeDefined()
  })
  test.skipIf(process.platform === "win32")("keeps new and replaced secret-bearing configs private", async () => {
    const file = path.join(await tmp(), "kilo2.json")
    await write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: false })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    await fs.chmod(file, 0o600)
    await write({
      file,
      name: "demo",
      server: { type: "local", command: ["y"] },
      replace: true,
      fingerprints: [(await fingerprint(file, "demo"))!],
    })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    await remove({ file, name: "demo", fingerprints: [(await fingerprint(file, "demo"))!] })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  })

  test.skipIf(process.platform === "win32").each([0, 0o777])(
    "creates new configs with exactly 0600 permissions under umask %i",
    async (mask) => {
      const file = path.join(await tmp(), "kilo2.json")
      const previous = process.umask(mask)
      try {
        await write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: false })
        expect((await fs.stat(file)).mode & 0o7777).toBe(0o600)
      } finally {
        process.umask(previous)
      }
    },
  )

  test.skipIf(process.platform === "win32").each([0o640, 0o644, 0o750])(
    "preserves existing config permission bits %i on write and removal despite a restrictive umask",
    async (mode) => {
      const file = path.join(await tmp(), "kilo2.json")
      await fs.writeFile(file, "{}")
      await fs.chmod(file, mode)
      const previous = process.umask(0o077)
      try {
        await write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: false })
        expect((await fs.stat(file)).mode & 0o7777).toBe(mode)
        await write({
          file,
          name: "demo",
          server: { type: "local", command: ["y"] },
          replace: true,
          fingerprints: [(await fingerprint(file, "demo"))!],
        })
        expect((await fs.stat(file)).mode & 0o7777).toBe(mode)
        await remove({ file, name: "demo", fingerprints: [(await fingerprint(file, "demo"))!] })
        expect((await fs.stat(file)).mode & 0o7777).toBe(mode)
      } finally {
        process.umask(previous)
      }
    },
  )

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

    await remove({ file, name: "demo", fingerprints: [(await fingerprint(file, "demo"))!] })
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
  test("preflights all resources before the checkpoint and any target writes", async () => {
    const archive = await new Bun.Archive({ "SKILL.md": "guide" }).bytes()
    using server = Bun.serve({ port: 0, fetch: () => new Response(archive) })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "config.json")
    const entry = { ...mcpEntry, companions: [{ id: "guide", archive: server.url.href }] }
    await Bun.write(config, '{"mcp":{"servers":{"demo":{"type":"local","command":["foreign"]}}}}')
    let calls = 0
    await expect(
      Installer.install({
        entry,
        skills,
        config,
        beforeWrite: async () => {
          calls++
        },
      }),
    ).rejects.toMatchObject({ reason: "conflict" })
    expect(calls).toBe(0)
    expect(await fs.readdir(directory)).toEqual(["config.json"])
    await fs.rm(config)
    const failure = new Error("checkpoint failed")
    await expect(
      Installer.install({
        entry,
        skills,
        config,
        beforeWrite: async (intent) => {
          calls++
          expect(await fs.readdir(directory)).toEqual([])
          expect(intent.resources).toHaveLength(2)
          expect(intent.resources!.every((resource) => resource.fingerprints?.length === 1)).toBe(true)
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    expect(calls).toBe(1)
    expect(await fs.readdir(directory)).toEqual([])
  })

  test("checkpoint records old and new fingerprints and interrupted replacement stays recoverable", async () => {
    let content = "old"
    using server = Bun.serve({
      port: 0,
      fetch: async () => new Response(await new Bun.Archive({ "SKILL.md": content }).bytes()),
    })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "config.json")
    const entry = skillEntry(server.url.href)
    const first = await Installer.install({ entry, skills, config })
    const previous = {
      registry: "kilo",
      kind: "skill" as const,
      id: "demo",
      scope: "global" as const,
      installedAt: 0,
      ...first,
    }
    content = "new"
    let intent: Installer.Written | undefined
    const final = await Installer.install({
      entry,
      skills,
      config,
      previous,
      beforeWrite: async (written) => {
        intent = written
        expect(await Bun.file(path.join(skills, "demo", "SKILL.md")).text()).toBe("old")
        expect(written.resources![0].fingerprints).toContain(first.resources![0].fingerprints![0])
        expect(written.resources![0].fingerprints).toHaveLength(2)
      },
    })
    expect(final.resources![0].fingerprints).toHaveLength(1)
    expect(await Installer.inspect({ id: "demo", ...final })).toEqual({ status: "ready", warnings: [] })
    expect((await Installer.inspect({ id: "demo", ...intent!, recovering: true })).status).toBe("incomplete")
    // Either old or new content is owned by the durable replacement intent.
    await Installer.uninstall({ id: "demo", ...intent! })
    expect((await Installer.inspect({ id: "demo", ...final })).status).toBe("missing")
  })

  test("uninstall attempts active and pending resources after errors and preserves modified resources", async () => {
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "config.json")
    const broken = path.join(directory, "broken.json")
    const archive = await new Bun.Archive({ "SKILL.md": "original" }).bytes()
    using server = Bun.serve({ port: 0, fetch: () => new Response(archive) })
    const written = await Installer.install({
      entry: { ...mcpEntry, companions: [{ id: "guide", archive: server.url.href }] },
      skills,
      config,
    })
    await Bun.write(broken, "{ malformed")
    const record = { id: "demo", ...written, pending: [{ config: broken, server: "demo" }] }
    // Pending resources warn but do not participate in the active installation status.
    expect((await Installer.inspect(record)).status).toBe("ready")
    await Bun.write(path.join(skills, "guide", "added.txt"), "keep")
    const result = await Installer.uninstall(record).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).errors).toHaveLength(2)
    expect((await Bun.file(config).json()).mcp.servers).toEqual({})
    expect(await Bun.file(path.join(skills, "guide", "added.txt")).text()).toBe("keep")
    expect((await Installer.inspect(record)).status).toBe("modified")
    expect((await Installer.inspect(record)).warnings.join(" ")).toContain("awaiting cleanup")
    expect(record.resources).toEqual(written.resources)
  })

  test("MCP replacement checkpoints both content versions and refuses externally changed entries", async () => {
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "config.json")
    const first = await Installer.install({ entry: mcpEntry, skills, config })
    const previous = {
      registry: "kilo",
      kind: "mcp" as const,
      id: "demo",
      scope: "global" as const,
      installedAt: 0,
      ...first,
    }
    let calls = 0
    const written = await Installer.install({
      entry: { ...mcpEntry, payloads: ['{"command":"changed"}'] },
      skills,
      config,
      previous,
      beforeWrite: async (intent) => {
        calls++
        expect(intent.resources![0].fingerprints).toHaveLength(2)
        expect(intent.resources![0].fingerprints).toContain(first.resources![0].fingerprints![0])
        expect((await Bun.file(config).json()).mcp.servers.demo.command).toEqual(["node"])
      },
    })
    expect(calls).toBe(1)
    expect(written.resources![0].fingerprints).toHaveLength(1)
    await Bun.write(config, '{"mcp":{"servers":{"demo":{"type":"local","command":["user-edited"]}}}}')
    expect((await Installer.inspect({ id: "demo", ...written })).status).toBe("modified")
    await expect(Installer.uninstall({ id: "demo", ...written })).rejects.toBeInstanceOf(AggregateError)
    await expect(
      Installer.install({
        entry: mcpEntry,
        skills,
        config,
        previous: { ...previous, ...written },
        beforeWrite: async () => {
          calls++
        },
      }),
    ).rejects.toMatchObject({ reason: "conflict" })
    expect(calls).toBe(1)
    expect((await Bun.file(config).json()).mcp.servers.demo.command).toEqual(["user-edited"])
  })

  test("rolls back every newly created companion without deleting previously owned companions", async () => {
    const archive = await new Bun.Archive({ "SKILL.md": "guide" }).bytes()
    using server = Bun.serve({ port: 0, fetch: () => new Response(archive) })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "config.json")
    const first = await Installer.install({
      entry: { ...mcpEntry, companions: [{ id: "owned", archive: server.url.href }] },
      skills,
      config,
    })
    const previous = {
      registry: "kilo",
      kind: "mcp" as const,
      id: "demo",
      scope: "global" as const,
      installedAt: 0,
      ...first,
    }
    await expect(
      Installer.install({
        entry: { ...mcpEntry, companions: ["owned", "new-a", "new-b"].map((id) => ({ id, archive: server.url.href })) },
        skills,
        config,
        previous,
        beforeWrite: async () => {
          await fs.rm(config)
          await fs.mkdir(config)
        },
      }),
    ).rejects.toMatchObject({ code: "EISDIR" })
    expect(await fs.readdir(skills)).toEqual(["owned"])
    expect(await Bun.file(path.join(skills, "owned", "SKILL.md")).text()).toBe("guide")
  })

  test("rollback settles every resource and reports cleanup errors alongside the original error", async () => {
    const archive = await new Bun.Archive({ "SKILL.md": "guide" }).bytes()
    using server = Bun.serve({ port: 0, fetch: () => new Response(archive) })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const original = new Error("config write failed")
    let intent: Installer.Written | undefined
    // Inject an edit at the failing write boundary; cleanup still uses the real filesystem and fingerprints.
    const failure = spyOn(MarketplaceMcp, "write").mockImplementation(async () => {
      await Bun.write(path.join(skills, "new-a", "user.txt"), "user content")
      throw original
    })
    try {
      const error = await Installer.install({
        entry: { ...mcpEntry, companions: ["new-a", "new-b"].map((id) => ({ id, archive: server.url.href })) },
        skills,
        config: path.join(directory, "config.json"),
        beforeWrite: async (written) => {
          intent = written
        },
      }).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).cause).toBe(original)
      expect((error as AggregateError).errors[0]).toBe(original)
      expect((error as AggregateError).errors[1]).toMatchObject({ reason: "conflict" })
      expect(String(error)).toContain("config write failed")
      expect(String(error)).toContain("new-a")
      expect(await fs.readdir(skills)).toEqual(["new-a"])
      expect(intent!.resources).toHaveLength(3)
      await fs.rm(path.join(skills, "new-a", "user.txt"))
      await Installer.uninstall({ id: "demo", ...intent! })
      expect(await fs.readdir(skills)).toEqual([])
    } finally {
      failure.mockRestore()
    }
  })

  test("bounds streamed downloads, rejects oversized headers early, and wraps body failures", async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let pulls = 0
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            pull(controller) {
              pulls++
              controller.enqueue(chunk)
            },
          }),
        )
      },
      error: () => new Response("failure", { status: 500 }),
    })
    const directory = await tmp()
    await expect(
      Installer.install({
        entry: skillEntry(server.url.href),
        skills: path.join(directory, "skills"),
        config: path.join(directory, "config.json"),
      }),
    ).rejects.toBeInstanceOf(Installer.FetchError)
    expect(pulls).toBeLessThan(80)
    const broken = createServer((request, response) => {
      if (request.url === "/header") {
        response.writeHead(200, { "content-length": String(33 * 1024 * 1024) })
        // The response never finishes: it can only complete by rejecting the header and canceling.
        response.write("x")
        return
      }
      response.writeHead(200, { "content-length": "100", connection: "close" })
      response.end("short")
    })
    await new Promise<void>((resolve) => broken.listen(0, "127.0.0.1", resolve))
    try {
      const address = broken.address()
      if (!address || typeof address === "string") throw new Error("Missing HTTP fixture address")
      for (const route of ["header", "failure"]) {
        await expect(
          Installer.install({
            entry: skillEntry(`http://127.0.0.1:${address.port}/${route}`),
            skills: path.join(directory, "skills"),
            config: path.join(directory, "config.json"),
          }),
        ).rejects.toBeInstanceOf(Installer.FetchError)
      }
    } finally {
      broken.closeAllConnections()
      if (broken.listening) await new Promise<void>((resolve) => broken.close(() => resolve()))
    }
    expect(await fs.readdir(directory)).toEqual([])
  })

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
    expect(written).toMatchObject({ paths: [path.join(skills, "guide")], config, server: "demo" })
    expect(written.resources).toHaveLength(2)
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
    expect(again).toMatchObject({
      paths: [path.join(skills, "guide")],
      config: second,
      server: "demo",
      pending: written.resources!.filter((resource) => !("path" in resource) || resource.path.endsWith("extra")),
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
    await expect(Installer.uninstall({ id: "demo", ...again })).rejects.toBeInstanceOf(AggregateError)
    expect((await Bun.file(second).json()).mcp.servers).toEqual({})
    await Bun.write(
      first,
      JSON.stringify({ mcp: { servers: { demo: { type: "remote", url: "https://old.example.com" } } } }),
    )
    // A legacy path-only pending record cannot authorize reclaiming a foreign entry.
    await expect(
      Installer.install({ entry, skills, config: first, previous: { ...previous, ...again } }),
    ).rejects.toMatchObject({ reason: "conflict" })
    const owned = {
      ...previous,
      ...again,
      pending: [{ config: first, server: "demo", fingerprints: [(await fingerprint(first, "demo"))!] }],
    }
    const reclaimed = await Installer.install({ entry, skills, config: first, previous: owned })
    expect(reclaimed.pending).toEqual(again.resources)
    await Installer.uninstall({ id: "demo", ...reclaimed })
    expect((await Bun.file(first).json()).mcp.servers).toEqual({})
    expect((await Bun.file(second).json()).mcp.servers).toEqual({})
  })
})
