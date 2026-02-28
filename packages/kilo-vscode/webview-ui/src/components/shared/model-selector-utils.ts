import type { ModelSelection } from "../../types/messages"
import type { EnrichedModel } from "../../context/provider"

export const KILO_GATEWAY_ID = "kilo"

export const PROVIDER_ORDER = [KILO_GATEWAY_ID, "anthropic", "openai", "google"]

const WORD_BOUNDARY_REGEX = /(?=[A-Z])|[[\]_.:\s/\\(){}-]+/

interface WordToken {
  word: string
  index: number
}

interface MatchResult {
  positions: Set<number>
  nextWordIndex: number
}

export interface SearchResult<T> {
  item: T
  positions: Set<number>
}

export interface HighlightSegment {
  text: string
  highlight: boolean
}

export interface FilterResult {
  models: EnrichedModel[]
  positions: Map<string, Set<number>>
}

export function modelKey(model: Pick<EnrichedModel, "providerID" | "id">): string {
  return `${model.providerID}/${model.id}`
}

export function providerSortKey(providerID: string, order = PROVIDER_ORDER): number {
  const idx = order.indexOf(providerID.toLowerCase())
  return idx >= 0 ? idx : order.length
}

export function isFree(model: Pick<EnrichedModel, "inputPrice">): boolean {
  return model.inputPrice === 0
}

export function filterModels(
  models: EnrichedModel[],
  query: string,
  finder = new WordBoundaryFzf(models, (model) => model.name),
): FilterResult {
  const text = query.trim()
  if (!text) {
    return {
      models,
      positions: new Map<string, Set<number>>(),
    }
  }

  const nameMatches = finder.find(text)
  const nameMatchesByKey = new Map(nameMatches.map(({ item, positions }) => [modelKey(item), positions] as const))
  const normalized = text.toLowerCase()
  const positions = new Map<string, Set<number>>()

  const filtered = models.reduce<EnrichedModel[]>((result, model) => {
    const key = modelKey(model)
    const match = nameMatchesByKey.get(key)

    if (match) {
      positions.set(key, match)
      result.push(model)
      return result
    }

    const fallbackMatch =
      model.providerName.toLowerCase().includes(normalized) || model.id.toLowerCase().includes(normalized)
    if (fallbackMatch) {
      result.push(model)
    }

    return result
  }, [])

  return {
    models: filtered,
    positions,
  }
}

export class WordBoundaryFzf<T> {
  constructor(
    private readonly items: T[],
    private readonly selector: (item: T) => string,
  ) {}

  find(query: string): SearchResult<T>[] {
    if (!query || query.trim() === "") {
      return this.items.map((item) => ({ item, positions: new Set<number>() }))
    }

    const queryWords = query
      .toLowerCase()
      .trim()
      .split(WORD_BOUNDARY_REGEX)
      .filter((word) => word.length > 0)
    if (queryWords.length === 0) {
      return []
    }

    const results: SearchResult<T>[] = []

    for (const item of this.items) {
      const text = this.selector(item)
      const tokens = this.tokenize(text)
      const lowerWords = tokens.map((token) => token.word.toLowerCase())

      if (queryWords.length > 1) {
        // Multi-word queries must match in order and consume distinct tokens.
        let startWordIndex = 0
        const allPositions = new Set<number>()
        const allMatch = queryWords.every((word) => {
          const match = this.matchAcronym(tokens, lowerWords, word, startWordIndex)
          if (!match) return false
          startWordIndex = match.nextWordIndex
          match.positions.forEach((position) => allPositions.add(position))
          return true
        })

        if (allMatch) {
          results.push({ item, positions: allPositions })
        }
      } else {
        const match = this.matchAcronym(tokens, lowerWords, queryWords[0], 0)
        if (match) {
          results.push({ item, positions: match.positions })
        }
      }
    }

    return results
  }

  private tokenize(text: string): WordToken[] {
    const tokens: WordToken[] = []
    let currentIndex = 0
    const words = text.split(WORD_BOUNDARY_REGEX).filter((word) => word.length > 0)

    for (const word of words) {
      const index = text.indexOf(word, currentIndex)
      if (index === -1) {
        throw new Error(`Failed to tokenize "${text}" at "${word}" from index ${currentIndex}`)
      }
      tokens.push({ word, index })
      currentIndex = index + word.length
    }

    return tokens
  }

  private matchAcronym(
    tokens: WordToken[],
    lowerWords: string[],
    query: string,
    startWordIndex: number,
  ): MatchResult | null {
    const failed = new Set<string>()

    const tryMatch = (
      wordIndex: number,
      queryIndex: number,
      currentPositions: Set<number>,
    ): MatchResult | null => {
      if (queryIndex === query.length) {
        return {
          positions: currentPositions,
          nextWordIndex: wordIndex,
        }
      }
      if (wordIndex >= lowerWords.length) {
        return null
      }

      const state = `${wordIndex}:${queryIndex}`
      if (failed.has(state)) {
        return null
      }

      const word = lowerWords[wordIndex]
      const token = tokens[wordIndex]
      let nextPositions: Set<number> | undefined
      let matchedInWord = 0

      while (
        queryIndex + matchedInWord < query.length &&
        matchedInWord < word.length &&
        word[matchedInWord] === query[queryIndex + matchedInWord]
      ) {
        if (!nextPositions) {
          nextPositions = new Set(currentPositions)
        }
        nextPositions.add(token.index + matchedInWord)
        matchedInWord++
      }

      if (matchedInWord > 0 && nextPositions) {
        const continued = tryMatch(wordIndex + 1, queryIndex + matchedInWord, nextPositions)
        if (continued) {
          return continued
        }
      }

      const skipped = tryMatch(wordIndex + 1, queryIndex, currentPositions)
      if (skipped) {
        return skipped
      }
      failed.add(state)
      return null
    }

    return tryMatch(startWordIndex, 0, new Set<number>())
  }
}

export function buildMatchSegments(text: string, matchingPositions?: Set<number>): HighlightSegment[] {
  if (!matchingPositions || matchingPositions.size === 0) {
    return [{ text, highlight: false }]
  }

  const segments: HighlightSegment[] = []
  let lastIndex = 0

  for (let index = 0; index < text.length; index++) {
    const isMatch = matchingPositions.has(index)
    const wasMatch = index > 0 && matchingPositions.has(index - 1)

    if (isMatch !== wasMatch) {
      if (index > lastIndex) {
        segments.push({ text: text.slice(lastIndex, index), highlight: wasMatch })
      }
      lastIndex = index
    }
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), highlight: matchingPositions.has(text.length - 1) })
  }

  return segments
}

export function buildTriggerLabel(
  resolvedName: string | undefined,
  raw: ModelSelection | null,
  allowClear: boolean,
  clearLabel: string,
  hasProviders: boolean,
  labels: { select: string; noProviders: string; notSet: string },
): string {
  if (resolvedName) return resolvedName
  if (raw?.providerID && raw?.modelID) {
    return raw.providerID === KILO_GATEWAY_ID ? raw.modelID : `${raw.providerID} / ${raw.modelID}`
  }
  if (allowClear) return clearLabel || labels.notSet
  return hasProviders ? labels.select : labels.noProviders
}
