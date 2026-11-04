import { describe, expect, test } from "bun:test"
import { ConfigAgent } from "@opencode/schema/config/agent"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import { Installer } from "../src/marketplace/installer"
import {
  Agent,
  AgentError,
  fingerprint,
  prepare,
  preflight,
  remove,
  render,
  target,
  write,
} from "../src/marketplace/agent"
import { KiloMarketplaceRegistry } from "../src/marketplace/kilo"
import type { Entry } from "../src/marketplace/registry"

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "kilo-marketplace-agent-"))
const content = (overrides: Partial<Parameters<typeof render>[0]> = {}) => ({
  mode: "subagent" as const,
  description: "Review changes",
  system: "You review code.",
  ...overrides,
})
const decodeAgent = Schema.decodeUnknownOption(ConfigAgent.Info)

// The agent document is only useful if the config agent plugin's loader accepts it unchanged.
function decode(document: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(document)
  if (!match) throw new Error("agent document has no frontmatter")
  return decodeAgent({ ...(Bun.YAML.parse(match[1]) as object), system: document.slice(match[0].length).trim() })
}

const agentEntry = (overrides: { id?: string; agent?: Entry["item"]["agent"] } = {}): Entry => ({
  item: {
    registry: "kilo",
    kind: "agent",
    id: overrides.id ?? "reviewer",
    name: "Reviewer",
    description: "Reviews changes",
    tags: [],
    prerequisites: [],
    parameters: [],
    options: [],
    agent: overrides.agent ?? content(),
  },
  payloads: [],
})

describe("agent documents", () => {
  test("render writes frontmatter the agent loader decodes without falling back to legacy migration", () => {
    const document = render(
      content({
        mode: "primary",
        color: "#abcdef",
        steps: 3,
        hidden: true,
        model: { providerID: "kilo", model: "fast", variant: "high" } as never,
        permissions: [{ action: "edit", resource: "**", effect: "deny" }],
      }),
    )
    const parsed = decode(document)
    expect(Option.isSome(parsed)).toBe(true)
    expect(Option.getOrThrow(parsed)).toMatchObject({
      mode: "primary",
      description: "Review changes",
      system: "You review code.",
      color: "#abcdef",
      steps: 3,
      hidden: true,
      model: { providerID: "kilo", model: "fast", variant: "high" },
      permissions: [{ action: "edit", resource: "**", effect: "deny" }],
    })
  })

  test("a multi-line prompt survives the round trip as the body", () => {
    const parsed = decode(render(content({ system: "Line one.\n\n- item: value\n\nLast." })))
    expect(Option.getOrThrow(parsed).system).toBe("Line one.\n\n- item: value\n\nLast.")
  })

  test("an agent id names the document and unsafe ids are refused", async () => {
    const root = await tmp()
    expect(target(root, "reviewer")).toBe(path.join(root, "reviewer.md"))
    for (const id of ["../escape", "a/b", "con", "trailing.", "", ".."])
      expect(() => target(root, id)).toThrow(AgentError)
  })

  test("write refuses an unowned or modified document and replaces owned content atomically", async () => {
    const root = await tmp()
    const first = await prepare({ root, id: "reviewer", content: content() })
    await write(first)
    expect(await fs.readFile(first.target, "utf8")).toBe(render(content()))
    expect(await fingerprint(first.target)).toBe(first.fingerprint)

    const second = await prepare({ root, id: "reviewer", content: content({ system: "Updated." }) })
    await expect(write(second)).rejects.toMatchObject({ reason: "conflict" })
    await write(second, [first.fingerprint])
    expect(await fs.readFile(second.target, "utf8")).toBe(render(content({ system: "Updated." })))
    expect(await fs.readdir(root)).toEqual(["reviewer.md"])
  })

  test("a foreign document is never adopted, a symlink is refused, and removal refuses unowned content", async () => {
    const root = await tmp()
    const file = target(root, "reviewer")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(file, "hand written")
    await expect(preflight(file)).rejects.toMatchObject({ reason: "conflict" })
    await expect(remove(file)).rejects.toMatchObject({ reason: "conflict" })
    expect(await fs.readFile(file, "utf8")).toBe("hand written")

    const other = await tmp()
    await fs.writeFile(path.join(other, "real.md"), "content")
    await fs.symlink(path.join(other, "real.md"), target(other, "linked"))
    await expect(fingerprint(target(other, "linked"))).rejects.toMatchObject({ reason: "conflict" })
  })

  test("removal keeps no staging or trash behind and restores a missing directory cleanly", async () => {
    const directory = await tmp()
    const root = path.join(directory, "agents")
    const prepared = await prepare({ root, id: "reviewer", content: content() })
    await write(prepared)
    await remove(prepared.target, [prepared.fingerprint])
    expect(await fs.readdir(root).catch(() => [])).toEqual([])
    expect(await fs.readdir(path.join(directory, ".marketplace-trash"))).toEqual([])
    // Idempotent: removing an absent document is not an error.
    await remove(prepared.target, [prepared.fingerprint])
  })
})

describe("agent catalog entries", () => {
  test("a native object and a hand-written frontmatter document normalize to the same content", () => {
    const [native] = KiloMarketplaceRegistry.parse(
      "agent",
      Bun.YAML.stringify({
        items: [{ id: "reviewer", name: "Reviewer", content: { mode: "subagent", description: "Review", prompt: "Body" } }],
      }),
    )
    const [document] = KiloMarketplaceRegistry.parse(
      "agent",
      Bun.YAML.stringify({
        items: [{ id: "reviewer", content: "mode: subagent\ndescription: Review\nprompt: Body\n" }],
      }),
    )
    expect(native.item.agent).toEqual({ mode: "subagent", description: "Review", system: "Body" })
    expect(document.item.agent).toEqual(native.item.agent)
    expect(native.archive).toBeUndefined()
    expect(native.payloads).toEqual([])
  })

  test("fields the loader does not understand are dropped, not written", () => {
    const [entry] = KiloMarketplaceRegistry.parse(
      "agent",
      Bun.YAML.stringify({
        items: [
          {
            id: "reviewer",
            content: { mode: "subagent", prompt: "Body", options: { temperature: 1 }, requirements: { skills: ["x"] } },
          },
        ],
      }),
    )
    expect(entry.item.agent).toEqual({ mode: "subagent", system: "Body" })
    expect(render(entry.item.agent!)).not.toContain("options")
  })

  test("an undecodable agent is skipped instead of installed half-formed", () => {
    const entries = KiloMarketplaceRegistry.parse(
      "agent",
      Bun.YAML.stringify({
        items: [
          { id: "broken", content: { mode: "unsupported" } },
          { id: "missing", content: undefined },
          { id: "ok", content: { system: "Body" } },
        ],
      }),
    )
    expect(entries.map((entry) => entry.item.id)).toEqual(["ok"])
  })

  test("malformed agent content skips only that entry", () => {
    const entries = KiloMarketplaceRegistry.parse(
      "agent",
      Bun.YAML.stringify({
        items: [
          { id: "broken", content: "mode: [unclosed" },
          { id: "ok", content: { system: "Body" } },
        ],
      }),
    )
    expect(entries.map((entry) => entry.item.id)).toEqual(["ok"])
  })
})

describe("agent installation", () => {
  test("install writes one owned document; reinstall updates it; uninstall removes it", async () => {
    const directory = await tmp()
    const agents = path.join(directory, "agents")
    const config = path.join(directory, "kilo2.json")
    const skills = path.join(directory, "skills")
    const first = await Installer.install({ entry: agentEntry(), skills, agents, config })
    expect(first.agents).toEqual(["reviewer"])
    expect(first.config).toBeUndefined()
    expect(first.paths).toEqual([])
    const file = path.join(agents, "reviewer.md")
    expect(await fs.readFile(file, "utf8")).toBe(render(content()))

    const updated = await Installer.install({
      entry: agentEntry({ agent: content({ system: "Updated body." }) }),
      skills,
      agents,
      config,
      previous: { id: "reviewer", ...first },
    })
    expect(await fs.readFile(file, "utf8")).toBe(render(content({ system: "Updated body." })))
    expect(await Installer.inspect({ id: "reviewer", ...updated })).toMatchObject({ status: "ready" })

    await Installer.uninstall({ id: "reviewer", ...updated })
    expect(await fs.readdir(agents).catch(() => [])).toEqual([])
  })

  test("a locally edited document reports modified and refuses replacement or removal", async () => {
    const directory = await tmp()
    const agents = path.join(directory, "agents")
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "kilo2.json")
    const written = await Installer.install({ entry: agentEntry(), skills, agents, config })
    await fs.appendFile(path.join(agents, "reviewer.md"), "\nlocal edit")
    expect(await Installer.inspect({ id: "reviewer", ...written })).toMatchObject({ status: "modified" })
    await expect(Installer.uninstall({ id: "reviewer", ...written })).rejects.toThrow(/modified or not owned/)
    await expect(
      Installer.install({ entry: agentEntry(), skills, agents, config, previous: { id: "reviewer", ...written } }),
    ).rejects.toMatchObject({ reason: "conflict" })
    expect(await fs.readFile(path.join(agents, "reviewer.md"), "utf8")).toContain("local edit")
  })

  test("a failed write rolls back only the document it would have created", async () => {
    const directory = await tmp()
    const agents = path.join(directory, "agents")
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "kilo2.json")
    await expect(
      Installer.install({
        entry: agentEntry(),
        skills,
        agents,
        config,
        beforeWrite: async () => {
          throw new Error("checkpoint failed")
        },
      }),
    ).rejects.toThrow("checkpoint failed")
    expect(await fs.readdir(agents).catch(() => [])).toEqual([])
  })

  test("preview rejects agents because they have no interpolated configuration", async () => {
    expect(() => Installer.preview({ entry: agentEntry() })).toThrow(/configuration preview/)
  })

  test("a skill tree is never mistaken for an agent document and vice versa", async () => {
    const directory = await tmp()
    const agents = path.join(directory, "agents")
    const skills = path.join(directory, "skills")
    const config = path.join(directory, "kilo2.json")
    const written = await Installer.install({ entry: agentEntry(), skills, agents, config })
    const resource = written.resources![0]!
    expect(resource).toMatchObject({ agent: "reviewer", fingerprints: [expect.any(String)] })
    expect(Object.keys(resource).toSorted()).toEqual(["agent", "fingerprints", "path"])
    expect(written.paths).toEqual([])
  })
})
