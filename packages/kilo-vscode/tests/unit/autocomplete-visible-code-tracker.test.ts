import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test"
import * as vscode from "vscode"

// Piggy-back on the shared vscode preload rather than replacing the module —
// mock.module("vscode") would leak into other test files' expectations.
spyOn(vscode.workspace, "asRelativePath").mockImplementation((p: string | vscode.Uri) => {
  const path = typeof p === "string" ? p : p.fsPath
  return path.replace(/^\/workspace\//, "")
})
;(vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = []
;(vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = null

mock.module("../../src/services/autocomplete/continuedev/core/indexing/ignore", () => ({
  isSecurityConcern: (filePath: string) => filePath.includes(".env") || filePath.includes("credentials"),
}))

const { VisibleCodeTracker } = await import("../../src/services/autocomplete/context/VisibleCodeTracker")
// Alias vi to Bun's mock so tests below keep reading naturally.
const vi = { fn: mock, clearAllMocks: () => mock.clearAllMocks() }

describe("VisibleCodeTracker", () => {
  const mockWorkspacePath = "/workspace"

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()
  })

  describe("captureVisibleCode", () => {
    it("should return empty context when no editors are visible", async () => {
      // Mock empty editor list
      ;(vscode.window.visibleTextEditors as any) = []
      ;(vscode.window.activeTextEditor as any) = null

      const tracker = new VisibleCodeTracker(mockWorkspacePath)
      const context = await tracker.captureVisibleCode()

      expect(context).toEqual({
        timestamp: expect.any(Number),
        editors: [],
      })
      expect(context.timestamp).toBeGreaterThan(0)
    })

    it("should capture visible editors with file scheme", async () => {
      const mockDocument = {
        uri: {
          fsPath: "/workspace/test.ts",
          scheme: "file",
          toString: () => "file:///workspace/test.ts",
        },
        languageId: "typescript",
        getText: vi.fn((range: any) => {
          if (range.start.line === 0 && range.end.line === 2) {
            return "line 0\nline 1\nline 2"
          }
          return ""
        }),
      }

      const mockEditor = {
        document: mockDocument,
        visibleRanges: [
          {
            start: { line: 0, character: 0 },
            end: { line: 2, character: 0 },
          },
        ],
        selection: {
          active: { line: 1, character: 5 },
        },
        selections: [
          {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 10 },
          },
        ],
      }

      ;(vscode.window.visibleTextEditors as any) = [mockEditor]
      ;(vscode.window.activeTextEditor as any) = mockEditor

      const tracker = new VisibleCodeTracker(mockWorkspacePath)
      const context = await tracker.captureVisibleCode()

      expect(context.editors).toHaveLength(1)
      expect(context.editors[0]).toMatchObject({
        filePath: "/workspace/test.ts",
        relativePath: "test.ts",
        languageId: "typescript",
        isActive: true,
        visibleRanges: [
          {
            startLine: 0,
            endLine: 2,
            content: "line 0\nline 1\nline 2",
          },
        ],
        cursorPosition: {
          line: 1,
          character: 5,
        },
      })
    })

    it("should extract diff info for git scheme URIs", async () => {
      const mockDocument = {
        uri: {
          fsPath: "/workspace/test.ts",
          scheme: "git",
          query: "ref=HEAD~1",
          toString: () => "git:///workspace/test.ts?ref=HEAD~1",
        },
        languageId: "typescript",
        getText: vi.fn(() => "old content"),
      }

      const mockEditor = {
        document: mockDocument,
        visibleRanges: [
          {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        ],
        selection: null,
        selections: [],
      }

      ;(vscode.window.visibleTextEditors as any) = [mockEditor]
      ;(vscode.window.activeTextEditor as any) = null

      const tracker = new VisibleCodeTracker(mockWorkspacePath)
      const context = await tracker.captureVisibleCode()

      expect(context.editors[0].diffInfo).toEqual({
        scheme: "git",
        side: "old",
        gitRef: "HEAD~1",
        originalPath: "/workspace/test.ts",
      })
    })

    it("should skip non-code documents", async () => {
      const mockOutputDocument = {
        uri: {
          fsPath: "/workspace/output",
          scheme: "output",
          toString: () => "output:///workspace/output",
        },
        languageId: "plaintext",
        getText: vi.fn(() => ""),
      }

      const mockEditor = {
        document: mockOutputDocument,
        visibleRanges: [],
        selection: null,
        selections: [],
      }

      ;(vscode.window.visibleTextEditors as any) = [mockEditor]
      ;(vscode.window.activeTextEditor as any) = null

      const tracker = new VisibleCodeTracker(mockWorkspacePath)
      const context = await tracker.captureVisibleCode()

      // Output scheme should be filtered out
      expect(context.editors).toHaveLength(0)
    })
  })

  describe("security filtering", () => {
    it("should filter security-sensitive files", async () => {
      const mockEnvDocument = {
        uri: {
          fsPath: "/workspace/.env",
          scheme: "file",
          toString: () => "file:///workspace/.env",
        },
        languageId: "plaintext",
        getText: vi.fn(() => "SECRET_KEY=12345"),
      }

      const mockEditor = {
        document: mockEnvDocument,
        visibleRanges: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 20 } }],
        selection: null,
        selections: [],
      }

      ;(vscode.window.visibleTextEditors as any) = [mockEditor]
      ;(vscode.window.activeTextEditor as any) = null

      const tracker = new VisibleCodeTracker(mockWorkspacePath)
      const context = await tracker.captureVisibleCode()

      expect(context.editors).toHaveLength(0)
    })
  })

  describe(".kilocodeignore integration", () => {
    it("should filter files matching .kilocodeignore patterns", async () => {
      const mockIgnoredDocument = {
        uri: {
          fsPath: "/workspace/sensitive/data.json",
          scheme: "file",
          toString: () => "file:///workspace/sensitive/data.json",
        },
        languageId: "json",
        getText: vi.fn(() => '{"data": "sensitive"}'),
      }

      const mockEditor = {
        document: mockIgnoredDocument,
        visibleRanges: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 25 } }],
        selection: null,
        selections: [],
      }

      ;(vscode.window.visibleTextEditors as any) = [mockEditor]
      ;(vscode.window.activeTextEditor as any) = null

      const mockController = {
        validateAccess: vi.fn((path: string) => {
          return !path.includes("sensitive/")
        }),
      } as any

      const tracker = new VisibleCodeTracker(mockWorkspacePath, mockController)
      const context = await tracker.captureVisibleCode()

      expect(context.editors).toHaveLength(0)
      expect(mockController.validateAccess).toHaveBeenCalledWith("sensitive/data.json")
    })
  })
})
