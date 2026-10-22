import { describe, test, expect } from "bun:test"
import path from "path"

import {
  generateNormalizedAbsolutePath,
  generateRelativeFilePath,
  generateRelativeIgnorePath,
} from "../../../../src/indexing/shared/get-relative-path"

describe("get-relative-path", () => {
  describe("generateNormalizedAbsolutePath", () => {
    test("should use provided workspace root", () => {
      const filePath = "src/file.ts"
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const result = generateNormalizedAbsolutePath(filePath, workspaceRoot)
      // On Windows, path.resolve adds the drive letter, so we need to use path.resolve for the expected value
      expect(result).toBe(path.resolve(workspaceRoot, filePath))
    })

    test("should handle absolute paths", () => {
      const filePath = path.join(path.sep, "absolute", "path", "file.ts")
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const result = generateNormalizedAbsolutePath(filePath, workspaceRoot)
      // When an absolute path is provided, it should be resolved to include drive letter on Windows
      expect(result).toBe(path.resolve(filePath))
    })

    test("should normalize paths with . and .. segments", () => {
      const filePath = "./src/../src/file.ts"
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const result = generateNormalizedAbsolutePath(filePath, workspaceRoot)
      // Use path.resolve to get the expected normalized absolute path
      expect(result).toBe(path.resolve(workspaceRoot, "src", "file.ts"))
    })
  })

  describe("generateRelativeFilePath", () => {
    test("should use provided workspace root", () => {
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const absolutePath = path.join(workspaceRoot, "src", "file.ts")
      const result = generateRelativeFilePath(absolutePath, workspaceRoot)
      expect(result).toBe(path.join("src", "file.ts"))
    })

    test("should handle paths outside workspace", () => {
      const absolutePath = path.join(path.sep, "outside", "workspace", "file.ts")
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const result = generateRelativeFilePath(absolutePath, workspaceRoot)
      // The result will have .. segments to navigate outside
      expect(result).toContain("..")
    })

    test("should handle same path as workspace", () => {
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const absolutePath = workspaceRoot
      const result = generateRelativeFilePath(absolutePath, workspaceRoot)
      expect(result).toBe(".")
    })

    test("should handle multi-workspace scenarios", () => {
      // Simulate the error scenario from the issue
      const workspaceRoot = path.join(path.sep, "Users", "test", "project")
      const absolutePath = path.join(path.sep, "Users", "test", "admin", ".prettierrc.json")
      const result = generateRelativeFilePath(absolutePath, workspaceRoot)
      // Should generate a valid relative path, not throw an error
      expect(result).toBe(path.join("..", "admin", ".prettierrc.json"))
    })
  })

  describe("generateRelativeIgnorePath", () => {
    test("should return relative path for files inside workspace", () => {
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const absolutePath = path.join(workspaceRoot, "src", "file.ts")
      const result = generateRelativeIgnorePath(absolutePath, workspaceRoot)
      expect(result).toBe(path.join("src", "file.ts"))
    })

    test("should return undefined for workspace root path", () => {
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const result = generateRelativeIgnorePath(workspaceRoot, workspaceRoot)
      expect(result).toBeUndefined()
    })

    test("should return undefined for paths outside workspace", () => {
      const absolutePath = path.join(path.sep, "outside", "workspace", "file.ts")
      const workspaceRoot = path.join(path.sep, "custom", "workspace")
      const result = generateRelativeIgnorePath(absolutePath, workspaceRoot)
      expect(result).toBeUndefined()
    })
  })
})
