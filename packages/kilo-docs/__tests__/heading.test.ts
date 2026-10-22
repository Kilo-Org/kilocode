import { Tag } from "@markdoc/markdoc"
import { describe, expect, it } from "vitest"
import { heading } from "../markdoc/nodes/heading.markdoc"

describe("heading", () => {
  it("includes inline code text in generated ids", () => {
    const tag = heading.transform(
      {
        transformAttributes: () => ({}),
        transformChildren: () => [new Tag("code", {}, ["kilo-auto/frontier"])],
      },
      {},
    )

    expect(tag.attributes.id).toBe("kilo-autofrontier")
  })
})
