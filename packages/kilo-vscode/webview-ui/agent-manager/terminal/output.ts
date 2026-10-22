import { truncateTerminalOutput } from "../../../src/services/terminal/truncate"

type Reader = () => string

type Term = { id: string }

export function createEmbeddedTerminalReader(deps: {
  key: (context?: string) => string
  local: string
  side: (key: string) => Term[]
  tabs: (key: string) => Term[]
  focused: () => string | undefined
  sideActive: (key: string) => string | undefined
  active: () => string | undefined
}) {
  return async (context?: string) => {
    const key = deps.key(context ?? deps.local)
    return resolveEmbeddedTerminal(deps.side(key), deps.tabs(key), deps.focused(), deps.sideActive(key), deps.active())
  }
}

export function resolveEmbeddedTerminal(
  side: Term[],
  tabs: Term[],
  focused: string | undefined,
  sideActive: string | undefined,
  active: string | undefined,
): string | undefined {
  const focus = side.find((term) => term.id === focused) ?? tabs.find((term) => term.id === focused)
  const sideTerm = side.find((term) => term.id === sideActive)
  const tab = tabs.find((term) => term.id === active)
  const id = focus?.id ?? sideTerm?.id ?? tab?.id
  return id && (side.some((term) => term.id === id) || tabs.some((term) => term.id === id))
    ? readTerminalOutput(id)
    : undefined
}

const readers = new Map<string, Reader>()

export function registerTerminalOutput(id: string, read: Reader): void {
  readers.set(id, read)
}

export function unregisterTerminalOutput(id: string): void {
  readers.delete(id)
}

export function readTerminalOutput(id: string): string | undefined {
  const content = readers.get(id)?.()
  if (content === undefined) return undefined
  return truncateTerminalOutput(content).content
}
