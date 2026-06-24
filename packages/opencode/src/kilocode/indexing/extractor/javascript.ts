// kilocode_change - new file
// JavaScript/TypeScript relationship extraction from Tree-sitter captures

import type { ExtractedRelationships, ReferenceCapture, Scope } from "./types"
import type { GraphNode, GraphNodeKind, GraphEdge } from "../graph/types"
import { createHash } from "crypto"

function nodeId(filePath: string, name: string, kind: string, line: number): string {
  const base = `${filePath}:${name}:${kind}:${line}`
  return createHash("sha256").update(base).digest("hex").slice(0, 32)
}

function scopeId(filePath: string, scopeStack: Scope[]): string | undefined {
  const top = scopeStack[scopeStack.length - 1]
  if (!top || top.kind === "file") return undefined
  return top.id
}

export function extractFromCaptures(
  filePath: string,
  captures: Array<{ node: { text: string; startPosition: { row: number; column: number }; endPosition: { row: number }; type: string }; name: string }>,
  language: string,
): ExtractedRelationships {
  const nodes: GraphNode[] = []
  const edges: Omit<GraphEdge, "id">[] = []
  const imports: Array<{ sourcePath: string; importedNames: string[]; isDefault: boolean; isNamespace: boolean; filePath: string; line: number }> = []
  const symbols: ExtractedRelationships["symbols"] = []
  const scopeStack: Scope[] = [{ id: `file:${filePath}`, kind: "file", name: filePath }]
  const definitionMap = new Map<string, string>() // name -> nodeId

  for (const capture of captures) {
    const name = capture.name
    const node = capture.node
    const line = node.startPosition.row + 1
    const column = node.startPosition.column
    const text = node.text

    // Skip name-only captures (they're metadata for definitions)
    if (name.includes("name.definition")) continue

    // ─── Definitions ───
    if (name.includes("definition.")) {
      const kind = inferKind(name, language)
      if (!kind) continue

      const identifier = extractIdentifier(text, node.type, name)
      if (!identifier) continue

      const id = nodeId(filePath, identifier, kind, line)
      const parentId = scopeId(filePath, scopeStack)

      const graphNode: GraphNode = {
        id,
        kind,
        name: identifier,
        filePath,
        startLine: line,
        endLine: node.endPosition.row + 1,
        signature: text.slice(0, 200),
        language,
        parentId,
      }

      nodes.push(graphNode)
      definitionMap.set(identifier, id)
      symbols.push({ name: identifier, nodeId: id, filePath, kind, scopeId: parentId, isExported: false })

      // Scope push for containers
      if (kind === "class" || kind === "function" || kind === "method" || kind === "namespace" || kind === "module") {
        scopeStack.push({ id, kind: kind === "class" ? "class" : "function", name: identifier, parent: scopeStack[scopeStack.length - 1] })
      }

      // Contains edge
      if (parentId) {
        edges.push({ from: parentId, to: id, kind: "contains", filePath, line })
      }

      // Inheritance edges
      if (kind === "class" || kind === "interface") {
        const extendsMatch = text.match(/extends\s+([A-Za-z0-9_$]+)/)
        if (extendsMatch) {
          edges.push({ from: id, to: extendsMatch[1], kind: "extends", filePath, line })
        }
        const implementsMatch = text.match(/implements\s+([^{]+)/)
        if (implementsMatch) {
          const interfaces = implementsMatch[1].split(",").map((s) => s.trim())
          for (const iface of interfaces) {
            edges.push({ from: id, to: iface, kind: "implements", filePath, line })
          }
        }
      }

      continue
    }

    // ─── Imports ───
    if (name.includes("import")) {
      const importInfo = extractImport(text, filePath, line)
      if (importInfo) imports.push(importInfo)
      continue
    }

    // ─── Call sites ───
    if (name.includes("call") || text.includes("(")) {
      const calls = extractCallSites(text, filePath, line, column, definitionMap)
      for (const call of calls) {
        const callerId = scopeId(filePath, scopeStack) ?? `file:${filePath}`
        edges.push({
          from: callerId,
          to: call.calleeName,
          kind: "calls",
          filePath,
          line: call.line,
          column: call.column,
        })
      }
      continue
    }
  }

  // Mark exported symbols
  for (const imp of imports) {
    if (imp.isDefault || imp.isNamespace) {
      for (const name of imp.importedNames) {
        const sym = symbols.find((s) => s.name === name)
        if (sym) sym.isExported = true
      }
    }
  }

  return { nodes, edges, imports, symbols }
}

function inferKind(captureName: string, language: string): GraphNodeKind | undefined {
  if (captureName.includes("class")) return "class"
  if (captureName.includes("interface")) return "interface"
  if (captureName.includes("enum")) return "enum"
  if (captureName.includes("function")) return "function"
  if (captureName.includes("method")) return "method"
  if (captureName.includes("constructor")) return "constructor"
  if (captureName.includes("property")) return "property"
  if (captureName.includes("variable")) return "variable"
  if (captureName.includes("module")) return "module"
  if (captureName.includes("namespace")) return "namespace"
  if (captureName.includes("type_alias")) return "type_alias"
  if (captureName.includes("trait")) return "trait"
  if (captureName.includes("struct")) return "struct"
  if (captureName.includes("component")) return "component"
  if (captureName.includes("macro")) return "macro"
  if (captureName.includes("import")) return "import"
  if (captureName.includes("export")) return "export"
  return undefined
}

function extractIdentifier(text: string, nodeType: string, captureName: string): string | undefined {
  // Try to extract name from common patterns
  const patterns = [
    /(?:class|interface|enum|function|const|let|var|type)\s+([A-Za-z0-9_$]+)/,
    /([A-Za-z0-9_$]+)\s*[=:]/,
    /([A-Za-z0-9_$]+)\s*\(/,
    /^([A-Za-z0-9_$]+)$/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }

  // Fallback: first word
  const firstWord = text.trim().split(/\s+/)[0]
  if (firstWord && /^[A-Za-z0-9_$]+$/.test(firstWord)) return firstWord

  return undefined
}

function extractImport(text: string, filePath: string, line: number): { sourcePath: string; importedNames: string[]; isDefault: boolean; isNamespace: boolean; filePath: string; line: number } | undefined {
  // ES6: import { a, b } from 'module'
  const namedMatch = text.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/)
  if (namedMatch) {
    return {
      sourcePath: namedMatch[2],
      importedNames: namedMatch[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()),
      isDefault: false,
      isNamespace: false,
      filePath,
      line,
    }
  }

  // ES6: import Name from 'module'
  const defaultMatch = text.match(/import\s+([A-Za-z0-9_$]+)\s+from\s*['"]([^'"]+)['"]/)
  if (defaultMatch) {
    return {
      sourcePath: defaultMatch[2],
      importedNames: [defaultMatch[1]],
      isDefault: true,
      isNamespace: false,
      filePath,
      line,
    }
  }

  // ES6: import * as Name from 'module'
  const namespaceMatch = text.match(/import\s*\*\s*as\s+([A-Za-z0-9_$]+)\s+from\s*['"]([^'"]+)['"]/)
  if (namespaceMatch) {
    return {
      sourcePath: namespaceMatch[2],
      importedNames: [namespaceMatch[1]],
      isDefault: false,
      isNamespace: true,
      filePath,
      line,
    }
  }

  // CommonJS: require('module')
  const requireMatch = text.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (requireMatch) {
    return {
      sourcePath: requireMatch[1],
      importedNames: [],
      isDefault: true,
      isNamespace: false,
      filePath,
      line,
    }
  }

  return undefined
}

function extractCallSites(
  text: string,
  filePath: string,
  line: number,
  column: number,
  definitionMap: Map<string, string>,
): Array<{ calleeName: string; line: number; column: number; isMemberAccess: boolean; objectName?: string }> {
  const calls: Array<{ calleeName: string; line: number; column: number; isMemberAccess: boolean; objectName?: string }> = []

  // Member access: obj.method()
  const memberCallPattern = /([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\s*\(/g
  let match: RegExpExecArray | null
  while ((match = memberCallPattern.exec(text)) !== null) {
    calls.push({
      calleeName: match[2],
      line,
      column: column + match.index,
      isMemberAccess: true,
      objectName: match[1],
    })
  }

  // Direct calls: functionName()
  const directCallPattern = /\b([A-Za-z0-9_$]+)\s*\(/g
  while ((match = directCallPattern.exec(text)) !== null) {
    // Skip if already captured as member access
    const isMember = text.slice(Math.max(0, match.index - 1), match.index) === "."
    if (isMember) continue

    calls.push({
      calleeName: match[1],
      line,
      column: column + match.index,
      isMemberAccess: false,
    })
  }

  return calls
}
