import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test"
import { getProcessedSnippets } from "../getProcessedSnippets"
import type { AutocompleteInput, AutocompleteContextProvider } from "../../types"
import { AutocompleteSnippetType } from "../../continuedev/core/autocomplete/types"
import type { FileIgnoreController } from "../../shims/FileIgnoreController"
import crypto from "crypto"
import { ContextRetrievalService } from "../../continuedev/core/autocomplete/context/ContextRetrievalService"
import { VsCodeIde } from "../../continuedev/core/vscode-test-harness/src/VSCodeIde"
import { HelperVars } from "../../continuedev/core/autocomplete/util/HelperVars"
// Test-only star imports: bun can spy on plain ESM function exports only through the module namespace,
// and mock.module is process-global so it is not usable here (it corrupts sibling test files).
import * as getAllSnippetsModule from "../../continuedev/core/autocomplete/snippets/getAllSnippets"
import * as filteringModule from "../../continuedev/core/autocomplete/templating/filtering"

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

function emptySnippetPayload(): getAllSnippetsModule.SnippetPayload {
  return {
    recentlyOpenedFileSnippets: [],
    importDefinitionSnippets: [],
    rootPathSnippets: [],
    recentlyEditedRangeSnippets: [],
    recentlyVisitedRangesSnippets: [],
    clipboardSnippets: [],
    staticSnippet: [],
  }
}

describe("AutocompleteContextProvider", () => {
  let contextProvider: AutocompleteContextProvider
  let mockIgnoreController: Promise<FileIgnoreController> | undefined
  let getAllSnippetsSpy: ReturnType<typeof spyOn<typeof getAllSnippetsModule, "getAllSnippetsWithoutRace">>
  let getSnippetsSpy: ReturnType<typeof spyOn<typeof filteringModule, "getSnippets">>

  beforeEach(() => {
    mock.clearAllMocks()

    mockIgnoreController = undefined

    // Restorable spies replace the v1 whole-module mocks. Snippet filepaths are already "file://"
    // URIs because the shared vscode mock does not implement Uri.file().toString(); the assertions
    // still match v1, whose Uri mock produced the same URIs.
    spyOn(ContextRetrievalService.prototype, "initializeForFile").mockResolvedValue(undefined)
    spyOn(VsCodeIde.prototype, "getWorkspaceDirs").mockResolvedValue(["file:///workspace"])
    spyOn(HelperVars, "create").mockResolvedValue({
      filepath: "file:///test.ts",
      lang: { name: "typescript", singleLineComment: "//" },
    } as any)

    getAllSnippetsSpy = spyOn(getAllSnippetsModule, "getAllSnippetsWithoutRace").mockResolvedValue(emptySnippetPayload())
    getSnippetsSpy = spyOn(filteringModule, "getSnippets").mockImplementation((_helper, payload) => [
      ...payload.recentlyOpenedFileSnippets,
      ...payload.importDefinitionSnippets,
    ])

    const ide = new VsCodeIde({} as any)
    const contextService = new ContextRetrievalService(ide)
    contextProvider = {
      ide,
      contextService,
      modelId: "codestral",
      ignoreController: mockIgnoreController,
    }
  })

  afterEach(() => {
    mock.restore()
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
      getAllSnippetsSpy.mockResolvedValueOnce({
        ...emptySnippetPayload(),
        recentlyOpenedFileSnippets: [
          {
            filepath: "file:///recent.ts",
            content: "const recent = 1;",
            type: AutocompleteSnippetType.Code,
          },
        ],
      })

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
      getAllSnippetsSpy.mockResolvedValueOnce({
        ...emptySnippetPayload(),
        recentlyOpenedFileSnippets: [
          {
            filepath: "file:///file1.ts",
            content: "const first = 1;",
            type: AutocompleteSnippetType.Code,
          },
        ],
        importDefinitionSnippets: [
          {
            filepath: "file:///file2.ts",
            content: "const second = 2;",
            type: AutocompleteSnippetType.Code,
          },
        ],
      })

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
      getAllSnippetsSpy.mockRejectedValueOnce(new Error("Test error"))

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
      // Mock validateAccess to block /blocked.ts
      const controller = await mockIgnoreController!
      ;(controller as any).validateAccess.mockImplementation((path: string) => {
        return !path.includes("blocked.ts")
      })

      getAllSnippetsSpy.mockResolvedValueOnce({
        ...emptySnippetPayload(),
        recentlyOpenedFileSnippets: [
          {
            filepath: "file:///allowed.ts",
            content: "const allowed = 1;",
            type: AutocompleteSnippetType.Code,
          },
          {
            filepath: "file:///blocked.ts",
            content: "const blocked = 2;",
            type: AutocompleteSnippetType.Code,
          },
        ],
      })

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
      const controller = await mockIgnoreController!
      ;(controller as any).validateAccess.mockReturnValue(false) // Block all files

      getAllSnippetsSpy.mockResolvedValueOnce({
        ...emptySnippetPayload(),
        recentlyOpenedFileSnippets: [
          {
            filepath: "file:///blocked.ts",
            content: "const blocked = 1;",
            type: AutocompleteSnippetType.Code,
          },
        ],
        clipboardSnippets: [
          {
            content: "clipboard content",
            type: AutocompleteSnippetType.Clipboard,
            copiedAt: "2024-01-01",
          },
        ],
      })

      getSnippetsSpy.mockImplementation((_helper, payload) => [
        ...payload.recentlyOpenedFileSnippets,
        ...payload.clipboardSnippets,
      ])

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

      getAllSnippetsSpy.mockResolvedValueOnce({
        ...emptySnippetPayload(),
        recentlyOpenedFileSnippets: [
          {
            filepath: "file:///any-file.ts",
            content: "const any = 1;",
            type: AutocompleteSnippetType.Code,
          },
        ],
      })

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
