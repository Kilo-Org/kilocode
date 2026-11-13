export namespace MemoryToken {
  const chars = 4

  export function estimate(input: string) {
    return Math.max(0, Math.round((input || "").length / chars))
  }
}
