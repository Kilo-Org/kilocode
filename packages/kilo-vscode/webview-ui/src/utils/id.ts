type Prefix = "message" | "part"

const prefixes: Record<Prefix, string> = {
  message: "msg",
  part: "prt",
}

const RANDOM_LENGTH = 14
let lastTimestamp = 0
let counter = 0

// Browser-side sortable IDs for optimistic queued messages/parts.
// They need to sort the same way as backend-generated IDs so queued turns
// stay in order before SSE catches up.
export const Identifier = {
  ascending(prefix: Prefix) {
    const currentTimestamp = Date.now()

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }

    counter += 1

    // Server uses 6 bytes big-endian (48 bits). Truncate to 12 hex chars
    // to match — without this, the full BigInt produces 14 chars which
    // breaks the server's lexicographic exit condition (lastUser < lastAssistant).
    const sortable = (BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter))
      .toString(16)
      .slice(-12)
      .padStart(12, "0")
    return `${prefixes[prefix]}_${sortable}${randomBase62(RANDOM_LENGTH)}`
  },
}

function randomBase62(length: number) {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const bytes = getRandomBytes(length)
  let result = ""
  for (let i = 0; i < length; i += 1) {
    result += chars[bytes[i] % 62]
  }
  return result
}

function getRandomBytes(length: number) {
  const bytes = new Uint8Array(length)

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes)
    return bytes
  }

  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256)
  }

  return bytes
}
