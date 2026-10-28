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

describe("MCP translation", () => {
  test("malformed templates fail without exposing substituted secrets", () => {
    try {
      build({
        template: '{"command":"{{TOKEN}}", broken}',
        parameters: [param("TOKEN")],
        params: { TOKEN: "super-secret" },
      })
      throw new Error("expected malformed template failure")
    } catch (error) {
      expect(error).toBeInstanceOf(McpError)
      expect(error).toMatchObject({ reason: "invalid_params" })
      expect(String(error)).not.toContain("super-secret")
      expect(String(error)).not.toContain("broken")
    }
  })
  test("converts local v1 config and fills parameters", () => {
    expect(
      build({
        template:
          '{"command":"npx","args":["-y","@apify/actors-mcp-server","--actors","{{ACTOR_LIST}}"],"env":{"APIFY_TOKEN":"{{APIFY_TOKEN}}"}}',
        parameters: [param("APIFY_TOKEN"), param("ACTOR_LIST")],
        params: { APIFY_TOKEN: "tok", ACTOR_LIST: "a,b" },
      }),
    ).toEqual({
      type: "local",
      command: ["npx", "-y", "@apify/actors-mcp-server", "--actors", "a,b"],
      environment: { APIFY_TOKEN: "tok" },
    })
  })
  test("converts HTTP/SSE and preserves supported native local/remote settings", () => {
    expect(
      build({
        template:
          '{"type":"streamable-http","url":"https://{{HOST}}/mcp","headers":{"Authorization":"Bearer {{TOKEN}}"}}',
        parameters: [param("HOST"), param("TOKEN")],
        params: { HOST: "example.com", TOKEN: "t" },
      }),
    ).toEqual({ type: "remote", url: "https://example.com/mcp", headers: { Authorization: "Bearer t" } })
    expect(
      build({ template: '{"type":"sse","url":"https://x/sse","env":{"A":"b"}}', parameters: [], params: {} }),
    ).toEqual({ type: "remote", url: "https://x/sse" })
    expect(build({ template: '{"type":"local","command":["npx","-y","server"]}', parameters: [], params: {} })).toEqual(
      { type: "local", command: ["npx", "-y", "server"] },
    )
    const settings = { disabled: true, codemode: false, timeout: { startup: 60_000 }, protocol: "auto" } as const
    for (const server of [
      { type: "local", command: ["node", "server.js"], cwd: "/opt/server", ...settings },
      { type: "remote", url: "https://example.com/mcp", oauth: false, ...settings },
    ] as const)
      expect(build({ template: JSON.stringify(server), parameters: [], params: {} })).toEqual(server)
  })
  test("validates required fields and omits empty optional maps", () => {
    const template = '{"command":"x","env":{"TOKEN":"{{TOKEN}}","LIMIT":"{{LIMIT}}"}}'
    const parameters = [param("TOKEN"), param("LIMIT", true)]
    expect(build({ template, parameters, params: { TOKEN: "t" } })).toEqual({
      type: "local",
      command: ["x"],
      environment: { TOKEN: "t" },
    })
    expect(() => build({ template, parameters, params: {} })).toThrow(/Missing required parameters: TOKEN/)
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
  test("escapes values and preserves dollar sequences in both placeholder syntaxes", () => {
    for (const value of ['a", "EVIL": "1', "a$$b", "a$&b", "a$`b", "a$'b"]) {
      expect(
        build({
          template: JSON.stringify({ command: "x", env: { TOKEN: "{{TOKEN}}", LEGACY: "${TOKEN}" } }),
          parameters: [param("TOKEN")],
          params: { TOKEN: value },
        }),
      ).toEqual({ type: "local", command: ["x"], environment: { TOKEN: value, LEGACY: value } })
    }
    expect(() => build({ template: '{"command":"{{BIN}}/x"}', parameters: [], params: { BIN: "node" } })).toThrow(
      /undeclared parameters: BIN/,
    )
    expect(
      build({
        template: JSON.stringify({ command: "node", args: ["${KEY}", "${HOME}/server.js", "${workspaceFolder}"] }),
        parameters: [param("KEY")],
        params: { KEY: 'resolved "value"', HOME: "/ignored", workspaceFolder: "/ignored" },
      }),
    ).toEqual({ type: "local", command: ["node", 'resolved "value"', "${HOME}/server.js", "${workspaceFolder}"] })
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
    expect(
      parameters(
        { parameters: [param("A"), param("B")] } as never,
        { parameters: [param("B", true), param("C")] } as never,
      ),
    ).toEqual([param("A"), param("B", true), param("C")])
  })
})

describe("MCP files", () => {
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
  test.skipIf(process.platform === "win32").each([0o644, 0o640])(
    "merged secret metadata controls config permissions %i",
    async (mode) => {
      for (const metadata of [
        { item: [{ ...param("VALUE"), secret: true }], option: [], value: " private-value ", expected: 0o600 },
        { item: [], option: [{ ...param("VALUE"), secret: true }], value: " private-value ", expected: 0o600 },
        {
          item: [{ ...param("VALUE"), secret: false }],
          option: [{ ...param("VALUE"), secret: true }],
          value: " private-value ",
          expected: 0o600,
        },
        {
          item: [{ ...param("VALUE"), secret: true }],
          option: [{ ...param("VALUE"), secret: false }],
          value: "public",
          expected: mode,
        },
        { item: [{ ...param("VALUE", true), secret: true }], option: [], value: "   ", expected: mode },
        { item: [param("VALUE")], option: [], value: "public", expected: mode },
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
            payloads: ['{"url":"https://example.com/mcp","headers":{"Authorization":"{{VALUE}}"}}'],
          },
          skills: path.join(directory, "skills"),
          config,
          params: { VALUE: metadata.value },
        })
        expect((await fs.stat(config)).mode & 0o7777).toBe(metadata.expected)
        if (metadata.value.trim())
          expect((await Bun.file(config).json()).mcp.servers.demo.headers.Authorization).toBe(metadata.value.trim())
        await Installer.uninstall({ id: "demo", ...written })
        expect((await fs.stat(config)).mode & 0o7777).toBe(metadata.expected)
      }
    },
  )
  test.skipIf(process.platform === "win32")("secret installs tighten the real symlink target", async () => {
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
    "install/remove preserve symlink, settings, comments and logical ownership",
    async () => {
      const directory = await tmp()
      const config = path.join(directory, "kilo2.jsonc")
      const target = path.join(directory, "storage", "settings.jsonc")
      await fs.mkdir(path.dirname(target))
      await fs.writeFile(
        target,
        '{\n // keep target comments\n "model": "user/model",\n "mcp": { "servers": { "foreign": { "type": "local", "command": ["keep"] } } }\n}\n',
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
  test.skipIf(process.platform === "win32")(
    "serializes config aliases and conflicting concurrent installs",
    async () => {
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
      const hashes = await Promise.all(files.map((file, index) => fingerprint(file, `server-${index}`)))
      expect(hashes.every((value) => value !== undefined)).toBe(true)
      await Promise.all(
        files.map((file, index) => remove({ file, name: `server-${index}`, fingerprints: [hashes[index]!] })),
      )
      for (const index of [0, 1, 2]) expect(await fingerprint(target, `server-${index}`)).toBeUndefined()
      expect(await fs.readFile(target, "utf8")).toContain("// keep alias comments")
      expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true)
      expect((await fs.lstat(second)).isSymbolicLink()).toBe(true)
      const results = await Promise.allSettled(
        files.map((file) =>
          write({ file, name: "same", server: { type: "local", command: ["node"] }, replace: false }),
        ),
      )
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      expect(results.filter((result) => result.status === "rejected").map((result) => result.reason)).toEqual([
        expect.objectContaining({ reason: "conflict" }),
        expect.objectContaining({ reason: "conflict" }),
      ])
    },
  )
  test.skipIf(process.platform === "win32")("serializes new files under symlinked directories", async () => {
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
  test.skipIf(process.platform === "win32")("creates dangling config targets without replacing links", async () => {
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
  })
  test.skipIf(process.platform === "win32")(
    "propagates non-ENOENT path errors and never overwrites non-directory parents",
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
  test.skipIf(process.platform === "win32")("project links can target another native candidate", async () => {
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
  })
  test.skipIf(process.platform === "win32")("resolves dangling relative links from their physical parent", async () => {
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
  })
  test.skipIf(process.platform === "win32")(
    "cleanup rejects changed config targets without modifying either",
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
  test("fingerprints ignore ordering but protect changed and unowned entries", async () => {
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
  test.skipIf(process.platform === "win32").each([0, 0o777])(
    "new configs are exactly 0600 under umask %i",
    async (mask) => {
      const file = path.join(await tmp(), "kilo2.json")
      const previous = process.umask(mask)
      try {
        await write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: false })
        expect((await fs.stat(file)).mode & 0o7777).toBe(0o600)
        await write({
          file,
          name: "demo",
          server: { type: "local", command: ["y"] },
          replace: true,
          fingerprints: [(await fingerprint(file, "demo"))!],
        })
        expect((await fs.stat(file)).mode & 0o7777).toBe(0o600)
        await remove({ file, name: "demo", fingerprints: [(await fingerprint(file, "demo"))!] })
        expect((await fs.stat(file)).mode & 0o7777).toBe(0o600)
      } finally {
        process.umask(previous)
      }
    },
  )
  test.skipIf(process.platform === "win32").each([0o640, 0o644, 0o750])(
    "preserves existing mode %i despite restrictive umask",
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
  test("writes native config, preserves comments and refuses foreign entries", async () => {
    const directory = await tmp()
    const file = await configFile(directory, true)
    expect(file).toBe(path.join(directory, "kilo2.json"))
    await write({ file, name: "demo", server: { type: "remote", url: "https://x" }, replace: false })
    expect(await Bun.file(file).json()).toEqual({ mcp: { servers: { demo: { type: "remote", url: "https://x" } } } })
    await Bun.write(
      file,
      '{\n // keep me\n "model": "m",\n "mcp": { "servers": { "mine": { "type": "remote", "url": "https://m" } } }\n}\n',
    )
    await expect(
      write({ file, name: "mine", server: { type: "remote", url: "https://x" }, replace: false }),
    ).rejects.toMatchObject({ reason: "conflict" })
    await write({ file, name: "demo", server: { type: "local", command: ["x"] }, replace: false })
    expect(await Bun.file(file).text()).toContain("// keep me")
    expect(await Bun.file(file).text()).toContain('"demo"')
    await remove({ file, name: "demo", fingerprints: [(await fingerprint(file, "demo"))!] })
    const after = await Bun.file(file).text()
    expect(after).toContain("// keep me")
    expect(after).toContain('"mine"')
    expect(after).not.toContain('"demo"')
    await remove({ file, name: "demo" })
    expect(await fs.readdir(directory)).toEqual(["kilo2.json"])
  })
  test("concurrent installs keep all entries; project discovery prefers existing .kilo2 config", async () => {
    const directory = await tmp()
    const file = path.join(directory, "kilo2.json")
    await Promise.all(
      ["a", "b", "c"].map((name) =>
        write({ file, name, server: { type: "remote", url: `https://${name}` }, replace: false }),
      ),
    )
    expect(Object.keys((await Bun.file(file).json()).mcp.servers).toSorted()).toEqual(["a", "b", "c"])
    await fs.mkdir(path.join(directory, ".kilo2"))
    await Bun.write(path.join(directory, ".kilo2", "kilo2.jsonc"), "{}")
    expect(await configFile(directory, false)).toBe(path.join(directory, ".kilo2", "kilo2.jsonc"))
  })
  test("refuses malformed JSONC; ignores only missing files on removal", async () => {
    const directory = await tmp()
    const file = path.join(directory, "kilo2.json")
    await Bun.write(file, "{ broken")
    await expect(
      write({ file, name: "demo", server: { type: "remote", url: "https://x" }, replace: false }),
    ).rejects.toMatchObject({ reason: "invalid_params" })
    expect(await Bun.file(file).text()).toBe("{ broken")
    await expect(remove({ file, name: "demo" })).rejects.toMatchObject({ reason: "invalid_params" })
    await remove({ file: path.join(directory, "missing.json"), name: "demo" })
    await expect(remove({ file: directory, name: "demo" })).rejects.toMatchObject({ code: "EISDIR" })
  })
})

describe("MCP companion lifecycle", () => {
  test("preflights every resource before checkpoint or writes", async () => {
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
  test("replacement checkpoints both versions and interrupted skill replacement remains recoverable", async () => {
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
    await Installer.uninstall({ id: "demo", ...intent! })
    expect((await Installer.inspect({ id: "demo", ...final })).status).toBe("missing")
  })
  test("uninstall settles active and pending cleanup, preserving modified resources", async () => {
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
    const before = structuredClone(written.resources)
    expect((await Installer.inspect(record)).status).toBe("ready")
    await Bun.write(path.join(skills, "guide", "added.txt"), "keep")
    const result = await Installer.uninstall(record).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).errors).toHaveLength(2)
    expect((await Bun.file(config).json()).mcp.servers).toEqual({})
    expect(await Bun.file(path.join(skills, "guide", "added.txt")).text()).toBe("keep")
    expect((await Installer.inspect(record)).status).toBe("modified")
    expect((await Installer.inspect(record)).warnings.join(" ")).toContain("awaiting cleanup")
    expect(record.resources).toEqual(before)
  })
  test("MCP replacement checkpoints both versions and refuses changed entries", async () => {
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
  test("rollback removes new companions but never previously owned trees", async () => {
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
  test("rollback reports cleanup failures with the primary error and settles all resources", async () => {
    const archive = await new Bun.Archive({ "SKILL.md": "guide" }).bytes()
    using server = Bun.serve({ port: 0, fetch: () => new Response(archive) })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const original = new Error("config write failed")
    let intent: Installer.Written | undefined
    using failure = spyOn(MarketplaceMcp, "write").mockImplementation(async () => {
      await Bun.write(path.join(skills, "new-a", "user.txt"), "user content")
      throw original
    })
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
  })
  test("adopts fingerprint-equal content without prior ownership but protects divergent content", async () => {
    let content = "guide"
    using server = Bun.serve({
      port: 0,
      fetch: async () => new Response(await new Bun.Archive({ "SKILL.md": content }).bytes()),
    })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "config.json")
    const entry = { ...mcpEntry, companions: [{ id: "guide", archive: server.url.href }] }
    const first = await Installer.install({ entry, skills, config })
    // Ownership is lost (a reset database): the same install adopts identical files and entry.
    const adopted = await Installer.install({ entry, skills, config })
    expect(adopted.resources).toEqual(first.resources)
    expect(await Installer.inspect({ id: "demo", ...adopted })).toEqual({ status: "ready", warnings: [] })
    await Installer.uninstall({ id: "demo", ...adopted })
    expect(await fs.readdir(skills)).toEqual([])
    expect((await Bun.file(config).json()).mcp.servers).toEqual({})
    // Divergent skill content without ownership remains protected and untouched.
    await Installer.install({ entry, skills, config })
    content = "newer"
    await expect(Installer.install({ entry, skills, config })).rejects.toMatchObject({ reason: "conflict" })
    expect(await Bun.file(path.join(skills, "guide", "SKILL.md")).text()).toBe("guide")
    // Divergent MCP entry without ownership remains protected and untouched.
    content = "guide"
    await Bun.write(config, '{"mcp":{"servers":{"demo":{"type":"local","command":["user-edited"]}}}}')
    await expect(Installer.install({ entry, skills, config })).rejects.toMatchObject({ reason: "conflict" })
    expect((await Bun.file(config).json()).mcp.servers.demo.command).toEqual(["user-edited"])
  })
  test("bounds streamed downloads, rejects oversized headers and wraps broken bodies", async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let pulls = 0
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulls++
              controller.enqueue(chunk)
            },
          }),
        ),
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
    // The consumer stops at the 32 MiB limit; `pulls` also counts producer read-ahead through the socket, which
    // varies with runner speed (36 to 40 locally, 90 once on CI). The exact cut-off is asserted without sockets
    // in "cancels bounded streams immediately". Here the point is that an endless stream is not read to the end.
    expect(pulls).toBeLessThan(400)
    const broken = createServer((request, response) => {
      if (request.url === "/header") {
        response.writeHead(200, { "content-length": String(33 * 1024 * 1024) })
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
      for (const route of ["header", "failure"])
        await expect(
          Installer.install({
            entry: skillEntry(`http://127.0.0.1:${address.port}/${route}`),
            skills: path.join(directory, "skills"),
            config: path.join(directory, "config.json"),
          }),
        ).rejects.toBeInstanceOf(Installer.FetchError)
    } finally {
      broken.closeAllConnections()
      if (broken.listening) await new Promise<void>((resolve) => broken.close(() => resolve()))
    }
    expect(await fs.readdir(directory)).toEqual([])
  })
  test("installs selected options and companions, rejects unowned duplicates, removes all owned resources", async () => {
    const archive = await new Bun.Archive(
      { "guide/SKILL.md": "---\nname: guide\ndescription: Guide\n---\n" },
      { compress: "gzip" },
    ).bytes()
    using server = Bun.serve({ port: 0, fetch: () => new Response(archive) })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "kilo2.json")
    const entry = {
      ...mcpEntry,
      item: {
        ...mcpEntry.item,
        parameters: [param("TOKEN")],
        options: [
          { name: "NPX", prerequisites: [], parameters: [] },
          { name: "Remote", prerequisites: [], parameters: [] },
        ],
      },
      payloads: ['{"command":"npx","env":{"TOKEN":"{{TOKEN}}"}}', '{"type":"sse","url":"https://x"}'],
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
    await expect(Installer.install({ entry, skills, config, params: { TOKEN: "t" } })).rejects.toMatchObject({
      reason: "conflict",
    })
    expect(await fs.readdir(skills)).toEqual(["guide"])
    await Installer.uninstall({ id: "demo", ...written })
    expect(await Bun.file(config).json()).toEqual({ mcp: { servers: {} } })
    expect(await fs.readdir(skills)).toEqual([])
  })
  test("reinstall returns obsolete ownership before cleanup and retains new resources", async () => {
    const archives = Object.fromEntries(
      await Promise.all(
        ["guide", "extra"].map(async (name) => [
          name,
          await new Bun.Archive(
            { [`${name}/SKILL.md`]: `---\nname: ${name}\ndescription: ${name}\n---\n` },
            { compress: "gzip" },
          ).bytes(),
        ]),
      ),
    )
    using server = Bun.serve({
      port: 0,
      fetch: (request) => new Response(archives[new URL(request.url).pathname.slice(1)]),
    })
    const directory = await tmp()
    const skills = path.join(directory, "skills")
    const first = path.join(directory, "first.json")
    const second = path.join(directory, "second.json")
    const companion = (id: string) => ({ id, archive: new URL(id, server.url).href })
    const written = await Installer.install({
      entry: { ...mcpEntry, companions: [companion("guide"), companion("extra")] },
      skills,
      config: first,
    })
    expect((await fs.readdir(skills)).toSorted()).toEqual(["extra", "guide"])
    const again = await Installer.install({
      entry: { ...mcpEntry, companions: [companion("guide")] },
      skills,
      config: second,
      previous: { id: "demo", ...written },
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
    expect((await Bun.file(second).json()).mcp.servers.demo).toEqual({ type: "local", command: ["node"] })
  })
  test("retains failed cleanup, reclaims fingerprinted pending resources, and retries removal", async () => {
    const directory = await tmp()
    const first = path.join(directory, "first.json")
    const second = path.join(directory, "second.json")
    const skills = path.join(directory, "skills")
    const entry = { ...mcpEntry, payloads: ['{"url":"https://new.example.com"}'] }
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
