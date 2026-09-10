import { describe, expect, test } from "bun:test"
import { dataUrlToBlob } from "./markdown-mermaid-data-url"

describe("dataUrlToBlob", () => {
  test("decodes base64 payload and preserves mime type", async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`
    const blob = dataUrlToBlob(dataUrl)

    expect(blob.type).toBe("image/png")
    expect(blob.size).toBe(bytes.length)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  })

  test("defaults mime when the data URL omits it", async () => {
    const blob = dataUrlToBlob(`data:;base64,${Buffer.from("hi").toString("base64")}`)
    expect(blob.type).toBe("application/octet-stream")
    expect(await blob.text()).toBe("hi")
  })

  test("rejects data URLs without a comma separator", () => {
    expect(() => dataUrlToBlob("data:image/png;base64")).toThrow("Unable to export Mermaid diagram.")
  })
})
