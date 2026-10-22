import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CommandFiles } from "../../src/kilocode/command-files"
import type { Command } from "../../src/command"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })))
  roots.length = 0
})

async function temp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-command-files-"))
  roots.push(dir)
  return dir
}

function cmd(input: Partial<Command.Info> & Pick<Command.Info, "name">): Command.Info {
  return {
    name: input.name,
    description: input.description,
    agent: input.agent,
    model: input.model,
    variant: input.variant,
    source: input.source,
    template: input.template ?? "body",
    subtask: input.subtask,
    hints: input.hints ?? [],
  }
}

describe("CommandFiles", () => {
  test("discovers editable command files and read-only builtins", async () => {
    const dir = await temp()
    const file = path.join(dir, ".kilo", "command", "review.md")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "---\ndescription: Review code\n---\n\nReview $ARGUMENTS")

    const items = await CommandFiles.discover({
      directory: dir,
      directories: [path.join(dir, ".kilo")],
      commands: [
        cmd({
          name: "review",
          source: "command",
          agent: "reviewer",
          model: "anthropic/claude-sonnet-4-6",
          variant: "high",
          subtask: true,
          hints: ["$ARGUMENTS"],
        }),
        cmd({ name: "init", source: "command" }),
      ],
    })

    expect(items.map((item) => item.name)).toEqual(["review", "init"])
    expect(items[0]).toMatchObject({
      name: "review",
      editable: true,
      builtin: false,
      location: file,
      agent: "reviewer",
      model: "anthropic/claude-sonnet-4-6",
      variant: "high",
      subtask: true,
    })
    expect(items[0].content).toContain("Review $ARGUMENTS")
    expect(items[1]).toMatchObject({ name: "init", editable: false, builtin: true, location: "builtin" })
  })

  test("maps legacy workflows to editable commands", async () => {
    const dir = await temp()
    const file = path.join(dir, ".kilo", "workflows", "ship.md")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "# Ship\n\nRun release checks")

    const items = await CommandFiles.discover({
      directory: dir,
      directories: [path.join(dir, ".kilo")],
      commands: [cmd({ name: "ship", source: "command", description: "Workflow: ship" })],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: "ship", editable: true, builtin: false, location: file })
    expect(items[0].content).toBe("# Ship\n\nRun release checks")
  })

  test("prefers command file attribution over same-named legacy workflow", async () => {
    const dir = await temp()
    const workflow = path.join(dir, ".kilo", "workflows", "ship.md")
    const file = path.join(dir, ".kilo", "command", "ship.md")
    await mkdir(path.dirname(workflow), { recursive: true })
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(workflow, "# Legacy Ship")
    await writeFile(file, "# Command Ship")

    const items = await CommandFiles.discover({
      directory: dir,
      directories: [path.join(dir, ".kilo")],
      commands: [cmd({ name: "ship", source: "command" })],
    })

    expect(items[0]).toMatchObject({ name: "ship", editable: true, builtin: false, location: file })
    expect(items[0].content).toBe("# Command Ship")
  })

  test("discovers symlinked command files", async () => {
    const dir = await temp()
    const real = path.join(dir, "linked", "review.md")
    const link = path.join(dir, ".kilo", "command", "review.md")
    await mkdir(path.dirname(real), { recursive: true })
    await mkdir(path.dirname(link), { recursive: true })
    await writeFile(real, "Review from symlink")
    await symlink(real, link)

    const items = await CommandFiles.discover({
      directory: dir,
      directories: [path.join(dir, ".kilo")],
      commands: [cmd({ name: "review", source: "command" })],
    })

    expect(items[0]).toMatchObject({ name: "review", editable: true, builtin: false, location: link })
    expect(items[0].content).toBe("Review from symlink")
  })

  test("remove only accepts known editable markdown files", async () => {
    const dir = await temp()
    const file = path.join(dir, ".kilo", "command", "ok.md")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "OK")
    const entries = [
      { name: "ok", location: file, editable: true, builtin: false, hints: [] },
      { name: "init", location: "builtin", editable: false, builtin: true, hints: [] },
    ]

    await expect(CommandFiles.remove("builtin", entries)).rejects.toThrow("absolute")
    await expect(CommandFiles.remove(path.join(dir, "other.md"), entries)).rejects.toThrow("not found")
    await CommandFiles.remove(file, entries)
    await expect(CommandFiles.remove(file, entries)).rejects.toThrow()
  })
})
