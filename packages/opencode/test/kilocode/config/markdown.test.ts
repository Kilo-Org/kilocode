import path from "node:path"
import { expect, test, describe } from "bun:test"
import { ConfigMarkdown } from "@/config/markdown"
import { FrontmatterError } from "@opencode-ai/core/v1/config/error"
import { KilocodeMarkdown } from "@/kilocode/config/markdown"
import { tmpdir } from "../../fixture/fixture"

test("confines project markdown substitutions while preserving trusted substitutions", async () => {
  const name = "KILO_MARKDOWN_SUBSTITUTE_TEST_SECRET"
  const prior = process.env[name]
  process.env[name] = "environment secret"

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const project = path.join(dir, "project")
        const item = path.join(project, ".kilo", "agents", "unsafe.md")
        const global = path.join(dir, "global", "agents", "trusted.md")
        const secret = path.join(dir, "secret.txt")
        const file = `{file:${secret}}`
        const env = `{env:${name}}`
        const text = [file, env].join("\n")
        await Bun.write(item, text)
        await Bun.write(global, text)
        await Bun.write(secret, "file secret")
        await Bun.write(path.join(project, "allowed.txt"), "project content")
        return { project, item, global, file, env, text }
      },
    })

    const file = await KilocodeMarkdown.substitute(tmp.extra.file, tmp.extra.item, {
      trusted: false,
      fileScope: { root: tmp.extra.project, source: tmp.extra.item },
    }).then(
      () => false,
      () => true,
    )
    expect(file).toBe(true)
    const env = await KilocodeMarkdown.substitute(tmp.extra.env, tmp.extra.item, {
      trusted: false,
      fileScope: { root: tmp.extra.project, source: tmp.extra.item },
    }).then(
      () => false,
      () => true,
    )
    expect(env).toBe(true)
    expect(
      await KilocodeMarkdown.substitute("{file:../../allowed.txt}", tmp.extra.item, {
        trusted: false,
        fileScope: { root: tmp.extra.project, source: tmp.extra.item },
      }),
    ).toBe("project content")

    const trusted = await KilocodeMarkdown.substitute(tmp.extra.text, tmp.extra.global, { trusted: true })
    expect(trusted).toContain("file secret")
    expect(trusted).toContain("environment secret")
  } finally {
    if (prior === undefined) delete process.env[name]
    else process.env[name] = prior
  }
})

describe("ConfigMarkdown frontmatter diagnostics", () => {
  test("reports the line and column of a missing space after a colon", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "agent.md")
    const text = "---\nmode: subagent\nmodel:codedesign/KAT-Coder-V2.5-Dev\ndescription: Workspace Discovery Agent.\n---\n"
    await Bun.write(file, text)

    const err = await ConfigMarkdown.parse(file, { trusted: true }).then(
      () => new Error("expected frontmatter parse to fail"),
      (e) => e,
    )

    expect(FrontmatterError.isInstance(err)).toBeTrue()
    expect(err.data.line).toBe(1)
    expect(err.data.column).toBe(5)
    expect(err.data.path).toBe(file)
  })
})
