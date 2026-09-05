import { expect, test } from "bun:test"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Document, Info } from "@opencode-ai/schema/config"
import { Effect } from "effect"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Skill } from "@opencode-ai/core/skill"
import { isTrustedSkill } from "../src/skill-shell"
import {
  BUDGET_MS,
  LIMIT_NOTE,
  MAX_COMMANDS,
  MAX_OUTPUT_BYTES,
  SKILL_SHELL_DISABLED,
  SKILL_SHELL_UNTRUSTED,
  render,
  truncate,
} from "../src/skill-shell-render"

test("skill shell renders live placeholders once and authorizes one bounded batch", async () => {
  const commands: string[] = []
  const batches: string[][] = []
  const output = await Effect.runPromise(
    render({
      content: [
        "before !`first`",
        "",
        "```md",
        "!`fenced`",
        "```",
        "",
        "inline `` !`inline` ``",
        "!`first` !`second`",
      ].join("\n"),
      trusted: true,
      disabled: false,
      authorize: (batch) => Effect.sync(() => batches.push([...batch])),
      run: (command) => Effect.sync(() => (commands.push(command), `out-${command}`)),
    }),
  )

  expect(batches).toEqual([["first", "second"]])
  expect(commands).toEqual(["first", "second"])
  expect(output).toContain("before out-first")
  expect(output).toContain("!`fenced`")
  expect(output).toContain("!`inline`")
  expect(output).toContain("out-second")
  expect(output).not.toContain("!`first`")
  expect(BUDGET_MS).toBe(300_000)
})

test("untrusted and disabled skills replace only live placeholders", async () => {
  const content = ["!`live`", "", "```", "!`fenced`", "```", "", "`` !`inline` ``"].join("\n")
  const untrusted = await Effect.runPromise(
    render({
      content,
      trusted: false,
      disabled: false,
      authorize: () => Effect.die("authorization must not run"),
      run: () => Effect.die("execution must not run"),
    }),
  )
  const disabled = await Effect.runPromise(
    render({
      content,
      trusted: true,
      disabled: true,
      authorize: () => Effect.die("authorization must not run"),
      run: () => Effect.die("execution must not run"),
    }),
  )

  expect(untrusted).toContain(SKILL_SHELL_UNTRUSTED)
  expect(untrusted).toContain("!`fenced`")
  expect(untrusted).toContain("!`inline`")
  expect(disabled).toContain(SKILL_SHELL_DISABLED)
  expect(disabled).toContain("!`fenced`")
  expect(disabled).toContain("!`inline`")
})

test("skill shell caps unique commands and marks uncapped placeholders", async () => {
  const content = Array.from({ length: MAX_COMMANDS + 2 }, (_, index) => "!`command-" + index + "`").join(" ")
  const commands: string[] = []
  const output = await Effect.runPromise(
    render({
      content,
      trusted: true,
      disabled: false,
      authorize: (batch) => Effect.sync(() => expect(batch).toHaveLength(MAX_COMMANDS)),
      run: (command) => Effect.sync(() => (commands.push(command), command)),
    }),
  )

  expect(commands).toHaveLength(MAX_COMMANDS)
  expect(output).toContain(LIMIT_NOTE)
  expect(output).toContain("command-31")
  expect(output).not.toContain("!`command-32`")
})

test("skill shell output truncation is byte bounded", () => {
  const value = "🙂".repeat(MAX_OUTPUT_BYTES)
  const output = truncate(value)
  expect(Buffer.byteLength(output)).toBeGreaterThan(MAX_OUTPUT_BYTES)
  expect(Buffer.byteLength(output.slice(0, output.indexOf("\n")))).toBeLessThanOrEqual(MAX_OUTPUT_BYTES)
  expect(output).toContain("[skill shell output truncated]")
})

test("profile absolute skill source is trusted while relative and URL sources are not", async () => {
  await using fixture = await trustFixture()
  const profile = new Document({
    type: "document",
    path: AbsolutePath.make(fixture.profile),
    info: new Info({ skills: [fixture.root] }),
  })
  const skill = fixture.skill()
  const trusted = await Effect.runPromise(
    isTrustedSkill({
      skill,
      entries: [profile],
      directory: fixture.project,
      projectRoot: fixture.project,
      profileFile: fixture.profile,
      home: fixture.home,
    }),
  )
  const relative = await Effect.runPromise(
    isTrustedSkill({
      skill,
      entries: [
        new Document({
          type: "document",
          path: AbsolutePath.make(fixture.profile),
          info: new Info({ skills: ["../external/skills"] }),
        }),
      ],
      directory: fixture.project,
      projectRoot: fixture.project,
      profileFile: fixture.profile,
      home: fixture.home,
    }),
  )
  const url = await Effect.runPromise(
    isTrustedSkill({
      skill,
      entries: [
        new Document({
          type: "document",
          path: AbsolutePath.make(fixture.profile),
          info: new Info({ skills: ["https://example.test/skill"] }),
        }),
      ],
      directory: fixture.project,
      projectRoot: fixture.project,
      profileFile: fixture.profile,
      home: fixture.home,
    }),
  )

  expect(trusted).toBe(true)
  expect(relative).toBe(false)
  expect(url).toBe(false)
})

test("project descendants, symlink escapes, and duplicate source declarations cannot mint trust", async () => {
  await using fixture = await trustFixture()
  const projectSkillRoot = path.join(fixture.project, "skills")
  await mkdir(projectSkillRoot, { recursive: true })
  const projectSkill = path.join(projectSkillRoot, "SKILL.md")
  await Bun.write(projectSkill, "---\nname: project\n---\nproject\n")
  const link = path.join(fixture.external, "project-link")
  await symlink(projectSkillRoot, link)

  const profile = new Document({
    type: "document",
    path: AbsolutePath.make(fixture.profile),
    info: new Info({ skills: [link] }),
  })
  const project = new Document({
    type: "document",
    path: AbsolutePath.make(path.join(fixture.project, "kilo.jsonc")),
    info: new Info({ skills: [fixture.root] }),
  })
  const projectDescendant = await Effect.runPromise(
    isTrustedSkill({
      skill: { id: Skill.ID.make("project"), location: AbsolutePath.make(projectSkill) },
      entries: [profile],
      directory: fixture.project,
      projectRoot: fixture.project,
      profileFile: fixture.profile,
      home: fixture.home,
    }),
  )
  const duplicate = await Effect.runPromise(
    isTrustedSkill({
      skill: fixture.skill(),
      entries: [profile, project],
      directory: fixture.project,
      projectRoot: fixture.project,
      profileFile: fixture.profile,
      home: fixture.home,
    }),
  )

  expect(projectDescendant).toBe(false)
  expect(duplicate).toBe(false)
})

test("explicit profile content can trust only absolute skill paths", async () => {
  await using fixture = await trustFixture()
  const trusted = await Effect.runPromise(
    isTrustedSkill({
      skill: fixture.skill(),
      entries: [],
      directory: fixture.project,
      projectRoot: fixture.project,
      profileFile: fixture.profile,
      home: fixture.home,
      profileContent: `{\n  "skills": [${JSON.stringify(fixture.root)}]\n}`,
    }),
  )
  const relative = await Effect.runPromise(
    isTrustedSkill({
      skill: fixture.skill(),
      entries: [],
      directory: fixture.project,
      projectRoot: fixture.project,
      profileFile: fixture.profile,
      home: fixture.home,
      profileContent: '{"skills":["../external/skills"]}',
    }),
  )

  expect(trusted).toBe(true)
  expect(relative).toBe(false)
})

test("the exact pathless host content document is not treated as an ambiguous source", async () => {
  await using fixture = await trustFixture()
  const content = `{\n  "skills": [${JSON.stringify(fixture.root)}]\n}`
  const result = await Effect.runPromise(
    isTrustedSkill({
      skill: fixture.skill(),
      entries: [new Document({ type: "document", info: new Info({ skills: [fixture.root] }) })],
      directory: fixture.project,
      projectRoot: fixture.project,
      profileFile: fixture.profile,
      home: fixture.home,
      profileContent: content,
    }),
  )

  expect(result).toBe(true)
})

async function trustFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo-skill-shell-"))
  const fixture = {
    root,
    home: path.join(root, "home"),
    project: path.join(root, "project"),
    external: path.join(root, "external"),
    profile: path.join(root, "profile.jsonc"),
  }
  await Promise.all(
    [fixture.home, fixture.project, fixture.external].map((directory) => mkdir(directory, { recursive: true })),
  )
  fixture.root = path.join(fixture.external, "skills")
  await mkdir(fixture.root, { recursive: true })
  const skillFile = path.join(fixture.root, "SKILL.md")
  await Bun.write(skillFile, "---\nname: fixture\n---\nfixture\n")
  return {
    ...fixture,
    skill: () => ({ id: Skill.ID.make("fixture"), location: AbsolutePath.make(skillFile) }),
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}
