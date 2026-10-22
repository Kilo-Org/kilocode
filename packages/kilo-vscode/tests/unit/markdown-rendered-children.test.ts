import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { markdownRenderedChildren } from "../../webview-ui/diff-viewer/markdown-rendered-children"

const window = new Window()

describe("markdownRenderedChildren", () => {
  it("flattens the current renderer block wrapper", () => {
    const root = window.document.createElement("div")
    root.innerHTML = `
      <div data-markdown-block>
        <h1>Heading</h1>
        <p>Paragraph</p>
        <ul><li>Item</li></ul>
        <table><tbody><tr><td>Cell</td></tr></tbody></table>
      </div>
    `

    expect(markdownRenderedChildren(root).map((node) => node.tagName)).toEqual(["H1", "P", "UL", "TABLE"])
  })

  it("preserves legacy top-level blocks and ignores inserted annotations", () => {
    const root = window.document.createElement("div")
    root.innerHTML = `
      <h1>Heading</h1>
      <div class="am-markdown-inline-annotations"></div>
      <p>Paragraph</p>
      <div data-markdown-block>
        <div class="am-markdown-inline-annotations"></div>
        <blockquote>Quote</blockquote>
      </div>
    `

    expect(markdownRenderedChildren(root).map((node) => node.tagName)).toEqual(["H1", "P", "BLOCKQUOTE"])
  })
})
