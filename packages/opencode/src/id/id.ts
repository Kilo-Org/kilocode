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
//
// The 12 hex digits after the prefix encode (timestamp << 12 | counter), so the
// counter field is exactly 12 bits wide. Its top bit tags which path minted the
// id, keeping the two paths' ordering keys disjoint by construction: the
// wall-clock path draws from 0x000-0x7ff, an explicit timestamp from
// 0x800-0xfff. One shared counter cannot do that job, because the wall-clock
// path resets it whenever the millisecond advances, and an explicit caller may
// hand back a timestamp that reset has already moved past.
const WALL_COUNTER_MAX = 0x7ff
const EXPLICIT_COUNTER_MIN = 0x800
const EXPLICIT_COUNTER_MAX = 0xfff
// Free-running, and deliberately not reset when the given timestamp changes:
// resetting would hand a caller that revisits an earlier timestamp the very
// counters it already used at that timestamp.
let explicitCounter = EXPLICIT_COUNTER_MAX
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

// kilocode_change start - the two ordering-key sources behind create().

// Wall-clock path, clamped to the highest timestamp already issued so a
// backwards clock cannot mint an id that sorts before one already handed out.
function wallSlot() {
  const wall = Date.now()
  const clamped = wall > lastTimestamp ? wall : lastTimestamp

  if (clamped !== lastTimestamp) {
    lastTimestamp = clamped
    counter = 0
  }
  counter++

  if (counter > WALL_COUNTER_MAX) {
    // More than WALL_COUNTER_MAX ids inside one millisecond. Borrow the next
    // millisecond rather than letting the counter run into the explicit range
    // and then the timestamp field, so the watermark stays consistent with what
    // has been issued.
    lastTimestamp = clamped + 1
    counter = 1
  }

  return { timestamp: lastTimestamp, counter }
}

// Explicit-timestamp path. The value is caller-supplied and deliberately
// deterministic (tests, backfill, migration), so it is used verbatim: neither
// clamped nor allowed to move the watermark. Moving the watermark would let one
// far-future timestamp pin every later id in the process to that value.
function explicitSlot(timestamp: number) {
  explicitCounter = explicitCounter >= EXPLICIT_COUNTER_MAX ? EXPLICIT_COUNTER_MIN : explicitCounter + 1
  return { timestamp, counter: explicitCounter }
}
// kilocode_change end

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
  // Known limitation: the watermark is process-local and starts at 0, so a
  // rewind spanning a restart is not covered. The first ids minted after such a
  // restart use the rewound wall time and can still sort before ids already
  // persisted. Closing that would mean seeding the watermark from stored state,
  // which this synchronous, dependency-free generator cannot reach.
  //
  // `!= null` rather than `!== undefined`, so an explicit null keeps the
  // wall-clock behaviour the previous `timestamp ?? Date.now()` gave it.
  const slot = timestamp != null ? explicitSlot(timestamp) : wallSlot()

  let now = BigInt(slot.timestamp) * BigInt(0x1000) + BigInt(slot.counter)
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
