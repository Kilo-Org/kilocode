import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Skills } from "../src"
import { codes, load, mcp, skill, temp, write } from "./fixture"

// Spec §6 and §7.1: skills come from immediate children of skills/ and follow the Agent Skills specification.
describe("skill discovery", () => {
  test("each immediate child with SKILL.md is one skill, with its body and resolved path", async () => {
    const { loaded, root } = await load({
      "skills/summarize/SKILL.md": skill("summarize", "Summarize text.", "license: MIT\nmetadata:\n  author: me\n"),
      "skills/summarize/scripts/run.sh": "echo hi",
      "skills/deploy/SKILL.md": skill("deploy"),
    })
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.skills).toEqual([
      {
        name: "deploy",
        description: "The deploy skill.",
        path: path.join(root, "skills/deploy/SKILL.md"),
        body: "# deploy\n\nBody of deploy.\n",
      },
      {
        name: "summarize",
        description: "Summarize text.",
        path: path.join(root, "skills/summarize/SKILL.md"),
        body: "# summarize\n\nBody of summarize.\n",
        license: "MIT",
        metadata: { author: "me" },
      },
    ])
  })

  test("a missing skills directory is not an error", async () => {
    const { loaded } = await load()
    expect(loaded.skills).toEqual([])
    expect(loaded.diagnostics).toEqual([])
  })

  test("deeper SKILL.md files and loose files are not skills", async () => {
    const { loaded } = await load({
      "skills/group/nested/SKILL.md": skill("nested"),
      "skills/README.md": "# readme",
      "skills/notes/other.md": "x",
      "SKILL.md": skill("plugin"),
    })
    expect(loaded.skills).toEqual([])
    expect(loaded.diagnostics).toEqual([])
  })

  test("a file named skills makes skills invalid while MCP still loads", async () => {
    const { loaded } = await load({
      skills: "not a directory",
      "mcp.json": mcp({ remote: { type: "streamable-http", url: "https://example.com/mcp" } }),
    })
    expect(codes(loaded)).toEqual(["skills-invalid"])
    expect(loaded.servers.map((server) => server.name)).toEqual(["remote"])
  })

  test("skills linked outside the root make skills invalid", async () => {
    const outside = await temp()
    await write(outside, { "a/SKILL.md": skill("a") })
    const { loaded } = await load({ skills: { symlink: outside } })
    expect(codes(loaded)).toEqual(["skills-invalid"])
    expect(loaded.skills).toEqual([])
  })

  test("a skill linked outside the root is skipped, the others load", async () => {
    const outside = await temp()
    await write(outside, { "escape/SKILL.md": skill("escape"), "file/SKILL.md": skill("file") })
    const { loaded } = await load({
      "skills/escape": { symlink: path.join(outside, "escape") },
      "skills/file/SKILL.md": { symlink: path.join(outside, "file", "SKILL.md") },
      "skills/ok/SKILL.md": skill("ok"),
    })
    expect(codes(loaded)).toEqual(["skill-outside-root", "skill-outside-root"])
    expect(loaded.skills.map((item) => item.name)).toEqual(["ok"])
  })

  test("links that stay inside the root are followed", async () => {
    const { loaded, root } = await load({
      "skills/linked": { symlink: "../shared/linked" },
      "shared/linked/SKILL.md": skill("linked"),
    })
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.skills.map((item) => item.path)).toEqual([path.join(root, "shared/linked/SKILL.md")])
  })

  test("a SKILL.md that is a directory is not a skill", async () => {
    const { loaded } = await load({ "skills/a/SKILL.md/x": "x" })
    expect(loaded.skills).toEqual([])
    expect(loaded.diagnostics).toEqual([])
  })

  test("an invalid skill is skipped and reported, the others load", async () => {
    const { loaded } = await load({
      "skills/good/SKILL.md": skill("good"),
      "skills/mismatch/SKILL.md": skill("other"),
      "skills/nodesc/SKILL.md": "---\nname: nodesc\n---\nbody",
    })
    expect(loaded.skills.map((item) => item.name)).toEqual(["good"])
    expect(loaded.diagnostics.map((item) => [item.code, item.item])).toEqual([
      ["skill-invalid", "mismatch"],
      ["skill-invalid", "nodesc"],
    ])
  })
})

// The Agent Skills frontmatter rules (https://agentskills.io/specification).
describe("SKILL.md validation", () => {
  const parse = (frontmatter: string, directory = "demo") => Skills.parse(directory, `---\n${frontmatter}\n---\nbody`)

  test("a valid skill keeps its optional fields", () => {
    expect(
      parse(
        'name: demo\ndescription: Does things.\nlicense: Apache-2.0\ncompatibility: Requires git\nmetadata:\n  version: "1.0"\nallowed-tools: Bash(git:*) Read',
      ),
    ).toEqual({
      name: "demo",
      description: "Does things.",
      body: "body",
      license: "Apache-2.0",
      compatibility: "Requires git",
      metadata: { version: "1.0" },
      allowedTools: "Bash(git:*) Read",
    })
  })

  test("unknown frontmatter keys are ignored", () => {
    expect(parse("name: demo\ndescription: d\nmodel: x")).toMatchObject({ name: "demo" })
  })

  test.each([
    ["no frontmatter", "no frontmatter here"],
    ["unterminated frontmatter", "---\nname: demo\ndescription: d\n"],
  ])("%s is invalid", (_, content) => {
    expect(typeof Skills.parse("demo", content)).toBe("string")
  })

  test.each([
    ["invalid YAML", "name: demo\ndescription: [unclosed"],
    ["a YAML list", "- name: demo"],
    ["missing name", "description: d"],
    ["uppercase name", "name: Demo\ndescription: d"],
    ["leading hyphen", "name: -demo\ndescription: d"],
    ["double hyphen", "name: de--mo\ndescription: d"],
    ["underscore", "name: de_mo\ndescription: d"],
    ["missing description", "name: demo"],
    ["empty description", 'name: demo\ndescription: ""'],
    ["long description", `name: demo\ndescription: ${"x".repeat(1025)}`],
    ["empty compatibility", 'name: demo\ndescription: d\ncompatibility: ""'],
    ["long compatibility", `name: demo\ndescription: d\ncompatibility: ${"x".repeat(501)}`],
    ["non-string metadata value", "name: demo\ndescription: d\nmetadata:\n  version: 1"],
    ["non-string license", "name: demo\ndescription: d\nlicense: 3"],
    ["list allowed-tools", "name: demo\ndescription: d\nallowed-tools: [Read]"],
  ])("%s is invalid", (_, frontmatter) => {
    expect(typeof parse(frontmatter)).toBe("string")
  })

  test("the name must match the directory", () => {
    expect(parse("name: demo\ndescription: d", "other")).toContain("must match its directory name")
  })

  test.each(["a", "pdf-processing", "v2", "a".repeat(64), "données"])("name %p is valid", (name) => {
    expect(Skills.validName(name)).toBe(true)
  })

  test.each(["", "a".repeat(65), "PDF", "-a", "a-", "a--b", "a b", "a.b"])("name %p is invalid", (name) => {
    expect(Skills.validName(name)).toBe(false)
  })
})
