// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { parse as parseJsonc } from "jsonc-parser"
import { RemoveError, remove } from "../../src/kilocode/agent"
import type { Info as AgentInfo } from "../../src/agent/agent"
import { tmpdir } from "../fixture/fixture"

describe("Kilo agent remove", () => {
  test("removes config-backed imported agents", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, ".kilo")
    const file = path.join(dir, "kilo.jsonc")
    await mkdir(dir, { recursive: true })
    await Bun.write(file, `{
  // imported agent
  "default_agent": "reviewer",
  "agent": {
    "reviewer": {
      "description": "Reviews code"
    },
    "code": {
      "model": "kilo/gpt-5"
    }
  }
}`)

    await remove({
      name: "reviewer",
      agent: { name: "reviewer", native: false, options: {} } as AgentInfo,
      dirs: [dir],
      directory: tmp.path,
    })

    const cfg = parseJsonc(await Bun.file(file).text())
    expect(cfg.default_agent).toBeUndefined()
    expect(cfg.agent.reviewer).toBeUndefined()
    expect(cfg.agent.code.model).toBe("kilo/gpt-5")
  })

  test("removes duplicate agents from every editable config source", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, ".kilo")
    const files = [path.join(dir, "kilo.jsonc"), path.join(dir, "opencode.jsonc")]
    await mkdir(dir, { recursive: true })
    for (const file of files) {
      await Bun.write(
        file,
        JSON.stringify({
          default_agent: "reviewer",
          agent: {
            reviewer: { description: path.basename(file) },
            keep: { description: "Keep this agent" },
          },
        }),
      )
    }

    await remove({
      name: "reviewer",
      agent: { name: "reviewer", native: false, options: {} } as AgentInfo,
      dirs: [dir],
      directory: tmp.path,
    })

    for (const file of files) {
      const cfg = parseJsonc(await Bun.file(file).text())
      expect(cfg.default_agent).toBeUndefined()
      expect(cfg.agent.reviewer).toBeUndefined()
      expect(cfg.agent.keep.description).toBe("Keep this agent")
    }
  })

  test("preserves organization-managed agents", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, ".kilo", "agents")
    const file = path.join(dir, "reviewer.md")
    await mkdir(dir, { recursive: true })
    await Bun.write(file, "---\ndescription: Reviews code\n---\n\nReview code.\n")

    const err = await remove({
      name: "reviewer",
      agent: { name: "reviewer", native: false, source: "organization", options: {} } as AgentInfo,
      dirs: [path.dirname(dir)],
      directory: tmp.path,
    }).then(
      () => undefined,
      (err) => err,
    )
    expect(RemoveError.isInstance(err)).toBe(true)
    expect(await Bun.file(file).exists()).toBe(true)
  })
})
