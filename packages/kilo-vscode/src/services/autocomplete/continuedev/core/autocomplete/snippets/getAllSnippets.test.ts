import { beforeEach, describe, expect, it, mock } from "bun:test"
import type { ContextRetrievalService } from "../context/ContextRetrievalService"
import { AutocompleteSnippetType } from "../types"
import type { HelperVars } from "../util/HelperVars"
import type { IDE } from "../../index"
import { getAllSnippetsWithoutRace } from "./getAllSnippets"

describe("getAllSnippetsWithoutRace", () => {
  let helper: HelperVars
  let ide: IDE
  let context: ContextRetrievalService

  beforeEach(() => {
    helper = {
      input: {
        filepath: "/test/file.ts",
        recentlyEditedRanges: [{ filepath: "/test/recent.ts", lines: ["const x = 1;"] }],
        recentlyVisitedRanges: [
          { filepath: "/test/visited.ts", content: "visited", type: AutocompleteSnippetType.Code },
        ],
      },
      filepath: "/test/file.ts",
      options: {
        useRecentlyEdited: true,
        useRecentlyOpened: true,
        experimental_enableStaticContextualization: false,
      },
    } as HelperVars
    ide = {
      getClipboardContent: mock().mockResolvedValue({ text: "clipboard", copiedAt: "2024-01-01" }),
      readFile: mock().mockResolvedValue("file content"),
    } as unknown as IDE
    context = {
      getRootPathSnippets: mock().mockResolvedValue([]),
      getSnippetsFromImportDefinitions: mock().mockResolvedValue([]),
      getStaticContextSnippets: mock().mockResolvedValue([]),
    } as unknown as ContextRetrievalService
  })

  it("collects every active snippet source", async () => {
    const result = await getAllSnippetsWithoutRace({ helper, ide, contextRetrievalService: context })

    expect(result).toEqual({
      rootPathSnippets: [],
      importDefinitionSnippets: [],
      recentlyEditedRangeSnippets: [
        { filepath: "/test/recent.ts", content: "const x = 1;", type: AutocompleteSnippetType.Code },
      ],
      recentlyVisitedRangesSnippets: [
        { filepath: "/test/visited.ts", content: "visited", type: AutocompleteSnippetType.Code },
      ],
      clipboardSnippets: [{ content: "clipboard", copiedAt: "2024-01-01", type: AutocompleteSnippetType.Clipboard }],
      recentlyOpenedFileSnippets: [],
      staticSnippet: [],
    })
  })

  it("honors disabled recent-context sources", async () => {
    helper.options.useRecentlyEdited = false
    helper.options.useRecentlyOpened = false

    const result = await getAllSnippetsWithoutRace({ helper, ide, contextRetrievalService: context })
    expect(result.recentlyEditedRangeSnippets).toEqual([])
    expect(result.recentlyOpenedFileSnippets).toEqual([])
  })

  it("collects import definitions and enabled static context", async () => {
    helper.options.experimental_enableStaticContextualization = true
    context.getSnippetsFromImportDefinitions = mock()
      .mockResolvedValue([{ filepath: "/import.ts", content: "imported", type: AutocompleteSnippetType.Code }])
    context.getStaticContextSnippets = mock()
      .mockResolvedValue([{ filepath: "/static.ts", content: "static", type: AutocompleteSnippetType.Static }])

    const result = await getAllSnippetsWithoutRace({ helper, ide, contextRetrievalService: context })
    expect(result.importDefinitionSnippets[0]?.content).toBe("imported")
    expect(result.staticSnippet[0]?.content).toBe("static")
  })

  it("propagates clipboard failures", async () => {
    ide.getClipboardContent = mock().mockRejectedValue(new Error("Clipboard error"))

    await expect(getAllSnippetsWithoutRace({ helper, ide, contextRetrievalService: context })).rejects.toThrow(
      "Clipboard error",
    )
  })

  it("waits for active context sources without a collector timeout", async () => {
    context.getRootPathSnippets = mock().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve([{ filepath: "/slow.ts", content: "slow", type: AutocompleteSnippetType.Code }]),
            120,
          )
        }),
    )

    const result = await getAllSnippetsWithoutRace({ helper, ide, contextRetrievalService: context })
    expect(result.rootPathSnippets[0]?.content).toBe("slow")
  })

  it("propagates context retrieval failures", async () => {
    context.getRootPathSnippets = mock().mockRejectedValue(new Error("Service error"))

    await expect(getAllSnippetsWithoutRace({ helper, ide, contextRetrievalService: context })).rejects.toThrow(
      "Service error",
    )
  })
})
