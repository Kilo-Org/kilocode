import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Manifest } from "../../src/agent-plugins/manifest"
import { AgentPlugin } from "../../src/agent-plugins/plugin"
import { PLUGIN_SCHEMA, codes, load, mcp, skill, temp, write } from "./fixture"

// Spec §5.2-§5.5: the closed manifest, required fields and name constraints.
describe("plugin.json", () => {
  test("a minimal manifest loads", async () => {
    const { loaded } = await load()
    expect(loaded.status).toBe("loaded")
    expect(loaded.manifest).toEqual({ schema: PLUGIN_SCHEMA, spec: "1.0.0", name: "demo" })
    expect(loaded.diagnostics).toEqual([])
  })

  test("a full manifest keeps every specified field", () => {
    const manifest = {
      $schema: PLUGIN_SCHEMA,
      name: "plugin-name",
      version: "1.2.0",
      description: "Brief plugin description",
      author: { name: "Author Name", email: "author@example.com", url: "https://example.com" },
      homepage: "https://docs.example.com/plugin",
      repository: "https://github.com/example/plugin",
      license: "MIT",
      keywords: ["keyword1", "keyword2"],
      extensions: { "com.example.client": { setting: true } },
    }
    const result = Manifest.decode(manifest)
    expect(result).toEqual({
      type: "valid",
      manifest: {
        schema: PLUGIN_SCHEMA,
        spec: "1.0.0",
        name: "plugin-name",
        version: "1.2.0",
        description: "Brief plugin description",
        author: manifest.author,
        homepage: manifest.homepage,
        repository: manifest.repository,
        license: "MIT",
        keywords: manifest.keywords,
        extensions: manifest.extensions,
      },
      diagnostics: [],
    })
  })

  test.each([
    ["missing $schema", { name: "demo" }],
    ["non-string $schema", { $schema: 1, name: "demo" }],
    ["missing name", { $schema: PLUGIN_SCHEMA }],
    ["non-string name", { $schema: PLUGIN_SCHEMA, name: 7 }],
    ["empty name", { $schema: PLUGIN_SCHEMA, name: "" }],
    ["non-string version", { $schema: PLUGIN_SCHEMA, name: "demo", version: 1 }],
    ["non-string description", { $schema: PLUGIN_SCHEMA, name: "demo", description: null }],
    ["keywords with a number", { $schema: PLUGIN_SCHEMA, name: "demo", keywords: ["a", 1] }],
    ["author as a string", { $schema: PLUGIN_SCHEMA, name: "demo", author: "me" }],
    ["author with an extra field", { $schema: PLUGIN_SCHEMA, name: "demo", author: { name: "a", twitter: "b" } }],
    ["author with a non-string field", { $schema: PLUGIN_SCHEMA, name: "demo", author: { name: 1 } }],
  ])("%s rejects the plugin and discovers no components", async (_, manifest) => {
    const { loaded } = await load({
      "plugin.json": manifest,
      "skills/a/SKILL.md": skill("a"),
      "mcp.json": mcp({ s: { type: "stdio", command: "node" } }),
    })
    expect(loaded.status).toBe("rejected")
    expect(codes(loaded)).toEqual(["manifest-invalid"])
    expect(loaded.skills).toEqual([])
    expect(loaded.servers).toEqual([])
  })

  test("an unsupported version is rejected and named, without fetching the schema", async () => {
    const schema = "https://agent-plugins.org/schemas/9.0.0/plugin.schema.json"
    const { loaded } = await load({ "plugin.json": { $schema: schema, name: "demo" } })
    expect(loaded.status).toBe("rejected")
    expect(codes(loaded)).toEqual(["manifest-unsupported-version"])
    expect(loaded.diagnostics[0]?.message).toContain(schema)
  })

  test("unknown top-level fields are reported, dropped and do not stop loading", async () => {
    const { loaded } = await load({
      "plugin.json": { $schema: PLUGIN_SCHEMA, name: "demo", skills: "./other", mcpServers: {} },
      "skills/a/SKILL.md": skill("a"),
    })
    expect(loaded.status).toBe("loaded")
    expect(codes(loaded)).toEqual(["manifest-unknown-field", "manifest-unknown-field"])
    expect(loaded.manifest).not.toHaveProperty("skills")
    expect(loaded.skills.map((item) => item.name)).toEqual(["a"])
  })

  test("metadata is checked only by JSON type", () => {
    const result = Manifest.decode({
      $schema: PLUGIN_SCHEMA,
      name: "demo",
      version: "not semver",
      homepage: "not a url",
      repository: "also not",
      license: "Some custom license",
      author: { email: "not an email", url: "nope" },
    })
    expect(result.type).toBe("valid")
  })

  test.each(["my-plugin", "acme.tools", "lint3r", "a", "a".repeat(64), "a.b-c"])("name %p is valid", (name) => {
    expect(Manifest.validName(name)).toBe(true)
  })

  test.each([
    "My-Plugin",
    "-start",
    "end-",
    ".start",
    "has--double",
    "too.many..dots",
    "",
    "a".repeat(65),
    "a_b",
    "a b",
  ])("name %p is invalid", (name) => {
    expect(Manifest.validName(name)).toBe(false)
    expect(Manifest.decode({ $schema: PLUGIN_SCHEMA, name }).type).toBe("rejected")
  })
})

// Spec §8.1: client extension data.
describe("extensions", () => {
  test("a non-object extensions field is reported and ignored", async () => {
    const { loaded } = await load({
      "plugin.json": { $schema: PLUGIN_SCHEMA, name: "demo", extensions: ["x"] },
      "skills/a/SKILL.md": skill("a"),
    })
    expect(loaded.status).toBe("loaded")
    expect(codes(loaded)).toEqual(["manifest-invalid-extensions"])
    expect(loaded.manifest?.extensions).toBeUndefined()
    expect(loaded.skills).toHaveLength(1)
  })

  test("namespaces this client does not implement are kept unvalidated", () => {
    const extensions = { "com.example.client": "not an object", "org.other": { deep: [1, { x: null }] } }
    const result = Manifest.decode({ $schema: PLUGIN_SCHEMA, name: "demo", extensions })
    expect(result).toMatchObject({ type: "valid", manifest: { extensions }, diagnostics: [] })
  })
})

// Spec §4.1 and §11.1: the plugin root and the manifest location.
describe("plugin root", () => {
  test("a missing manifest rejects the directory", async () => {
    const root = await temp()
    const loaded = await AgentPlugin.load(root, { dataRoot: path.join(root, "data") })
    expect(loaded.status).toBe("rejected")
    expect(codes(loaded)).toEqual(["manifest-missing"])
  })

  test("a missing root is rejected", async () => {
    const root = path.join(await temp(), "nope")
    const loaded = await AgentPlugin.load(root, { dataRoot: root })
    expect(codes(loaded)).toEqual(["root-invalid"])
  })

  test("plugin.json that is a directory or invalid JSON is rejected", async () => {
    const dir = await temp()
    await mkdir(path.join(dir, "plugin.json"))
    expect(codes(await AgentPlugin.load(dir, { dataRoot: dir }))).toEqual(["manifest-invalid"])
    const { loaded } = await load({ "plugin.json": "{ nope" })
    expect(codes(loaded)).toEqual(["manifest-invalid"])
    const array = await load({ "plugin.json": [] })
    expect(codes(array.loaded)).toEqual(["manifest-invalid"])
  })

  test("plugin.json linked outside the root rejects the plugin", async () => {
    const outside = await temp()
    await write(outside, { "plugin.json": { $schema: PLUGIN_SCHEMA, name: "demo" } })
    const { loaded } = await load({ "plugin.json": { symlink: path.join(outside, "plugin.json") } })
    expect(loaded.status).toBe("rejected")
    expect(codes(loaded)).toEqual(["manifest-outside-root"])
  })

  test("plugin.json linked inside the root loads, and the root is reported resolved", async () => {
    const { loaded, root } = await load({
      "plugin.json": { symlink: "meta/manifest.json" },
      "meta/manifest.json": { $schema: PLUGIN_SCHEMA, name: "demo" },
    })
    expect(loaded.status).toBe("loaded")
    expect(loaded.root).toBe(root)
  })

  test("a symlinked root resolves to its target", async () => {
    const { root } = await load()
    const link = path.join(await temp(), "link")
    await write(path.dirname(link), { link: { symlink: root } })
    const loaded = await AgentPlugin.load(link, { dataRoot: path.join(root, "..", "data") })
    expect(loaded.root).toBe(root)
  })
})
