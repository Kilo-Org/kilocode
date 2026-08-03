import type { Match } from "../filesystem/schema"

export interface Options {
  readonly context?: number
  readonly literal?: boolean
  readonly ignoreCase?: boolean
}

export type GrepMatch = Match & {
  readonly context: boolean
  readonly textTruncated: boolean
}

export const flags = (input: Options) => [
  ...(input.literal ? ["--fixed-strings"] : []),
  ...(input.ignoreCase ? ["--ignore-case"] : []),
  ...(input.context ? [`--context=${input.context}`] : []),
]

export const stop = (limit: number) => {
  let matches = 0
  return (row: { readonly context: boolean }) => !row.context && ++matches > limit
}

export const select = <
  A extends {
    readonly context: boolean
    readonly path: { readonly text: string }
    readonly line_number: number
  },
>(
  input: { readonly limit: number; readonly context?: number },
  items: readonly A[],
) => {
  let count = 0
  const overflow = items.findIndex((row) => !row.context && ++count > input.limit)
  const selected = items.slice(0, overflow === -1 ? items.length : overflow)
  const matches = selected.filter((row) => !row.context)
  return selected.filter(
    (row) =>
      !row.context ||
      matches.some(
        (match) =>
          match.path.text === row.path.text && Math.abs(match.line_number - row.line_number) <= (input.context ?? 0),
      ),
  )
}

export const decorate = (match: Match, context: boolean, textTruncated: boolean): GrepMatch => ({
  ...match,
  context,
  textTruncated,
})
