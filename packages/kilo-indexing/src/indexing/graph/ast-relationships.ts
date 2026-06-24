// kilocode_change - new file
// AST tree-walker for extracting code relationships (calls, imports, extends, exports)
// This performs a SECOND PASS over the AST after definition captures, similar to
// how GitNexus (parse → crossFile → scopeResolution) and Graphify work.

export interface AstRelationship {
  kind: "calls" | "imports" | "extends" | "implements" | "exports" | "references"
  from: string       // symbol name or file path
  to: string         // symbol name or file path
  fromFile: string
  line: number
  column?: number
  confidence: "extracted" | "inferred"
}

export interface RelationshipResult {
  calls: Array<{ caller: string; callee: string; line: number; column: number }>
  imports: Array<{ source: string; names: string[]; isDefault: boolean; isNamespace: boolean; line: number }>
  extends: Array<{ child: string; parent: string; line: number }>
  implements: Array<{ child: string; interface: string; line: number }>
  exports: Array<{ name: string; line: number; isDefault: boolean }>
  references: Array<{ name: string; line: number; column: number }>
}

/**
 * Walk a Tree-sitter AST and extract relationships.
 * This is language-agnostic at the top level but dispatches to language-specific walkers.
 */
export function extractRelationships(
  tree: any,
  filePath: string,
  language: string,
): RelationshipResult {
  const result: RelationshipResult = {
    calls: [],
    imports: [],
    extends: [],
    implements: [],
    exports: [],
    references: [],
  }

  if (!tree || !tree.rootNode) return result

  const isJsTs = language === "js" || language === "jsx" || language === "ts" || language === "tsx" ||
    language === "javascript" || language === "typescript"

  if (isJsTs) {
    walkJavaScriptTree(tree.rootNode, filePath, result)
  } else {
    // Generic walker for other languages - extracts common patterns
    walkGenericTree(tree.rootNode, filePath, result)
  }

  return result
}

function walkJavaScriptTree(node: any, filePath: string, result: RelationshipResult): void {
  if (!node) return

  const type = node.type
  const line = (node.startPosition?.row ?? 0) + 1
  const column = (node.startPosition?.column ?? 0) + 1

  switch (type) {
    // Import statements
    case "import_statement": {
      const sourceNode = node.childForFieldName("source")
      const source = sourceNode ? stripQuotes(sourceNode.text) : ""
      const specifiers = node.children.filter((c: any) => c.type === "import_specifier" || c.type === "identifier" || c.type === "namespace_import")
      const names: string[] = []
      let isDefault = false
      let isNamespace = false

      for (const spec of specifiers) {
        if (spec.type === "namespace_import") {
          isNamespace = true
          const name = spec.childForFieldName("name")?.text || spec.text
          if (name) names.push(name)
        } else if (spec.type === "import_specifier") {
          const name = spec.childForFieldName("name")?.text
          if (name) names.push(name)
        } else if (spec.type === "identifier" && spec !== sourceNode) {
          isDefault = true
          names.push(spec.text)
        }
      }

      if (source && names.length > 0) {
        result.imports.push({ source, names, isDefault, isNamespace, line })
      } else if (source) {
        // Side-effect import: import "foo"
        result.imports.push({ source, names: [], isDefault: false, isNamespace: false, line })
      }
      break
    }

    // require() calls
    case "call_expression": {
      const func = node.childForFieldName("function")
      if (func && func.text === "require") {
        const args = node.childForFieldName("arguments")
        const arg = args?.children?.find((c: any) => c.type === "string")
        if (arg) {
          result.imports.push({
            source: stripQuotes(arg.text),
            names: [],
            isDefault: true,
            isNamespace: false,
            line,
          })
        }
      } else if (func) {
        // Regular function call
        const callee = extractCalleeName(func)
        if (callee) {
          result.calls.push({ caller: "", callee, line, column })
        }
      }
      break
    }

    // Class extends
    case "class_declaration":
    case "class": {
      const name = node.childForFieldName("name")?.text
      const heritage = node.children.find((c: any) => c.type === "class_heritage")
      if (heritage && name) {
        const extendsClause = heritage.children.find((c: any) => c.type === "extends_clause")
        if (extendsClause) {
          const parent = extendsClause.children.find((c: any) =>
            c.type === "identifier" || c.type === "type_identifier" || c.type === "member_expression",
          )
          if (parent) {
            result.extends.push({ child: name, parent: extractMemberExpression(parent), line })
          }
        }
        const implementsClause = heritage.children.find((c: any) => c.type === "implements_clause")
        if (implementsClause) {
          for (const child of implementsClause.children) {
            if (child.type === "identifier" || child.type === "type_identifier") {
              result.implements.push({ child: name, interface: child.text, line })
            }
          }
        }
      }
      break
    }

    // Export statements
    case "export_statement": {
      const decl = node.childForFieldName("declaration")
      if (decl) {
        const name = decl.childForFieldName("name")?.text
        if (name) {
          result.exports.push({ name, line, isDefault: false })
        }
      }
      const specifiers = node.children.filter((c: any) => c.type === "export_specifier")
      for (const spec of specifiers) {
        const name = spec.childForFieldName("name")?.text
        if (name) {
          result.exports.push({ name, line, isDefault: false })
        }
      }
      break
    }

    // Default export
    case "export_default_declaration": {
      const decl = node.childForFieldName("declaration")
      const name = decl?.childForFieldName("name")?.text || "default"
      result.exports.push({ name, line, isDefault: true })
      break
    }
  }

  // Recurse into children
  for (const child of node.children || []) {
    walkJavaScriptTree(child, filePath, result)
  }
}

function walkGenericTree(node: any, filePath: string, result: RelationshipResult): void {
  if (!node) return

  const type = node.type
  const line = (node.startPosition?.row ?? 0) + 1

  // Generic call expression detection
  if (type === "call_expression") {
    const func = node.childForFieldName("function")
    if (func) {
      const callee = extractCalleeName(func)
      if (callee) {
        result.calls.push({ caller: "", callee, line, column: (node.startPosition?.column ?? 0) + 1 })
      }
    }
  }

  // Generic import detection
  if (type.includes("import") || type === "import_statement" || type === "import_declaration") {
    const sourceNode = node.childForFieldName("source") || node.children.find((c: any) => c.type.includes("string"))
    if (sourceNode) {
      result.imports.push({
        source: stripQuotes(sourceNode.text),
        names: [],
        isDefault: false,
        isNamespace: false,
        line,
      })
    }
  }

  // Generic class inheritance
  if (type.includes("class") && type !== "class_body") {
    const name = node.childForFieldName("name")?.text
    const parent = node.children.find((c: any) =>
      c.type.includes("extends") || c.type.includes("superclass"),
    )?.children?.[0]?.text
    if (name && parent) {
      result.extends.push({ child: name, parent, line })
    }
  }

  // Recurse
  for (const child of node.children || []) {
    walkGenericTree(child, filePath, result)
  }
}

function extractCalleeName(node: any): string | undefined {
  if (!node) return undefined
  if (node.type === "identifier") return node.text
  if (node.type === "property_identifier") return node.text
  if (node.type === "member_expression") {
    const obj = node.childForFieldName("object")
    const prop = node.childForFieldName("property")
    if (obj && prop) {
      return `${extractCalleeName(obj)}.${prop.text}`
    }
  }
  return node.text
}

function extractMemberExpression(node: any): string {
  if (node.type === "identifier" || node.type === "property_identifier") return node.text
  if (node.type === "member_expression") {
    const obj = node.childForFieldName("object")
    const prop = node.childForFieldName("property")
    if (obj && prop) {
      return `${extractMemberExpression(obj)}.${prop.text}`
    }
  }
  return node.text || ""
}

function stripQuotes(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, "")
}
