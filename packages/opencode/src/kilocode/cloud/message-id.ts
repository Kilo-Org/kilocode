const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
const LENGTH = 14

export function createMessageId(now = Date.now()) {
  const prefix = BigInt(now).toString(16).padStart(12, "0").slice(-12)
  const suffix = Array.from(
    crypto.getRandomValues(new Uint8Array(LENGTH)),
    (byte) => ALPHABET[byte % ALPHABET.length],
  ).join("")
  return `msg_${prefix}${suffix}`
}
