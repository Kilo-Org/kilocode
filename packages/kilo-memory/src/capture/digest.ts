export namespace MemoryDigest {
  export type Summary = {
    topic?: string
    summary: string
  }

  function blank(input: string | undefined) {
    return !input?.trim()
  }

  export function empty(input: string | Summary) {
    if (typeof input === "string") return blank(input)
    return blank(input.topic) && blank(input.summary)
  }
}
