import { truncateTerminalOutput } from "../../../src/services/terminal/truncate"

type Reader = () => string

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
