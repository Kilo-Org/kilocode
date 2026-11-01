// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"

const realNow = Date.now

function setClock(ms: number) {
  Date.now = () => ms
}

/**
 * The 12 hex digits after the prefix hold (timestamp << 12 | counter) for an
 * ascending id, and that packed field is what lexicographic sorting actually
 * compares. These tests assert on it directly rather than on Identifier.timestamp(),
 * because the field is only 6 bytes wide: a present-day epoch-millisecond needs
 * 41 bits, plus 12 counter bits, so the timestamp a real id carries is truncated
 * to 2 ** 36 - 1. That truncation is pre-existing and orthogonal to ordering,
 * which stays correct inside a wrap window.
 */
function seq(id: string): bigint {
  const prefix = id.split("_")[0]
  return BigInt("0x" + id.slice(prefix.length + 1, prefix.length + 13))
}

afterEach(() => {
  Date.now = realNow
})

describe("Identifier.ascending", () => {
  test("ids ascend while the clock advances", () => {
    const base = realNow()
    const ids = [0, 1, 2, 3].map((offset) => {
      setClock(base + offset)
      return Identifier.ascending("message")
    })

    for (let i = 1; i < ids.length; i++) {
      expect(seq(ids[i])).toBeGreaterThan(seq(ids[i - 1]))
    }
  })

  test("ids still ascend when the system clock steps backwards", () => {
    const base = realNow()

    setClock(base)
    const before = Identifier.ascending("message")

    // A backwards step of the size observed on WSL2 host resume.
    setClock(base - 137_000)
    const after = Identifier.ascending("message")

    expect(seq(after)).toBeGreaterThan(seq(before))
    expect(after > before).toBe(true)
  })

  test("ids ascend across a backwards step and the subsequent recovery", () => {
    const base = realNow()
    const ids: string[] = []

    for (const at of [base, base - 137_000, base - 90_000, base - 1, base + 1, base + 2]) {
      setClock(at)
      ids.push(Identifier.ascending("message"))
    }

    for (let i = 1; i < ids.length; i++) {
      expect(seq(ids[i])).toBeGreaterThan(seq(ids[i - 1]))
    }
  })

  test("a rewound clock does not resurrect an already-issued id", () => {
    const base = realNow()

    setClock(base)
    const first = Identifier.ascending("part")

    setClock(base - 5_000)
    const replayed = Array.from({ length: 50 }, () => Identifier.ascending("part"))

    expect(new Set([first, ...replayed]).size).toBe(51)
    for (const id of replayed) {
      expect(seq(id)).toBeGreaterThan(seq(first))
    }
  })

  test("a frozen clock still yields unique, strictly ascending ids", () => {
    setClock(realNow())
    const ids = Array.from({ length: 200 }, () => Identifier.ascending("part"))

    expect(new Set(ids).size).toBe(ids.length)
    for (let i = 1; i < ids.length; i++) {
      expect(seq(ids[i])).toBeGreaterThan(seq(ids[i - 1]))
    }
  })

  test("the counter does not overflow into the timestamp field", () => {
    // More ids in one millisecond than the wall-clock counter can hold (0x7ff).
    setClock(realNow())
    const ids = Array.from({ length: 4_200 }, () => Identifier.ascending("part"))

    expect(new Set(ids).size).toBe(ids.length)
    for (let i = 1; i < ids.length; i++) {
      expect(seq(ids[i])).toBeGreaterThan(seq(ids[i - 1]))
    }

    // The watermark must have absorbed the overflow, so the next id at the same
    // frozen instant still sorts last.
    const next = Identifier.ascending("part")
    expect(seq(next)).toBeGreaterThan(seq(ids[ids.length - 1]))
  })
})

describe("Identifier.create with an explicit timestamp", () => {
  test("uses the given timestamp verbatim rather than clamping it", () => {
    setClock(realNow())
    Identifier.ascending("message")

    expect(Identifier.timestamp(Identifier.create("tool", "ascending", 5_000))).toBe(5_000)
  })

  test("round-trips the largest representable timestamp", () => {
    // Pins the packing width: the timestamp field saturates at 2 ** 36 - 1.
    const max = 2 ** 36 - 1
    expect(Identifier.timestamp(Identifier.create("tool", "ascending", max))).toBe(max)
  })

  test("explicit ids order by their given timestamps", () => {
    const older = Identifier.create("tool", "ascending", 5_000)
    const newer = Identifier.create("tool", "ascending", 6_000)
    expect(seq(newer)).toBeGreaterThan(seq(older))
  })

  test("a far-future explicit timestamp does not pin later wall-clock ids", () => {
    // Regression guard. test/tool/truncation.test.ts mints ids around 2 ** 36.
    // If such a call moved the monotonic watermark, every later wall-clock id in
    // the process would be pinned to that far-future instant.
    const base = realNow()

    setClock(base)
    const before = Identifier.ascending("message")

    Identifier.create("tool", "ascending", 2 ** 36 - 1)

    setClock(base)
    const after = Identifier.ascending("message")

    expect(seq(after)).toBeGreaterThan(seq(before))
    // Same frozen millisecond, so the two ids differ only in the counter rather
    // than by decades of packed timestamp space.
    expect(seq(after) - seq(before)).toBeLessThan(4096n)
  })
})

describe("Identifier.descending", () => {
  test("ids descend while the clock advances", () => {
    const base = realNow()

    setClock(base)
    const first = Identifier.descending("message")
    setClock(base + 1)
    const second = Identifier.descending("message")

    expect(seq(second)).toBeLessThan(seq(first))
    expect(second < first).toBe(true)
  })

  test("a backwards clock step does not break descending order", () => {
    const base = realNow()

    setClock(base)
    const first = Identifier.descending("message")
    setClock(base - 137_000)
    const second = Identifier.descending("message")

    expect(seq(second)).toBeLessThan(seq(first))
  })
})

describe("Identifier prefix handling", () => {
  test("passes through a well-formed given id", () => {
    const given = Identifier.ascending("message")
    expect(Identifier.ascending("message", given)).toBe(given)
  })

  test("rejects a given id whose prefix does not match", () => {
    const given = Identifier.ascending("message")
    expect(() => Identifier.ascending("session", given)).toThrow()
  })
})

/**
 * The counter occupies the low 12 bits of the packed ordering key. Its top bit
 * tags the minting path, so the wall-clock and explicit ranges never overlap.
 */
const COUNTER_MASK = 0xfffn
const EXPLICIT_COUNTER_MIN = 0x800n

describe("Identifier.create counter partitioning", () => {
  test("a null timestamp behaves like an absent one", () => {
    const base = realNow()
    setClock(base)
    const before = Identifier.ascending("message")

    // A value the type system believes is `number | undefined` but that is null
    // at runtime, which is what deserialized JSON yields and what the original
    // `timestamp ?? Date.now()` tolerated. Routing it to the explicit branch
    // instead makes BigInt(null) throw.
    const restored: { timestamp?: number } = JSON.parse('{"timestamp":null}')
    const withNull = Identifier.create("tool", "ascending", restored.timestamp)

    expect(seq(withNull)).toBeGreaterThan(seq(before))
  })

  test("wall-clock and explicit ids draw from disjoint counter ranges", () => {
    // Disjoint ranges are strictly stronger than probing one collision case:
    // they make it impossible for the two paths to pack the same
    // (timestamp << 12 | counter) ordering key at any millisecond.
    const base = realNow()
    setClock(base)

    for (let i = 0; i < 64; i++) {
      expect(seq(Identifier.ascending("message")) & COUNTER_MASK).toBeLessThan(EXPLICIT_COUNTER_MIN)
      expect(seq(Identifier.create("tool", "ascending", base)) & COUNTER_MASK).toBeGreaterThanOrEqual(
        EXPLICIT_COUNTER_MIN,
      )
    }
  })

  test("an explicit id never re-issues a wall-clock ordering key in the same millisecond", () => {
    const base = realNow()
    setClock(base)

    const keys = new Set<bigint>()
    for (let i = 0; i < 256; i++) {
      keys.add(seq(Identifier.ascending("message")))
      keys.add(seq(Identifier.create("tool", "ascending", base)))
    }

    expect(keys.size).toBe(512)
  })

  test("the explicit counter stays inside its own range as it wraps", () => {
    const keys = Array.from({ length: 2_100 }, () => seq(Identifier.create("tool", "ascending", 8_000)) & COUNTER_MASK)

    for (const key of keys) {
      expect(key).toBeGreaterThanOrEqual(EXPLICIT_COUNTER_MIN)
      expect(key).toBeLessThanOrEqual(COUNTER_MASK)
    }

    // 2048 slots, so a full cycle is distinct before it has to repeat.
    expect(new Set(keys.slice(0, 2_048)).size).toBe(2_048)
  })

  test("one explicit timestamp yields 2048 ordering keys before the sequence repeats", () => {
    // The documented ceiling, asserted rather than only described. The counter
    // is free-running, so this holds from whatever phase earlier tests left it
    // in: 2048 consecutive calls are distinct and the 2049th repeats the first.
    const keys = Array.from({ length: 2_049 }, () => seq(Identifier.create("tool", "ascending", 11_000)))

    expect(new Set(keys.slice(0, 2_048)).size).toBe(2_048)
    expect(keys[2_048]).toBe(keys[0])
  })

  test("revisiting an earlier explicit timestamp does not repeat its counters", () => {
    const first = seq(Identifier.create("tool", "ascending", 9_000))
    Identifier.create("tool", "ascending", 10_000)
    Identifier.ascending("message")
    const second = seq(Identifier.create("tool", "ascending", 9_000))

    expect(second).not.toBe(first)
  })
})
