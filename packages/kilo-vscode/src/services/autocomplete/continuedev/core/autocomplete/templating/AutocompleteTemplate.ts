// Fill-in-the-middle prompt compilation.
//
// We only target Codestral (via Kilo Gateway). The Mistral API applies the
// FIM prefix/suffix tokens itself, so here we just prepend Codestral's
// multi-file context headers (`+++++ <path>`) before the current file.

import { getLastNUriRelativePathParts, getShortestUniqueRelativeUriPaths } from "../../util/uri.js"
import { AutocompleteSnippet, AutocompleteSnippetType } from "../types.js"

function getFileName(snippet: { uri: string; uniquePath: string }): string {
  return snippet.uri.startsWith("file://") ? snippet.uniquePath : snippet.uri
}

export function compileCodestralPrefixSuffix(
  prefix: string,
  suffix: string,
  filepath: string,
  snippets: AutocompleteSnippet[],
  workspaceUris: string[],
): [string, string] {
  if (snippets.length === 0) {
    if (suffix.trim().length === 0 && prefix.trim().length === 0) {
      return [`+++++ ${getLastNUriRelativePathParts(workspaceUris, filepath, 2)}\n${prefix}`, suffix]
    }
    return [prefix, suffix]
  }

  const relativePaths = getShortestUniqueRelativeUriPaths(
    [...snippets.map((s) => ("filepath" in s ? s.filepath : "file:///Untitled.txt")), filepath],
    workspaceUris,
  )

  const otherFiles = snippets
    .map((snippet, i) => {
      if (snippet.type === AutocompleteSnippetType.Diff) {
        return snippet.content
      }
      return `+++++ ${getFileName(relativePaths[i])} \n${snippet.content}`
    })
    .join("\n\n")

  return [`${otherFiles}\n\n+++++ ${getFileName(relativePaths[relativePaths.length - 1])}\n${prefix}`, suffix]
}
