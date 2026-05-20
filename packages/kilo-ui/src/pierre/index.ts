import {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  FileDiffOptions,
  type SelectedLineRange,
} from "@pierre/diffs"
import { ComponentProps } from "solid-js"

export { createDefaultOptions, styleVariables } from "@opencode-ai/ui/pierre"

// Extends upstream DiffProps with a `fileDiff` variant so Pierre can render
// a precomputed FileDiffMetadata directly. The pair (before/after) variant
// stays compatible with upstream usage.
type DiffShared<T> = FileDiffOptions<T> & {
  annotations?: DiffLineAnnotation<T>[]
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  onLineNumberSelectionEnd?: (selection: SelectedLineRange | null) => void
  onRendered?: () => void
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

type DiffPair<T> = DiffShared<T> & {
  before: FileContents
  after: FileContents
  fileDiff?: undefined
}

type DiffPatch<T> = DiffShared<T> & {
  fileDiff: FileDiffMetadata
  before?: undefined
  after?: undefined
}

export type DiffProps<T = {}> = DiffPair<T> | DiffPatch<T>
