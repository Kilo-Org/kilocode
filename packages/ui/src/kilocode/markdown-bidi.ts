export function markBidi(root: HTMLElement) {
  // The decoration intentionally only marks direct markdown children. It does
  // not recursively add dir="auto" to nested paragraphs, list items, table
  // cells, or quote contents.
  // This matters because the HTML directionality algorithm for dir=auto skips
  // text inside descendants that already have their own dir attribute.
  // If every nested element gets dir="auto", then a parent list, table, or
  // blockquote may fail to detect its RTL text and keep the wrong direction.
  const blocks = "p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, table"
  for (const child of Array.from(root.children)) {
    if (child.matches(blocks)) child.setAttribute("dir", "auto")
  }

  const code = Array.from(root.querySelectorAll("pre, :not(pre) > code"))
  for (const node of code) {
    node.setAttribute("dir", "auto")
  }
}
