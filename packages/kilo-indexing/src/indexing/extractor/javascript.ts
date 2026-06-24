// kilocode_change - new file
// JavaScript/TypeScript relationship extractor for native graph indexing

import type { GraphNode, GraphEdge } from "../graph/types"

export interface ExtractedGraph {
  nodes: GraphNode[]
  edges: Omit<GraphEdge, "id">[]
  symbols: Array<{ name: string; nodeId: string; filePath: string; kind: GraphNode["kind"]; scopeId?: string; isExported?: boolean }>
  imports: Array<{ sourcePath: string; importedNames: string[]; isDefault: boolean; isNamespace: boolean; filePath: string; line: number }>
}

export function extractJavaScriptGraph(
  captures: Array<{ name: string; node: { text: string; startPosition: { row: number; column: number }; endPosition: { row: number; column: number } } }>,
  filePath: string,
  language: string,
): ExtractedGraph {
  const nodes: GraphNode[] = []
  const edges: Omit<GraphEdge, "id">[] = []
  const symbols: ExtractedGraph["symbols"] = []
  const imports: ExtractedGraph["imports"] = []
  const scopeStack: string[] = []
  const nodeMap = new Map<string, GraphNode>()

  const makeId = (kind: string, name: string, line: number) => `${filePath}:${kind}:${name}:${line}`

  const addNode = (kind: GraphNode["kind"], name: string, startLine: number, endLine: number, signature?: string, parentId?: string): GraphNode => {
    const id = makeId(kind, name, startLine)
    const node: GraphNode = { id, kind, name, filePath, startLine, endLine, signature, language, parentId }
    nodes.push(node)
    nodeMap.set(id, node)
    if (parentId) edges.push({ from: parentId, to: id, kind: "contains", filePath, line: startLine })
    return node
  }

  const addSymbol = (name: string, nodeId: string, kind: GraphNode["kind"], scopeId?: string, isExported = false) => {
    symbols.push({ name, nodeId, filePath, kind, scopeId, isExported })
  }

  for (const capture of captures) {
    const text = capture.node.text
    const startLine = capture.node.startPosition.row + 1
    const endLine = capture.node.endPosition.row + 1

    switch (capture.name) {
      case "definition.function": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("function", text, startLine, endLine, undefined, parent)
        scopeStack.push(node.id)
        addSymbol(text, node.id, "function", parent)
        break
      }
      case "definition.method": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("method", text, startLine, endLine, undefined, parent)
        scopeStack.push(node.id)
        addSymbol(text, node.id, "method", parent)
        break
      }
      case "definition.class": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("class", text, startLine, endLine, undefined, parent)
        scopeStack.push(node.id)
        addSymbol(text, node.id, "class", parent)
        break
      }
      case "definition.interface": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("interface", text, startLine, endLine, undefined, parent)
        scopeStack.push(node.id)
        addSymbol(text, node.id, "interface", parent)
        break
      }
      case "definition.enum": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("enum", text, startLine, endLine, undefined, parent)
        scopeStack.push(node.id)
        addSymbol(text, node.id, "enum", parent)
        break
      }
      case "definition.type": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("type_alias", text, startLine, endLine, undefined, parent)
        addSymbol(text, node.id, "type_alias", parent)
        break
      }
      case "definition.variable": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("variable", text, startLine, endLine, undefined, parent)
        addSymbol(text, node.id, "variable", parent)
        break
      }
      case "definition.constant": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("constant", text, startLine, endLine, undefined, parent)
        addSymbol(text, node.id, "constant", parent)
        break
      }
      case "definition.property": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("property", text, startLine, endLine, undefined, parent)
        addSymbol(text, node.id, "property", parent)
        break
      }
      case "definition.field": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("field", text, startLine, endLine, undefined, parent)
        addSymbol(text, node.id, "field", parent)
        break
      }
      case "definition.constructor": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("constructor", text, startLine, endLine, undefined, parent)
        addSymbol(text, node.id, "constructor", parent)
        break
      }
      case "definition.namespace": {
        const parent = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        const node = addNode("namespace", text, startLine, endLine, undefined, parent)
        scopeStack.push(node.id)
        addSymbol(text, node.id, "namespace", parent)
        break
      }
      case "call.function": {
        const caller = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        if (caller) {
          edges.push({ from: caller, to: text, kind: "calls", filePath, line: startLine })
        }
        break
      }
      case "call.method": {
        const caller = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        if (caller) {
          edges.push({ from: caller, to: text, kind: "calls", filePath, line: startLine })
        }
        break
      }
      case "inheritance.extends": {
        const child = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        if (child) {
          edges.push({ from: child, to: text, kind: "extends", filePath, line: startLine })
        }
        break
      }
      case "inheritance.implements": {
        const child = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
        if (child) {
          edges.push({ from: child, to: text, kind: "implements", filePath, line: startLine })
        }
        break
      }
      case "import.source": {
        const importInfo = { sourcePath: text, importedNames: [] as string[], isDefault: false, isNamespace: false, filePath, line: startLine }
        imports.push(importInfo)
        break
      }
      case "import.name": {
        if (imports.length > 0) imports[imports.length - 1].importedNames.push(text)
        break
      }
      case "import.default": {
        if (imports.length > 0) imports[imports.length - 1].isDefault = true
        break
      }
      case "import.namespace": {
        if (imports.length > 0) imports[imports.length - 1].isNamespace = true
        break
      }
      case "export.name": {
        const lastNode = nodes[nodes.length - 1]
        if (lastNode) addSymbol(lastNode.name, lastNode.id, lastNode.kind, undefined, true)
        break
      }
      case "scope.end": {
        scopeStack.pop()
        break
      }
    }
  }

  return { nodes, edges, symbols, imports }
}
