const inserted = new Set([
  "am-markdown-inline-annotations",
  "am-markdown-list-annotation",
  "am-markdown-table-annotation",
])

function isInserted(node: Element): boolean {
  return Array.from(node.classList).some((name) => inserted.has(name))
}

export function markdownRenderedChildren(root: HTMLElement): HTMLElement[] {
  return Array.from(root.children).flatMap((child) => {
    if (isInserted(child)) return []

    const nodes = child.hasAttribute("data-markdown-block") ? Array.from(child.children) : [child]
    return nodes.filter((node) => !isInserted(node)).map((node) => node as HTMLElement)
  })
}
