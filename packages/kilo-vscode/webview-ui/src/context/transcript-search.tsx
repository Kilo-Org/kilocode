import { createContext, useContext, createSignal, type Accessor, type Component } from "solid-js"

export interface SearchMatch {
  key: string
  messageId: string
  /** Index (0-based) of this occurrence among all matches within the same row. */
  occurrence: number
}

interface TranscriptSearchContextValue {
  query: Accessor<string>
  setQuery: (value: string) => void
  matchCase: Accessor<boolean>
  setMatchCase: (value: boolean) => void
  wholeWord: Accessor<boolean>
  setWholeWord: (value: boolean) => void
  regex: Accessor<boolean>
  setRegex: (value: boolean) => void
  active: Accessor<boolean>
  setActive: (value: boolean) => void
  index: Accessor<number>
  setIndex: (value: number) => void
  count: Accessor<number>
  setCount: (value: number) => void
  /** Bumped on every explicit next/prev/Enter navigation, even when the
   * resulting index is unchanged (e.g. a single match). MessageList scrolls
   * off this instead of `index` so navigation always jumps to the match. */
  jump: Accessor<number>
  requestJump: () => void
}

const TranscriptSearchContext = createContext<TranscriptSearchContextValue>()

export const TranscriptSearchProvider: Component<{ children: any }> = (props) => {
  const [query, setQuery] = createSignal("")
  const [matchCase, setMatchCase] = createSignal(false)
  const [wholeWord, setWholeWord] = createSignal(false)
  const [regex, setRegex] = createSignal(false)
  const [active, setActive] = createSignal(false)
  const [index, setIndex] = createSignal(0)
  const [count, setCount] = createSignal(0)
  const [jump, setJump] = createSignal(0)

  return (
    <TranscriptSearchContext.Provider
      value={{
        query,
        setQuery,
        matchCase,
        setMatchCase,
        wholeWord,
        setWholeWord,
        regex,
        setRegex,
        active,
        setActive,
        index,
        setIndex,
        count,
        setCount,
        jump,
        requestJump: () => setJump((n) => n + 1),
      }}
    >
      {props.children}
    </TranscriptSearchContext.Provider>
  )
}

export function useTranscriptSearch(): TranscriptSearchContextValue {
  const ctx = useContext(TranscriptSearchContext)
  if (!ctx) throw new Error("useTranscriptSearch must be used within TranscriptSearchProvider")
  return ctx
}
