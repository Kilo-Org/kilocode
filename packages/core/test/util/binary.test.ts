import { describe, expect, test } from "bun:test"
import { Binary } from "@opencode-ai/core/util/binary"

type Item = { id: string }

const item = (id: string): Item => ({ id })
const byId = (i: Item) => i.id

describe("Binary.search", () => {
  test("returns not-found at index 0 for an empty array", () => {
    expect(Binary.search([] as Item[], "a", byId)).toEqual({
      found: false,
      index: 0,
    })
  })

  test("finds the only element of a single-element array", () => {
    expect(Binary.search([item("b")], "b", byId)).toEqual({
      found: true,
      index: 0,
    })
  })

  test("returns the insertion point when the target is smaller than a single element", () => {
    expect(Binary.search([item("b")], "a", byId)).toEqual({
      found: false,
      index: 0,
    })
  })

  test("returns the insertion point when the target is larger than a single element", () => {
    expect(Binary.search([item("b")], "c", byId)).toEqual({
      found: false,
      index: 1,
    })
  })

  test("finds elements at the start, middle, and end", () => {
    const arr = ["a", "b", "c", "d", "e"].map(item)
    expect(Binary.search(arr, "a", byId)).toEqual({ found: true, index: 0 })
    expect(Binary.search(arr, "c", byId)).toEqual({ found: true, index: 2 })
    expect(Binary.search(arr, "e", byId)).toEqual({ found: true, index: 4 })
  })

  test("returns the correct insertion point for missing values", () => {
    const arr = ["a", "c", "e"].map(item)
    // before everything
    expect(Binary.search(arr, "0", byId)).toEqual({ found: false, index: 0 })
    // between a and c
    expect(Binary.search(arr, "b", byId)).toEqual({ found: false, index: 1 })
    // between c and e
    expect(Binary.search(arr, "d", byId)).toEqual({ found: false, index: 2 })
    // after everything
    expect(Binary.search(arr, "z", byId)).toEqual({ found: false, index: 3 })
  })
})

describe("Binary.insert", () => {
  test("inserts into an empty array", () => {
    const arr: Item[] = []
    Binary.insert(arr, item("a"), byId)
    expect(arr.map(byId)).toEqual(["a"])
  })

  test("keeps the array sorted when inserting at the start, middle, and end", () => {
    const arr = ["b", "d"].map(item)
    Binary.insert(arr, item("a"), byId) // start
    Binary.insert(arr, item("c"), byId) // middle
    Binary.insert(arr, item("e"), byId) // end
    expect(arr.map(byId)).toEqual(["a", "b", "c", "d", "e"])
  })

  test("mutates and returns the same array reference", () => {
    const arr: Item[] = [item("a")]
    const returned = Binary.insert(arr, item("b"), byId)
    expect(returned).toBe(arr)
    expect(arr.map(byId)).toEqual(["a", "b"])
  })

  test("inserting unsorted values still yields a fully sorted array", () => {
    const arr: Item[] = []
    for (const id of ["d", "a", "c", "e", "b"]) {
      Binary.insert(arr, item(id), byId)
    }
    expect(arr.map(byId)).toEqual(["a", "b", "c", "d", "e"])
  })

  test("inserts a duplicate id while keeping the array sorted", () => {
    const arr = ["a", "b", "b", "c"].map(item)
    Binary.insert(arr, item("b"), byId)
    expect(arr.map(byId)).toEqual(["a", "b", "b", "b", "c"])
    expect(arr).toHaveLength(5)
  })

  test("an element inserted via Binary.insert is then found by Binary.search", () => {
    const arr = ["a", "c", "e"].map(item)
    Binary.insert(arr, item("d"), byId)
    expect(arr.map(byId)).toEqual(["a", "c", "d", "e"])
    expect(Binary.search(arr, "d", byId)).toEqual({ found: true, index: 2 })
  })
})
