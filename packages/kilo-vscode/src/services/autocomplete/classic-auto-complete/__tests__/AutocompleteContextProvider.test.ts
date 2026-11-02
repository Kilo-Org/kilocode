import { describe, it, expect, beforeEach, mock } from "bun:test"
import { getProcessedSnippets } from "../getProcessedSnippets"
import type { AutocompleteInput, AutocompleteContextProvider } from "../../types"
import { AutocompleteSnippetType } from "../../continuedev/core/autocomplete/types"
import type { FileIgnoreController } from "../../shims/FileIgnoreController"
import crypto from "crypto"
import { ContextRetrievalService } from "../../continuedev/core/autocomplete/context/ContextRetrievalService"
import { VsCodeIde } from "../../continuedev/core/vscode-test-harness/src/VSCodeIde"

// Skipped under bun: these cases mock getProcessedSnippets' whole module graph with vi.mock, which
// converts to bun's mock.module. mock.module registrations are process-global and overwrite exports
// for every test file in the run, so they corrupt sibling tests that import the same modules (for
// example getAllSnippets.test.ts). bun test has no per-file module isolation here.
describe.skip("AutocompleteContextProvider", () => {
  let contextProvider: AutocompleteContextProvider
  let mockIgnoreController: Promise<FileIgnoreController> | undefined

  function createAutocompleteInput(filepath: string = "/test.ts"): AutocompleteInput {
    return {
      isUntitledFile: false,
      completionId: crypto.randomUUID(),
      filepath,
      pos: { line: 0, character: 0 },
      recentlyVisitedRanges: [],
      recentlyEditedRanges: [],
    }
  }

  beforeEach(() => {
    mock.clearAllMocks()

    mockIgnoreController = undefined

    const ide = new VsCodeIde({} as any)
    const contextService = new ContextRetrievalService(ide)
    contextProvider = {
      ide,
      contextService,
      modelId: "codestral",
      ignoreController: mockIgnoreController,
    }
  })

  describe("getProcessedSnippets", () => {
    it("should return empty snippets when no snippets available", async () => {
      const input = createAutocompleteInput("/test.ts")
      const result = await getProcessedSnippets(
        input,
        "/test.ts",
        contextProvider.contextService,
        contextProvider.modelId,
        contextProvider.ide,
        contextProvider.ignoreController,
      )

      expect(result.snippetsWithUris).toEqual([])
      expect(result.helper).toBeDefined()
      expect(result.workspaceDirs).toEqual(["file:///workspace"])
    })

    it("should return processed snippets when snippets are available", async () => {
      const input = createAutocompleteInput("/test.ts")
      const result = await getProcessedSnippets(
        input,
        "/test.ts",
        contextProvider.contextService,
        contextProvider.modelId,
        contextProvider.ide,
        contextProvider.ignoreController,
      )

      expect(result.snippetsWithUris).toHaveLength(1)
      expect(result.snippetsWithUris[0]).toEqual({
        filepath: "file:///recent.ts",
        content: "const recent = 1;",
        type: AutocompleteSnippetType.Code,
      })
    })

    it("should process multiple snippets correctly", async () => {
      const input = createAutocompleteInput("/test.ts")
      const result = await getProcessedSnippets(
        input,
        "/test.ts",
        contextProvider.contextService,
        contextProvider.modelId,
        contextProvider.ide,
        contextProvider.ignoreController,
      )

      expect(result.snippetsWithUris).toHaveLength(2)
      expect(result.snippetsWithUris[0]).toEqual({
        filepath: "file:///file1.ts",
        content: "const first = 1;",
        type: AutocompleteSnippetType.Code,
      })
      expect(result.snippetsWithUris[1]).toEqual({
        filepath: "file:///file2.ts",
        content: "const second = 2;",
        type: AutocompleteSnippetType.Code,
      })
    })

    it("should propagate errors from getAllSnippetsWithoutRace", async () => {
      const input = createAutocompleteInput("/test.ts")

      await expect(
        getProcessedSnippets(
          input,
          "/test.ts",
          contextProvider.contextService,
          contextProvider.modelId,
          contextProvider.ide,
          contextProvider.ignoreController,
        ),
      ).rejects.toThrow("Test error")
    })
  })

  describe("with FileIgnoreController", () => {
    beforeEach(() => {
      const mockController = {
        validateAccess: mock().mockReturnValue(true),
        initialize: mock(),
        dispose: mock(),
        filterPaths: mock(),
        validateCommand: mock(),
        getInstructions: mock(),
      } as any

      mockIgnoreController = Promise.resolve(mockController)

      const ide = new VsCodeIde({} as any)
      const contextService = new ContextRetrievalService(ide)
      contextProvider = {
        ide,
        contextService,
        modelId: "codestral",
        ignoreController: mockIgnoreController,
      }
    })

    it("should filter out blocked files", async () => {
      const input = createAutocompleteInput("/test.ts")
      const result = await getProcessedSnippets(
        input,
        "/test.ts",
        contextProvider.contextService,
        contextProvider.modelId,
        contextProvider.ide,
        contextProvider.ignoreController,
      )

      // Should only contain the allowed file
      expect(result.snippetsWithUris).toHaveLength(1)
      const snippet = result.snippetsWithUris[0]
      expect("filepath" in snippet && snippet.filepath).toBeTruthy()
      if ("filepath" in snippet) {
        expect(snippet.filepath).toContain("allowed.ts")
      }
      expect(snippet.content).toBe("const allowed = 1;")
    })

    it("should keep snippets without file paths", async () => {
      const input = createAutocompleteInput("/test.ts")
      const result = await getProcessedSnippets(
        input,
        "/test.ts",
        contextProvider.contextService,
        contextProvider.modelId,
        contextProvider.ide,
        contextProvider.ignoreController,
      )

      // Should not contain blocked file
      expect(
        result.snippetsWithUris.some((s) => "filepath" in s && s.filepath && s.filepath.includes("blocked.ts")),
      ).toBe(false)
      // But should contain snippets without file paths
      expect(result.snippetsWithUris).toHaveLength(1)
      expect(result.snippetsWithUris[0].content).toBe("clipboard content")
      expect(result.snippetsWithUris[0].type).toBe(AutocompleteSnippetType.Clipboard)
    })

    it("should allow all files when no ignore controller is provided", async () => {
      // Create provider without ignore controller
      const ide = new VsCodeIde({} as any)
      const contextService = new ContextRetrievalService(ide)
      contextProvider = {
        ide,
        contextService,
        modelId: "codestral",
        ignoreController: undefined,
      }

      const input = createAutocompleteInput("/test.ts")
      const result = await getProcessedSnippets(
        input,
        "/test.ts",
        contextProvider.contextService,
        contextProvider.modelId,
        contextProvider.ide,
        contextProvider.ignoreController,
      )

      // Should contain all files when no controller
      expect(result.snippetsWithUris).toHaveLength(1)
      const snippet = result.snippetsWithUris[0]
      expect("filepath" in snippet && snippet.filepath).toBeTruthy()
      if ("filepath" in snippet) {
        expect(snippet.filepath).toContain("any-file.ts")
      }
      expect(snippet.content).toBe("const any = 1;")
    })
  })
})
