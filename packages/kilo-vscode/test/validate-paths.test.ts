import { describe, expect, it } from "bun:test"
import { chunkPaths } from "../webview-ui/src/v2/validate-paths"

describe("chunkPaths", () => {
  it("keeps small batches whole", () => {
    expect(chunkPaths(["a", "b"], 64)).toEqual([["a", "b"]])
  })

  it("splits oversized batches without dropping or reordering paths", () => {
    const paths = Array.from({ length: 130 }, (_, index) => `file-${index}.ts`)

    const chunks = chunkPaths(paths, 64)

    expect(chunks.map((chunk) => chunk.length)).toEqual([64, 64, 2])
    expect(chunks.flat()).toEqual(paths)
  })

  it("returns no batches for no paths", () => {
    expect(chunkPaths([], 64)).toEqual([])
  })
})
