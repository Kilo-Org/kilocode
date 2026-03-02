import { describe, expect, it } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  discoverRuleFiles,
  discoverWorkflowFiles,
  extractWorkflowDescription,
} from "../../src/services/kilocode-files"

async function tempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

describe("extractWorkflowDescription", () => {
  it("returns first non-empty line after heading", () => {
    const text = "# Workflow\n\nThis runs checks.\n\nMore text."
    expect(extractWorkflowDescription(text)).toBe("This runs checks.")
  })

  it("returns undefined when there is no body", () => {
    expect(extractWorkflowDescription("# Workflow")).toBeUndefined()
  })
})

describe("discoverRuleFiles", () => {
  it("includes project, mode-specific, and legacy files", async () => {
    const workspace = await tempDir("kilo-rules-")
    await fs.mkdir(path.join(workspace, ".kilocode", "rules"), { recursive: true })
    await fs.mkdir(path.join(workspace, ".kilocode", "rules-code"), { recursive: true })
    await fs.writeFile(path.join(workspace, ".kilocode", "rules", "alpha.md"), "# Alpha")
    await fs.writeFile(path.join(workspace, ".kilocode", "rules", "ignore.txt"), "x")
    await fs.writeFile(path.join(workspace, ".kilocode", "rules-code", "beta.md"), "# Beta")
    await fs.writeFile(path.join(workspace, ".kilocoderules"), "# Legacy")

    const files = await discoverRuleFiles(workspace)

    const alpha = files.find((x) => x.path.endsWith(".kilocode/rules/alpha.md"))
    const beta = files.find((x) => x.path.endsWith(".kilocode/rules-code/beta.md"))
    const legacy = files.find((x) => x.path.endsWith(".kilocoderules"))

    expect(alpha?.source).toBe("project")
    expect(beta?.mode).toBe("code")
    expect(legacy?.source).toBe("legacy")
  })
})

describe("discoverWorkflowFiles", () => {
  it("includes project and vscode-global workflows and extracts descriptions", async () => {
    const id = Date.now().toString(36)
    const workspace = await tempDir("kilo-workflow-workspace-")
    const storage = await tempDir("kilo-workflow-storage-")
    await fs.mkdir(path.join(workspace, ".kilocode", "workflows"), { recursive: true })
    await fs.mkdir(path.join(storage, "workflows"), { recursive: true })

    const project = `project-${id}.md`
    const global = `global-${id}.md`
    await fs.writeFile(path.join(workspace, ".kilocode", "workflows", project), "# Project\n\nProject description")
    await fs.writeFile(path.join(storage, "workflows", global), "# Global\n\nGlobal description")

    const files = await discoverWorkflowFiles({ workspace, globalStorage: storage })

    const projectItem = files.find((x) => x.name === `project-${id}`)
    const globalItem = files.find((x) => x.name === `global-${id}`)

    expect(projectItem?.source).toBe("project")
    expect(projectItem?.description).toBe("Project description")
    expect(globalItem?.source).toBe("global")
    expect(globalItem?.description).toBe("Global description")
  })
})
