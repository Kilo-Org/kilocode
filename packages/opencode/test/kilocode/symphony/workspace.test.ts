import { describe, it, expect, afterEach } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { WorkspaceManager } from "@/devilcode/symphony/workspace/manager"
import { SymphonyConfig } from "@/devilcode/symphony/config/schema"
import type { TrackerIssue } from "@/devilcode/symphony/tracker/types"

function makeConfig(root: string) {
  return SymphonyConfig.parse({
    tracker: { kind: "linear", api_key: "test", project_slug: "TEST" },
    workspace: { root, cleanup: true },
  })
}

const mockIssue: TrackerIssue = {
  id: "id1",
  identifier: "TEST-1",
  title: "Fix bug",
  description: "desc",
  priority: 1,
  state: "Todo",
  branchName: "test-1",
  url: "https://linear.app",
  labels: [],
  blockedBy: [],
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
}

describe("WorkspaceManager", () => {
  describe("getPath", () => {
    it("sanitizes identifier by replacing non-alphanumeric chars with underscore", () => {
      const config = makeConfig("/tmp/symphony-test")
      const result = WorkspaceManager.getPath("FOO/BAR@123", config)
      expect(result).toContain("FOO_BAR_123")
      expect(result).not.toContain("/BAR@")
    })

    it("returns path under workspace root", () => {
      const config = makeConfig("/tmp/symphony-test")
      const result = WorkspaceManager.getPath("TEST-1", config)
      const resolved = path.resolve("/tmp/symphony-test")
      expect(path.resolve(result).startsWith(resolved)).toBe(true)
    })

    it("is deterministic — same input produces same path", () => {
      const config = makeConfig("/tmp/symphony-test")
      const a = WorkspaceManager.getPath("TEST-1", config)
      const b = WorkspaceManager.getPath("TEST-1", config)
      expect(a).toBe(b)
    })
  })

  describe("prepare and cleanup", () => {
    let tempRoot: string

    afterEach(async () => {
      if (tempRoot && fs.existsSync(tempRoot)) {
        await fs.promises.rm(tempRoot, { recursive: true, force: true })
      }
    })

    it("prepare creates directory if it doesn't exist", async () => {
      tempRoot = path.join(os.tmpdir(), `symphony-test-prepare-${Date.now()}`)
      const config = makeConfig(tempRoot)
      const result = await WorkspaceManager.prepare(mockIssue, config)

      expect(result.isNew).toBe(true)
      expect(fs.existsSync(result.path)).toBe(true)
    })

    it("cleanup removes directory when cleanup is enabled", async () => {
      tempRoot = path.join(os.tmpdir(), `symphony-test-cleanup-${Date.now()}`)
      const config = makeConfig(tempRoot)
      await WorkspaceManager.prepare(mockIssue, config)

      const workspacePath = WorkspaceManager.getPath(mockIssue.identifier, config)
      expect(fs.existsSync(workspacePath)).toBe(true)

      await WorkspaceManager.cleanup(mockIssue.identifier, config)
      expect(fs.existsSync(workspacePath)).toBe(false)
    })
  })

  describe("containment", () => {
    it("workspace path must be under root", () => {
      const config = makeConfig("/tmp/symphony-test")
      const result = WorkspaceManager.getPath("TEST-1", config)
      const root = path.resolve("/tmp/symphony-test")
      const resolved = path.resolve(result)
      expect(resolved.startsWith(root)).toBe(true)
    })
  })
})
