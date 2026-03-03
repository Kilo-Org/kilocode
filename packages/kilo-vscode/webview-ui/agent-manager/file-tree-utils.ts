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

  return root
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
