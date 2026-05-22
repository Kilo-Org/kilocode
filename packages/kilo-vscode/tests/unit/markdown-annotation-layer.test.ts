import { describe, expect, it } from "bun:test"
import { isAnnotationMutation } from "../../webview-ui/agent-manager/markdown-annotation-mutation"

function mutation(target: Node): Pick<MutationRecord, "target"> {
  return { target }
}

describe("isAnnotationMutation", () => {
  it("matches nested annotation DOM mutations", () => {
    const target = { closest: () => ({}) } as unknown as Node
    expect(isAnnotationMutation(mutation(target))).toBe(true)
  })

  it("keeps external Markdown DOM mutations observable", () => {
    const markdown = { closest: () => null } as unknown as Node
    const plain = {} as Node
    expect(isAnnotationMutation(mutation(markdown))).toBe(false)
    expect(isAnnotationMutation(mutation(plain))).toBe(false)
  })
})
