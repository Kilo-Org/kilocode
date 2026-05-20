/**
 * bits.ts — Bitmask property system for efficient attribute storage (lipgloss pattern)
 *
 * Each property is a bit in a 32-bit integer. Enables O(1) checks,
 * efficient diffing (XOR), and clean inline/uninline operations.
 * Zero deps.
 */

export class Bits {
  constructor(private mask = 0) {}

  /** Set a bit (0-31). */
  on(bit: number): Bits {
    return new Bits(this.mask | (1 << bit))
  }

  /** Clear a bit. */
  off(bit: number): Bits {
    return new Bits(this.mask & ~(1 << bit))
  }

  /** Toggle a bit. */
  toggle(bit: number): Bits {
    return new Bits(this.mask ^ (1 << bit))
  }

  /** Check if a bit is set. */
  has(bit: number): boolean {
    return (this.mask & (1 << bit)) !== 0
  }

  /** Diff with another Bits — returns bits that differ. */
  diff(other: Bits): Bits {
    return new Bits(this.mask ^ other.mask)
  }

  /** Merge bits from another Bits (OR). */
  merge(other: Bits): Bits {
    return new Bits(this.mask | other.mask)
  }

  /** Check if this has all bits from another set. */
  contains(other: Bits): boolean {
    return (this.mask & other.mask) === other.mask
  }

  /** Raw numeric value. */
  raw(): number {
    return this.mask
  }

  /** Number of set bits. */
  count(): number {
    let n = this.mask
    let c = 0
    while (n) { c++; n &= n - 1 }
    return c
  }

  /** Are any bits set? */
  get empty(): boolean {
    return this.mask === 0
  }

  /** Iterate over set bit positions. */
  *[Symbol.iterator](): Generator<number> {
    let m = this.mask
    let i = 0
    while (m) {
      if (m & 1) yield i
      m >>>= 1
      i++
    }
  }
}
