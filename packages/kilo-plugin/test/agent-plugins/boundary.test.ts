import { expect, test } from "bun:test"
import path from "node:path"

// The spec loader stays independent of OpenCode: only the adapter (index.ts) maps its values into skills and MCP
// servers. Keeping the loader on Node and Bun APIs lets another consumer, such as the marketplace installer, reuse it.
test("the Agent Plugins loader has no OpenCode imports", async () => {
  const root = path.join(import.meta.dir, "../../src/agent-plugins")
  const files = (await Array.fromAsync(new Bun.Glob("*.ts").scan({ cwd: root }))).filter((file) => file !== "index.ts")
  expect(files.toSorted()).toEqual([
    "diagnostic.ts",
    "extension.ts",
    "manifest.ts",
    "mcp.ts",
    "paths.ts",
    "plugin.ts",
    "skills.ts",
    "version.ts",
  ])
  const offenders = await Promise.all(
    files.map(async (file) =>
      (await Bun.file(path.join(root, file)).text()).includes("@opencode") ? file : undefined,
    ),
  )
  expect(offenders.filter(Boolean)).toEqual([])
})
