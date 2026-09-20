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
    // More ids in one millisecond than the 12-bit counter can hold (0xfff).
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
