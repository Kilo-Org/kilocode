import {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  FileDiffOptions,
  type SelectedLineRange,
} from "@pierre/diffs"
import { ComponentProps } from "solid-js"
import { createDefaultOptions as defaults, styleVariables } from "@opencode-ai/ui/pierre"

export { styleVariables }

// Pierre 1.1 treats its changed-line override properties as tint targets. Apply
// Kilo semantic surfaces at the computed row level so host diff colors stay final.
const css = `
[data-diff][data-background] [data-line][data-line-type='change-addition'] {
  --diffs-computed-diff-line-bg: var(--surface-diff-add-base, var(--diffs-bg-addition));
  --diffs-computed-selected-line-bg: var(--surface-diff-add-base, var(--diffs-bg-addition));
}
[data-diff][data-background] [data-column-number][data-line-type='change-addition'] {
  --diffs-computed-diff-line-bg: var(--surface-diff-add-weaker, var(--diffs-bg-addition-number));
  --diffs-computed-selected-line-bg: var(--surface-diff-add-weaker, var(--diffs-bg-addition-number));
}
[data-diff][data-background] [data-line][data-line-type='change-deletion'] {
  --diffs-computed-diff-line-bg: var(--surface-diff-delete-base, var(--diffs-bg-deletion));
  --diffs-computed-selected-line-bg: var(--surface-diff-delete-base, var(--diffs-bg-deletion));
}
[data-diff][data-background] [data-column-number][data-line-type='change-deletion'] {
  --diffs-computed-diff-line-bg: var(--surface-diff-delete-weaker, var(--diffs-bg-deletion-number));
  --diffs-computed-selected-line-bg: var(--surface-diff-delete-weaker, var(--diffs-bg-deletion-number));
}
`

export function createDefaultOptions<T>(style: FileDiffOptions<T>["diffStyle"]) {
  const opts = defaults<T>(style)
  return {
    ...opts,
    unsafeCSS: `${opts.unsafeCSS}\n${css}`,
  }
}

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
