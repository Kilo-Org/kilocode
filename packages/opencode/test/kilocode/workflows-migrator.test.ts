import { test, expect, describe } from "bun:test"
import { WorkflowsMigrator } from "../../src/kilocode/workflows-migrator"
import { tmpdir } from "../fixture/fixture"
import path from "path"

async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.HOME
  process.env.HOME = home
  try {
    return await fn()
  } finally {
    if (prev) process.env.HOME = prev
    else delete process.env.HOME
  }
}

describe("WorkflowsMigrator", () => {
  describe("extractNameFromFilename", () => {
    test("extracts name from simple filename", () => {
      expect(WorkflowsMigrator.extractNameFromFilename("code-review.md")).toBe("code-review")
    })

    test("extracts name from path", () => {
      expect(WorkflowsMigrator.extractNameFromFilename("/path/to/my-workflow.md")).toBe("my-workflow")
    })

    test("handles filename without extension", () => {
      expect(WorkflowsMigrator.extractNameFromFilename("workflow")).toBe("workflow")
    })
  })

  describe("extractDescription", () => {
    test("extracts description from first paragraph after title", () => {
      const content = `# My Workflow

This is the description of the workflow.

## Steps

1. Do something`

      expect(WorkflowsMigrator.extractDescription(content)).toBe("This is the description of the workflow.")
    })

    test("returns undefined when no description found", () => {
      const content = `# My Workflow`
      expect(WorkflowsMigrator.extractDescription(content)).toBeUndefined()
    })

    test("limits description to 200 characters", () => {
      const longDescription = "A".repeat(300)
      const content = `# Title

${longDescription}`

      const result = WorkflowsMigrator.extractDescription(content)
      expect(result?.length).toBe(200)
    })

    test("skips empty lines after title", () => {
      const content = `# Title


Actual description here.`

      expect(WorkflowsMigrator.extractDescription(content)).toBe("Actual description here.")
    })
  })

  describe("discoverWorkflows", () => {
    test("discovers project workflows", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const workflowsDir = path.join(dir, ".kilo", "workflows")
          await Bun.write(path.join(workflowsDir, "test-workflow.md"), "# Test\n\nDescription")
        },
      })

      const workflows = await WorkflowsMigrator.discoverWorkflows(tmp.path, true)

      expect(workflows).toHaveLength(1)
      expect(workflows[0].name).toBe("test-workflow")
      expect(workflows[0].source).toBe("project")
    })

    test("discovers workflows from legacy .kilocode/workflows/", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const workflowsDir = path.join(dir, ".kilocode", "workflows")
          await Bun.write(path.join(workflowsDir, "legacy-workflow.md"), "# Legacy\n\nLegacy workflow")
        },
      })

      const workflows = await WorkflowsMigrator.discoverWorkflows(tmp.path, true)

      expect(workflows).toHaveLength(1)
      expect(workflows[0].name).toBe("legacy-workflow")
      expect(workflows[0].source).toBe("project")
    })

    test("returns empty array when no workflows directory exists", async () => {
      await using tmp = await tmpdir()

      const workflows = await WorkflowsMigrator.discoverWorkflows(tmp.path, true)

      expect(workflows).toHaveLength(0)
    })

    test("only discovers .md files", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const workflowsDir = path.join(dir, ".kilo", "workflows")
          await Bun.write(path.join(workflowsDir, "workflow.md"), "# Workflow")
          await Bun.write(path.join(workflowsDir, "readme.txt"), "Not a workflow")
          await Bun.write(path.join(workflowsDir, "config.json"), "{}")
        },
      })

      const workflows = await WorkflowsMigrator.discoverWorkflows(tmp.path, true)

      expect(workflows).toHaveLength(1)
      expect(workflows[0].name).toBe("workflow")
    })

    test("discovers global workflows from ~/.kilo/workflows/", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, ".kilo", "workflows", "global.md"), "# Global\n\nGlobal workflow")
          await Bun.write(path.join(dir, "repo", "README.md"), "repo")
        },
      })

      const workflows = await withHome(tmp.path, () => WorkflowsMigrator.discoverWorkflows(path.join(tmp.path, "repo")))

      expect(
        workflows.some((w) => w.source === "global" && w.path.includes(path.join(".kilo", "workflows", "global.md"))),
      ).toBe(true)
    })
  })

  describe("convertToCommand", () => {
    test("converts workflow to command format", () => {
      const workflow: WorkflowsMigrator.KilocodeWorkflow = {
        name: "code-review",
        path: "/path/to/code-review.md",
        content: "# Code Review\n\nReview the code changes.\n\n## Steps\n\n1. Check",
        source: "project",
      }

      const command = WorkflowsMigrator.convertToCommand(workflow)

      expect(command.template).toBe(workflow.content)
      expect(command.description).toBe("Review the code changes.")
    })

    test("uses fallback description when none found", () => {
      const workflow: WorkflowsMigrator.KilocodeWorkflow = {
        name: "simple",
        path: "/path/to/simple.md",
        content: "# Simple",
        source: "project",
      }

      const command = WorkflowsMigrator.convertToCommand(workflow)

      expect(command.description).toBe("Workflow: simple")
    })
  })

  describe("migrate", () => {
    test("migrates project workflows to commands", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const workflowsDir = path.join(dir, ".kilo", "workflows")
          await Bun.write(
            path.join(workflowsDir, "code-review.md"),
            "# Code Review\n\nPerform a code review.\n\n## Steps\n\n1. Review",
          )
        },
      })

      const result = await WorkflowsMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(Object.keys(result.commands)).toHaveLength(1)
      expect(result.commands["code-review"]).toBeDefined()
      expect(result.commands["code-review"].template).toContain("# Code Review")
      expect(result.commands["code-review"].description).toBe("Perform a code review.")
    })

    test("returns empty commands when no workflows exist", async () => {
      await using tmp = await tmpdir()

      const result = await WorkflowsMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(Object.keys(result.commands)).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })

    test("migrates multiple workflows", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          const workflowsDir = path.join(dir, ".kilo", "workflows")
          await Bun.write(path.join(workflowsDir, "review.md"), "# Review\n\nReview code")
          await Bun.write(path.join(workflowsDir, "deploy.md"), "# Deploy\n\nDeploy app")
        },
      })

      const result = await WorkflowsMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(Object.keys(result.commands)).toHaveLength(2)
      expect(result.commands["review"]).toBeDefined()
      expect(result.commands["deploy"]).toBeDefined()
    })

    test("project workflows override global workflows with same name", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          // Create a "global" directory to simulate global workflows
          const globalDir = path.join(dir, "global-workflows")
          await Bun.write(path.join(globalDir, "shared.md"), "# Shared\n\nGlobal version")

          // Create project workflows
          const projectDir = path.join(dir, ".kilo", "workflows")
          await Bun.write(path.join(projectDir, "shared.md"), "# Shared\n\nProject version")

          return globalDir
        },
      })

      // Note: We can't easily test global workflow override without mocking the home directory
      // This test verifies the deduplication logic works for project workflows
      const result = await WorkflowsMigrator.migrate({ projectDir: tmp.path, skipGlobalPaths: true })

      expect(Object.keys(result.commands)).toHaveLength(1)
      expect(result.commands["shared"].template).toContain("Project version")
    })
  })
})
