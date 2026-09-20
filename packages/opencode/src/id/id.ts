import { randomBytes } from "crypto"

const prefixes = {
  job: "job",
  event: "evt",
  session: "ses",
  message: "msg",
  permission: "per",
  question: "que",
  suggestion: "sug", // kilocode_change
  part: "prt",
  pty: "pty",
  tool: "tool",
  workspace: "wrk",
} as const

const LENGTH = 26

// State for monotonic ID generation
let lastTimestamp = 0
let counter = 0
// kilocode_change start - supporting state for the monotonic guard in create().
// The 12 hex digits after the prefix encode (timestamp << 12 | counter), so the
// counter field is exactly 12 bits wide.
const COUNTER_MAX = 0xfff
// Explicit-timestamp callers keep their own counter so that they cannot perturb
// the wall-clock sequence tracked by lastTimestamp/counter.
let explicitCounter = 0
// kilocode_change end

export function ascending(prefix: keyof typeof prefixes, given?: string) {
  return generateID(prefix, "ascending", given)
}

export function descending(prefix: keyof typeof prefixes, given?: string) {
  return generateID(prefix, "descending", given)
}

function generateID(prefix: keyof typeof prefixes, direction: "descending" | "ascending", given?: string): string {
  if (!given) {
    return create(prefixes[prefix], direction)
  }

  if (!given.startsWith(prefixes[prefix])) {
    throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
  }
  return given
}

function randomBase62(length: number): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  let result = ""
  const bytes = randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % 62]
  }
  return result
}

export function create(prefix: string, direction: "descending" | "ascending", timestamp?: number): string {
  // kilocode_change start - guard against a backwards system clock.
  //
  // IDs sort lexicographically and their leading bytes come from the wall clock,
  // so ascending() is only genuinely ascending while Date.now() never moves
  // backwards. In practice it does: VM and WSL2 host resume, laptop
  // suspend/resume, and NTP step corrections all rewind it. The counter was
  // previously reset whenever the timestamp merely *differed* from the last one,
  // so after a rewind this minted IDs that sort BEFORE IDs already handed out.
  // Sessions, messages and parts are persisted and replayed in ID order, so such
  // an ID silently reorders a conversation.
  //
  // Clamp the wall-clock path to the highest timestamp already issued. An
  // explicit timestamp argument is caller-supplied and deliberately deterministic
  // (tests, backfill, migration), so it is neither clamped nor allowed to move
  // the watermark; otherwise a single call with a far-future timestamp would pin
  // every later ID in the process to that value.
  let currentTimestamp: number
  let currentCounter: number

  if (timestamp !== undefined) {
    currentTimestamp = timestamp
    explicitCounter = explicitCounter >= COUNTER_MAX ? 1 : explicitCounter + 1
    currentCounter = explicitCounter
  } else {
    const wall = Date.now()
    currentTimestamp = wall > lastTimestamp ? wall : lastTimestamp

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter++

    if (counter > COUNTER_MAX) {
      // More than COUNTER_MAX ids inside one millisecond. Borrow the next
      // millisecond rather than letting the counter overflow into the timestamp
      // field, so the watermark stays consistent with what has been issued.
      lastTimestamp = currentTimestamp + 1
      currentTimestamp = lastTimestamp
      counter = 1
    }

    currentCounter = counter
  }

  let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(currentCounter)
  // kilocode_change end

  now = direction === "descending" ? ~now : now

  const timeBytes = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }

  return prefix + "_" + timeBytes.toString("hex") + randomBase62(LENGTH - 12)
}

/** Extract timestamp from an ascending ID. Does not work with descending IDs. */
export function timestamp(id: string): number {
  const prefix = id.split("_")[0]
  const hex = id.slice(prefix.length + 1, prefix.length + 13)
  const encoded = BigInt("0x" + hex)
  return Number(encoded / BigInt(0x1000))
}

export * as Identifier from "./id"
