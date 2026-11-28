import { describe, test, expect, mock } from "bun:test"
import fc from "fast-check"
import { createHash } from "crypto"

// These properties cover pure helpers only. Stub the client library so the module loads
// on platforms where @valkey/valkey-glide has no native binding (Windows).
mock.module("@valkey/valkey-glide", () => ({
  GlideClient: {},
  GlideFt: {},
  Batch: class {},
  RequestError: class extends Error {},
  ClosingError: class extends Error {},
}))

const { ValkeyVectorStore } = await import("../../../../src/indexing/vector-store/valkey-vector-store")

/**
 * Property-based tests for ValkeyVectorStore pure utility functions.
 */

const PROPERTY_ITERATIONS = 100

function createStore() {
  return new ValkeyVectorStore("/dummy/workspace", "redis://localhost:6379", 128)
}

const hostStringArb = fc.stringMatching(/^[a-z0-9.\-:]+$/, { minLength: 1, maxLength: 50 })
const pathSegmentArb = fc.stringMatching(/^[a-z0-9_\-.]+$/, { minLength: 1, maxLength: 20 })

// Includes ValkeySearch metacharacters to test sanitization coverage
const metaCharPathSegmentArb = fc
  .stringMatching(/^[a-z0-9_\-.@,!~[\]"']+$/, { minLength: 1, maxLength: 20 })
  .filter((s) => !s.includes("=>"))

// Excludes lone "." since buildDirectoryFilter treats it as "no filter"
// Only generates characters that won't be escaped by sanitizeTagValue
const dirSegmentArb = fc.stringMatching(/^[a-z0-9_]+$/, { minLength: 1, maxLength: 20 })

describe("ValkeyVectorStore Property Tests", () => {
  describe("Collection name determinism", () => {
    test("collection name equals 'ws-' + sha256(path).hex.substring(0, 16)", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (workspacePath) => {
          const store = new ValkeyVectorStore(workspacePath, "redis://localhost:6379", 128)
          const expectedHash = createHash("sha256").update(workspacePath).digest("hex")
          const expectedName = `ws-${expectedHash.substring(0, 16)}`

          expect(store.getCollectionName()).toBe(expectedName)
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("collection name is deterministic (same input produces same output)", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (workspacePath) => {
          const store1 = new ValkeyVectorStore(workspacePath, "redis://localhost:6379", 128)
          const store2 = new ValkeyVectorStore(workspacePath, "redis://localhost:6379", 128)

          expect(store1.getCollectionName()).toBe(store2.getCollectionName())
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })
  })

  describe("URL normalization preserves or adds scheme", () => {
    const store = createStore()

    test("output always starts with redis:// or rediss://", () => {
      fc.assert(
        fc.property(hostStringArb, (hostInput) => {
          const result = store.normalizeUrl(hostInput)
          expect(result.startsWith("redis://") || result.startsWith("rediss://")).toBe(true)
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("existing redis:// scheme is preserved", () => {
      fc.assert(
        fc.property(hostStringArb, (host) => {
          const input = `redis://${host}`
          const result = store.normalizeUrl(input)
          expect(result).toBe(input)
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("existing rediss:// scheme is preserved", () => {
      fc.assert(
        fc.property(hostStringArb, (host) => {
          const input = `rediss://${host}`
          const result = store.normalizeUrl(input)
          expect(result).toBe(input)
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("input without scheme gets redis:// prepended", () => {
      fc.assert(
        fc.property(
          hostStringArb.filter((s) => !s.startsWith("redis://") && !s.startsWith("rediss://")),
          (hostWithoutScheme) => {
            const result = store.normalizeUrl(hostWithoutScheme)
            expect(result).toBe(`redis://${hostWithoutScheme}`)
          },
        ),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })
  })

  describe("FLOAT32 vector encoding round-trip", () => {
    const store = createStore()

    test("encode then decode equals Math.fround(x) for each element", () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: -1e30, max: 1e30, noNaN: true, noDefaultInfinity: true }), {
            minLength: 1,
            maxLength: 512,
          }),
          (vector) => {
            const encoded = store.encodeVector(vector)
            const decoded = store.decodeVector(encoded)

            expect(decoded.length).toBe(vector.length)
            for (let i = 0; i < vector.length; i++) {
              expect(decoded[i]).toBe(Math.fround(vector[i]))
            }
          },
        ),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("encoded buffer has correct byte length (4 bytes per float)", () => {
      fc.assert(
        fc.property(
          fc.array(fc.double({ min: -1e30, max: 1e30, noNaN: true, noDefaultInfinity: true }), {
            minLength: 0,
            maxLength: 256,
          }),
          (vector) => {
            const encoded = store.encodeVector(vector)
            expect(encoded.length).toBe(vector.length * 4)
          },
        ),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })
  })

  describe("Path segment extraction is capped at 5", () => {
    const store = createStore()

    test("any path produces at most 5 segments", () => {
      fc.assert(
        fc.property(fc.array(pathSegmentArb, { minLength: 1, maxLength: 20 }), (pathParts) => {
          const filePath = pathParts.join("/")
          const segments = store.splitPathSegments(filePath)
          const segmentCount = Object.keys(segments).length

          expect(segmentCount).toBeLessThanOrEqual(5)
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("segment keys are seg0 through seg4", () => {
      fc.assert(
        fc.property(fc.array(pathSegmentArb, { minLength: 1, maxLength: 20 }), (pathParts) => {
          const filePath = pathParts.join("/")
          const segments = store.splitPathSegments(filePath)
          const validKeys = ["seg0", "seg1", "seg2", "seg3", "seg4"]

          for (const key of Object.keys(segments)) {
            expect(validKeys).toContain(key)
          }
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("segments match the first N parts of the path (up to 5)", () => {
      fc.assert(
        fc.property(fc.array(pathSegmentArb, { minLength: 1, maxLength: 20 }), (pathParts) => {
          const filePath = pathParts.join("/")
          const segments = store.splitPathSegments(filePath)
          const expectedCount = Math.min(pathParts.length, 5)

          expect(Object.keys(segments).length).toBe(expectedCount)
          for (let i = 0; i < expectedCount; i++) {
            expect(segments[`seg${i}`]).toBe(pathParts[i])
          }
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })
  })

  describe("Directory prefix normalization", () => {
    const store = createStore()

    test("backslashes are replaced with forward slashes in output", () => {
      fc.assert(
        fc.property(fc.array(dirSegmentArb, { minLength: 1, maxLength: 5 }), (pathParts) => {
          const backslashPath = pathParts.join("\\")
          const result = store.buildDirectoryFilter(backslashPath)
          for (let i = 0; i < Math.min(pathParts.length, 5); i++) {
            expect(result).toContain(`@seg${i}:{${pathParts[i]}}`)
          }
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("leading './' is removed", () => {
      fc.assert(
        fc.property(fc.array(dirSegmentArb, { minLength: 1, maxLength: 5 }), (pathParts) => {
          const withDotSlash = `./${pathParts.join("/")}`
          const withoutDotSlash = pathParts.join("/")

          const resultWith = store.buildDirectoryFilter(withDotSlash)
          const resultWithout = store.buildDirectoryFilter(withoutDotSlash)

          expect(resultWith).toBe(resultWithout)
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("same segments regardless of separator style (forward slash vs backslash)", () => {
      fc.assert(
        fc.property(fc.array(dirSegmentArb, { minLength: 1, maxLength: 5 }), (pathParts) => {
          const forwardSlashPath = pathParts.join("/")
          const backslashPath = pathParts.join("\\")

          const resultForward = store.buildDirectoryFilter(forwardSlashPath)
          const resultBackslash = store.buildDirectoryFilter(backslashPath)

          expect(resultForward).toBe(resultBackslash)
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("'.' and empty string produce no directory filter", () => {
      expect(store.buildDirectoryFilter(".")).toBe("(@type:{point})")
      expect(store.buildDirectoryFilter("")).toBe("(@type:{point})")
      expect(store.buildDirectoryFilter("./")).toBe("(@type:{point})")
    })
  })
  describe("TAG value sanitization rejects injection vectors", () => {
    const store = createStore()

    test("strings containing '=>' always throw", () => {
      fc.assert(
        fc.property(fc.tuple(fc.string(), fc.string()), ([prefix, suffix]) => {
          const input = `${prefix}=>${suffix}`
          expect(() => store.sanitizeTagValue(input)).toThrow()
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("metacharacters are escaped with backslash", () => {
      const metacharacters = ["{", "}", "|", "\\", "*", "?", "(", ")", "@", "!", "~", "[", "]", ",", ".", '"', "'", "-"]

      fc.assert(
        fc.property(
          fc.constantFrom(...metacharacters),
          fc.string({ minLength: 0, maxLength: 10 }).filter((s) => !s.includes("=>")),
          fc.string({ minLength: 0, maxLength: 10 }).filter((s) => !s.includes("=>")),
          (meta, prefix, suffix) => {
            const input = `${prefix}${meta}${suffix}`
            if (input.includes("=>")) return

            const result = store.sanitizeTagValue(input)
            expect(result).toContain(`\\${meta}`)
          },
        ),
        { numRuns: 500 },
      )
    })

    test("comma is escaped to prevent tag separator injection", () => {
      const result = store.sanitizeTagValue("file,backup.ts")
      expect(result).toContain("\\,")
      expect(result).not.toMatch(/(?<!\\),/)
    })

    test("@ is escaped to prevent field reference injection", () => {
      const result = store.sanitizeTagValue("user@domain")
      expect(result).toContain("\\@")
    })

    test("output never contains unescaped => sequence", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes("=>")),
          (input) => {
            const result = store.sanitizeTagValue(input)
            expect(result.includes("=>")).toBe(false)
          },
        ),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })

    test("paths with ValkeySearch metacharacters are fully escaped", () => {
      fc.assert(
        fc.property(metaCharPathSegmentArb, (input) => {
          const result = store.sanitizeTagValue(input)
          // All metacharacters should be escaped
          const unescapedMeta = result.match(/(?<!\\)[@,!~[\]"']/g)
          expect(unescapedMeta).toBeNull()
        }),
        { numRuns: 500 },
      )
    })

    test("strings without metacharacters pass through unchanged", () => {
      const safeCharArb = fc.stringMatching(/^[a-z0-9_ /]+$/, { minLength: 1, maxLength: 30 })

      fc.assert(
        fc.property(safeCharArb, (safeInput) => {
          if (safeInput.includes("=>")) return
          const result = store.sanitizeTagValue(safeInput)
          expect(result).toBe(safeInput)
        }),
        { numRuns: PROPERTY_ITERATIONS },
      )
    })
  })
})
