import { IDE } from "../../index"
import { ContextRetrievalService } from "../context/ContextRetrievalService"
import { HelperVars } from "../util/HelperVars"
import { openedFilesLruCache } from "../util/openedFilesLruCache"
import {
  AutocompleteClipboardSnippet,
  AutocompleteCodeSnippet,
  AutocompleteSnippetType,
  AutocompleteStaticSnippet,
} from "../types"

export interface SnippetPayload {
  rootPathSnippets: AutocompleteCodeSnippet[]
  importDefinitionSnippets: AutocompleteCodeSnippet[]
  recentlyEditedRangeSnippets: AutocompleteCodeSnippet[]
  recentlyVisitedRangesSnippets: AutocompleteCodeSnippet[]
  clipboardSnippets: AutocompleteClipboardSnippet[]
  recentlyOpenedFileSnippets: AutocompleteCodeSnippet[]
  staticSnippet: AutocompleteStaticSnippet[]
}

function getSnippetsFromRecentlyEditedRanges(helper: HelperVars): AutocompleteCodeSnippet[] {
  if (helper.options.useRecentlyEdited === false) return []

  return helper.input.recentlyEditedRanges.map((range) => ({
    filepath: range.filepath,
    content: range.lines.join("\n"),
    type: AutocompleteSnippetType.Code,
  }))
}

const getClipboardSnippets = async (ide: IDE): Promise<AutocompleteClipboardSnippet[]> => {
  const content = await ide.getClipboardContent()
  return [
    {
      content: content.text,
      copiedAt: content.copiedAt,
      type: AutocompleteSnippetType.Clipboard,
    },
  ]
}

const getSnippetsFromRecentlyOpenedFiles = async (helper: HelperVars, ide: IDE): Promise<AutocompleteCodeSnippet[]> => {
  if (helper.options.useRecentlyOpened === false) return []

  try {
    const current = `${helper.filepath}`
    const uris = [...openedFilesLruCache.entriesDescending()].filter(([uri]) => uri !== current).map(([uri]) => uri)
    const reads = uris.map((uri) => {
      const read = new Promise<AutocompleteCodeSnippet | null>((resolve) => {
        ide
          .readFile(uri)
          .then((content) => {
            if (!content || content.trim() === "") {
              resolve(null)
              return
            }
            resolve({ filepath: uri, content, type: AutocompleteSnippetType.Code })
          })
          .catch((err) => {
            console.error(`Failed to read file ${uri}:`, err)
            resolve(null)
          })
      })
      return Promise.race([read, new Promise<null>((resolve) => setTimeout(() => resolve(null), 80))])
    })
    const results = await Promise.all(reads)
    return results.filter(Boolean) as AutocompleteCodeSnippet[]
  } catch (err) {
    console.error("Error processing opened files cache:", err)
    return []
  }
}

export const getAllSnippetsWithoutRace = async ({
  helper,
  ide,
  contextRetrievalService,
}: {
  helper: HelperVars
  ide: IDE
  contextRetrievalService: ContextRetrievalService
}): Promise<SnippetPayload> => {
  const [root, imports, clipboard, opened, staticSnippet] = await Promise.all([
    contextRetrievalService.getRootPathSnippets(helper),
    contextRetrievalService.getSnippetsFromImportDefinitions(helper),
    getClipboardSnippets(ide),
    getSnippetsFromRecentlyOpenedFiles(helper, ide),
    helper.options.experimental_enableStaticContextualization
      ? contextRetrievalService.getStaticContextSnippets(helper)
      : [],
  ])

  return {
    rootPathSnippets: root,
    importDefinitionSnippets: imports,
    recentlyEditedRangeSnippets: getSnippetsFromRecentlyEditedRanges(helper),
    recentlyVisitedRangesSnippets: helper.input.recentlyVisitedRanges,
    clipboardSnippets: clipboard,
    recentlyOpenedFileSnippets: opened,
    staticSnippet,
  }
}
