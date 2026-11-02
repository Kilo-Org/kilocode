import { describe, expect, test } from "bun:test"
import { mergeConfigDocuments } from "../webview-ui/src/v2/settings-merge"

describe("mergeConfigDocuments", () => {
  test("takes the last document that defines a key and ignores directories", () => {
    const entries = [
      { type: "directory", path: "/etc/kilo2" },
      { type: "document", info: { theme: "dark", username: "a" } },
      { type: "document", info: { theme: "light" } },
      { type: "directory", path: "/project/.kilo2" },
    ]
    expect(mergeConfigDocuments(entries)).toEqual({ theme: "light", username: "a" })
  })

  test("keeps a key only defined by an earlier document", () => {
    const entries = [
      { type: "document", info: { small_model: { providerID: "kilo", modelID: "x" } } },
      { type: "document", info: { theme: "light" } },
    ]
    expect(mergeConfigDocuments(entries).small_model).toEqual({ providerID: "kilo", modelID: "x" })
  })

  test("returns an empty object without documents", () => {
    expect(mergeConfigDocuments([{ type: "directory", path: "/x" }])).toEqual({})
  })
})
