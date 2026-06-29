import {
  DiffLineAnnotation,
  FileContents,
  FileDiffMetadata,
  FileDiffOptions,
  type SelectedLineRange,
} from "@pierre/diffs"
import { ComponentProps } from "solid-js"
import { createDefaultOptions as defaults, styleVariables as styles } from "@opencode-ai/ui/pierre"

export const styleVariables = {
  ...styles,
  "--diffs-font-size": "var(--diffs-code-font-size, var(--font-size-small))",
}

// Character matching fragments inserted identifiers when they share letters with
// existing symbols. Word-alt keeps those logical additions visually intact.
export const LINE_DIFF_TYPE = "word-alt" as const

// Pierre 1.1 treats its changed-line override properties as tint targets. Apply
// Kilo semantic surfaces at the computed row level so host diff colors stay final.
const css = `
:host([data-color-scheme='light']) {
  color-scheme: light;
}
:host([data-color-scheme='dark']) {
  color-scheme: dark;
}
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
:is([data-line], [data-column-number])[data-line-type='change-addition'],
:is([data-line], [data-column-number])[data-line-type='change-deletion'] {
  outline: 1px solid var(--border-contrast, transparent);
  outline-offset: -1px;
}
`

export function createDefaultOptions<T>(style: FileDiffOptions<T>["diffStyle"]) {
  const opts = defaults<T>(style)
  return {
    ...opts,
    diffIndicators: "classic" as const,
    lineDiffType: LINE_DIFF_TYPE,
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
  // When false, render the supplied diff once instead of row-virtualizing it.
  // Callers should supply hunk-bounded `fileDiff`/`patch` data for large source
  // files so eager rendering does not expand full before/after content.
  // Defaults to virtualized.
  virtualized?: boolean
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

type DiffPair<T> = DiffShared<T> & {
  before: FileContents
  after: FileContents
  /** Unified patch used to parse only rendered hunks instead of full file contents. */
  patch?: string
  fileDiff?: undefined
}

type DiffPatch<T> = DiffShared<T> & {
  fileDiff: FileDiffMetadata
  before?: undefined
  after?: undefined
  patch?: undefined
}

export type DiffProps<T = {}> = DiffPair<T> | DiffPatch<T>
