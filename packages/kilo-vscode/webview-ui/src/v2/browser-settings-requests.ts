// Attempt ids for the Browser section's three requests. A reply names the operation it answers, so a slow read never
// drops a write's reply and only the newest attempt of an operation may change that operation's flags.

export type Operation = "read" | "write" | "install"

const OPERATIONS: readonly Operation[] = ["read", "write", "install"]

export function requestTracker() {
  const current: Record<Operation, string> = { read: "", write: "", install: "" }
  let sequence = 0
  const kindOf = (requestId: string): Operation | undefined => {
    const kind = requestId.slice(0, requestId.indexOf(":"))
    return OPERATIONS.includes(kind as Operation) ? (kind as Operation) : undefined
  }
  return {
    start(kind: Operation): string {
      const requestId = `${kind}:${++sequence}`
      current[kind] = requestId
      return requestId
    },
    kindOf,
    /** True while the reply's attempt is the newest of its operation. */
    accepts(requestId: string): boolean {
      const kind = kindOf(requestId)
      return kind !== undefined && current[kind] === requestId
    },
  }
}
