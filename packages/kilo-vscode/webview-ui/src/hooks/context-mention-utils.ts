/**
 * A prompt attachment one `@` mention adds, in the shape of a v2 prompt file: the URI the server reads, the name the
 * model sees, and the span of the mention in the sent text.
 */
export type MentionFile = {
  uri: string
  name?: string
  description?: string
  mention: { start: number; end: number; text: string }
}

export type Mention = {
  value: string
  start: number
  end: number
}

export function find(text: string, pattern: RegExp, token: string): Mention | undefined {
  pattern.lastIndex = 0
  const match = pattern.exec(text)
  if (!match) return undefined

  const prefix = match[1] ?? ""
  const start = match.index + prefix.length
  const value = `@${token}`
  return { value, start, end: start + value.length }
}

export function attachment(mention: Mention | undefined, content: string, filename: string): MentionFile | undefined {
  if (!mention) return undefined

  return {
    uri: `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`,
    name: filename,
    mention: { text: mention.value, start: mention.start, end: mention.end },
  }
}
