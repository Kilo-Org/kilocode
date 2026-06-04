import type { WorktreeFileDiff } from "../src/types/messages"

export interface FileTreeNode {
  name: string
  path: string
  children?: FileTreeNode[]
  diff?: WorktreeFileDiff
}

export function buildFileTree(diffs: WorktreeFileDiff[]): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const dirs = new Map<string, FileTreeNode>()

  for (const diff of diffs) {
    const parts = diff.file.split("/")
    const filename = parts.pop()!
    let parent = root
    let accumulated = ""

    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part
      const existing = dirs.get(accumulated)
      if (existing) {
        parent = existing.children!
      } else {
        const node: FileTreeNode = { name: part, path: accumulated, children: [] }
        dirs.set(accumulated, node)
        parent.push(node)
        parent = node.children!
      }
    }

    parent.push({ name: filename, path: diff.file, diff })
  }

  sortTree(root)
  return root
}

/** Sort children at every level: directories first (alphabetically), then files (alphabetically). */
function sortTree(nodes: FileTreeNode[]) {
  nodes.sort((a, b) => {
    const aDir = a.children ? 0 : 1
    const bDir = b.children ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    return a.name.localeCompare(b.name)
  })
  for (const node of nodes) {
    if (node.children) sortTree(node.children)
  }
}

// Flatten single-child directory chains: src/components/ instead of src > components
export function flatten(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.map((node) => {
    if (!node.children) return node
    const flat = flattenChain(node)
    return { ...flat, children: flat.children ? flatten(flat.children) : undefined }
  })
}

export function flattenChain(node: FileTreeNode): FileTreeNode {
  if (!node.children || node.children.length !== 1) return node
  const child = node.children[0]!
  if (!child.children) return node
  return flattenChain({ name: `${node.name}/${child.name}`, path: child.path, children: child.children })
}

/** Return diffs sorted to match the tree's depth-first visual order. */
export function treeOrder(diffs: WorktreeFileDiff[]): WorktreeFileDiff[] {
  if (diffs.length <= 1) return diffs
  const tree = buildFileTree(diffs)
  const result: WorktreeFileDiff[] = []
  function walk(nodes: FileTreeNode[]) {
    for (const node of nodes) {
      if (node.diff) result.push(node.diff)
      if (node.children) walk(node.children)
    }
  }
  walk(tree)
  return result
}
