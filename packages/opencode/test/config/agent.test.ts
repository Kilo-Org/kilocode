// kilocode_change - new file
import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, rmdir, mkdir } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { ConfigAgent } from "@/config/agent"

describe("ConfigAgent: frontmatter warnings", () => {
  let dir = ""

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "kilo-agent-test-"))
  })

  afterEach(async () => {
    await rmdir(dir, { recursive: true })
  })

  test("invalid YAML frontmatter in agent file produces a warning and returns no agent", async () => {
    const agentDir = path.join(dir, "agent")
    await mkdir(agentDir, { recursive: true })
    await writeFile(
      path.join(agentDir, "broken.md"),
      `---
name: broken
model: openai/gpt-4o
permission:
  read: [allow
---
Prompt content.
`,
    )

    const warnings: ConfigAgent.Warning[] = []
    const result = await ConfigAgent.load(dir, warnings)

    expect(Object.keys(result)).toHaveLength(0)
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    const warning = warnings.find((w) => w.path.includes("broken.md"))
    expect(warning).toBeDefined()
    expect(warning!.message).toContain("Failed to parse YAML frontmatter")
    expect(warning!.detail).toContain("broken.md")
  })

  test("duplicate key YAML frontmatter reports the failing file", async () => {
    const agentDir = path.join(dir, "agents")
    await mkdir(agentDir, { recursive: true })
    await writeFile(
      path.join(agentDir, "dupe.md"),
      `---
name: dupe
permission:
  read: allow
  read: deny
---
Prompt content.
`,
    )

    const warnings: ConfigAgent.Warning[] = []
    const result = await ConfigAgent.load(dir, warnings)

    expect(Object.keys(result)).toHaveLength(0)
    const warning = warnings.find((w) => w.path.includes("dupe.md"))
    expect(warning).toBeDefined()
    expect(warning!.path).toContain("dupe.md")
    expect(warning!.message.match(/line 5/g)).toHaveLength(1)
    expect(warning!.message).not.toContain("read: deny")
  })
})
