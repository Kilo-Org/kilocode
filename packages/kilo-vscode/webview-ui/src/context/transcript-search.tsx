import { createContext, useContext, createSignal, type Accessor, type ParentComponent } from "solid-js"

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
  /** True when "Use Regular Expression" is on and the current query fails to
   * compile — lets the widget show an explicit error instead of looking
   * indistinguishable from a plain "no matches". */
  invalid: Accessor<boolean>
  setInvalid: (value: boolean) => void
  /** True while MessageList is auto-loading older message pages to search
   * them too — the session only loads the most recent page by default, so
   * without this the widget would report "No results"/a final count while
   * older history hadn't been searched yet. */
  searchingHistory: Accessor<boolean>
  setSearchingHistory: (value: boolean) => void
}

const TranscriptSearchContext = createContext<TranscriptSearchContextValue>()

export const TranscriptSearchProvider: ParentComponent = (props) => {
  const [query, setQuery] = createSignal("")
  const [matchCase, setMatchCase] = createSignal(false)
  const [wholeWord, setWholeWord] = createSignal(false)
  const [regex, setRegex] = createSignal(false)
  const [active, setActive] = createSignal(false)
  const [index, setIndex] = createSignal(0)
  const [count, setCount] = createSignal(0)
  const [jump, setJump] = createSignal(0)
  const [invalid, setInvalid] = createSignal(false)
  const [searchingHistory, setSearchingHistory] = createSignal(false)

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
        invalid,
        setInvalid,
        searchingHistory,
        setSearchingHistory,
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
