import path from "node:path"
import { expect, test } from "bun:test"
import { ConfigMarkdown } from "@/config/markdown"
import { ConfigVariable } from "@/config/variable"
import { KilocodeMarkdown } from "@/kilocode/config/markdown"
import { tmpdir } from "../../fixture/fixture"

test("preserves dollar-prefixed placeholders in project markdown", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const project = path.join(dir, "project")
      const item = path.join(project, ".agents", "skills", "example", "SKILL.md")
      const content = "Use `${env:SENTRY_ORG_SLUG}` and `${file:credentials}`."
      await Bun.write(item, `---\nname: example\ndescription: Example skill\n---\n\n${content}\n`)
      return { project, item, content }
    },
  })

  const parsed = await ConfigMarkdown.parse(tmp.extra.item, {
    trusted: false,
    fileScope: { root: tmp.extra.project, source: tmp.extra.item },
    sourceScope: { root: path.join(tmp.extra.project, ".agents"), source: tmp.extra.item },
  })

  expect(parsed.data.name).toBe("example")
  expect(parsed.content.trim()).toBe(tmp.extra.content)
})

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

test("keeps resolving dollar-prefixed placeholders in trusted markdown", async () => {
  const name = "KILO_MARKDOWN_TRUSTED_DOLLAR_TEST"
  const prior = process.env[name]
  process.env[name] = "environment secret"

  try {
    const env = await KilocodeMarkdown.substitute(`\${env:${name}}`, "/tmp/trusted.md", { trusted: true })
    expect(env).toBe("$environment secret")
  } finally {
    if (prior === undefined) delete process.env[name]
    else process.env[name] = prior
  }
})

test("still rejects dollar-prefixed env references in untrusted config", async () => {
  await expect(
    ConfigVariable.substitute({
      text: "model: ${env:MODEL}",
      type: "virtual",
      source: "kilo.json",
      dir: "/tmp",
      trusted: false,
    }),
  ).rejects.toMatchObject({
    data: { message: expect.stringContaining("environment references are not allowed") },
  })
})
