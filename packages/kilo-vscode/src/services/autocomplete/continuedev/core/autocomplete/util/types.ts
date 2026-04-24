import type { Position, Range, RangeInFile } from "../.."
import type { AutocompleteCodeSnippet } from "../types"

export type RecentlyEditedRange = RangeInFile & {
  timestamp: number
  lines: string[]
  symbols: Set<string>
}

export interface AutocompleteInput {
  isUntitledFile: boolean
  completionId: string
  filepath: string
  pos: Position
  recentlyVisitedRanges: AutocompleteCodeSnippet[]
  recentlyEditedRanges: RecentlyEditedRange[]
  // Used for notebook files
  manuallyPassFileContents?: string
  // Used for VS Code git commit input box
  manuallyPassPrefix?: string
  selectedCompletionInfo?: {
    text: string
    range: Range
  }
  injectDetails?: string
}
