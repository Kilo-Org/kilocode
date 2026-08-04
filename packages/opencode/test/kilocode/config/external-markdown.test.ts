import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { ExternalMarkdown } from "../../../src/kilocode/config/external-markdown"
import { tmpdir } from "../../fixture/fixture"

describe("external Markdown sources", () => {
  test("requires a global allow for the exact canonical directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const source = path.join(dir, "project", ".kilo", "agents")
        const root = path.join(dir, "shared", "agents")
        await Bun.write(path.join(root, "shared.md"), "prompt")
        await fs.mkdir(path.dirname(source), { recursive: true })
        await fs.symlink(root, source, process.platform === "win32" ? "junction" : "dir")
        return { dir: path.dirname(source), root }
      },
    })
    const exact = path.join(tmp.extra.root, "*")
    const input = {
      dir: tmp.extra.dir,
      names: ["agents"],
      permission: { markdown_source: { [exact]: "allow" as const } },
      origins: { markdown_source: { [exact]: "global" as const } },
    }

    expect(ExternalMarkdown.scopes(input)).toEqual([
      { root: tmp.extra.root, source: path.join(tmp.extra.dir, "agents") },
    ])
    expect(ExternalMarkdown.scopes({ ...input, origins: { markdown_source: { [exact]: "local" } } })).toEqual([])

    const parent = path.join(path.dirname(tmp.extra.root), "*")
    expect(
      ExternalMarkdown.scopes({
        ...input,
        permission: { markdown_source: { [parent]: "allow" } },
        origins: { markdown_source: { [parent]: "global" } },
      }),
    ).toEqual([])

    const prefix = `${tmp.extra.root}*`
    expect(
      ExternalMarkdown.scopes({
        ...input,
        permission: { markdown_source: { [prefix]: "allow" } },
        origins: { markdown_source: { [prefix]: "global" } },
      }),
    ).toEqual([])
  })
})
