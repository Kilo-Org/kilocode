import { parseSync, traverse } from "@babel/core"
import type { NodePath } from "@babel/core"

export type Candidate = { text: string; line: number }

type TextNode = Candidate & { key: string; context: string; raw: string; branded: boolean }

const genericBrand =
  /\bOpenCode\b(?!\s+(?:Go|Console|Zen)\b)|\bopencode\.(?:jsonc?|ai)\b|\bopencode(?=\s+(?:--?[\w-]+|[a-z][\w-]*))/
const displayBrand = /\bOpenCode\b(?!\s+(?:Go|Console|Zen)\b)|\bopencode\b/
const asset = /\.(?:txt|html|svg)$/i
const code = /\.[cm]?[jt]sx?$/i
const displayProperties = new Set([
  "title",
  "label",
  "description",
  "placeholder",
  "message",
  "safeMessage",
  "headline",
  "footnote",
  "detail",
  "alt",
  "aria-label",
])
const displayCalls = new Set([
  "withDescription",
  "setFailure",
  "setTerminalTitle",
  "message",
  "fail",
  "intro",
  "cancel",
  "row",
  "style",
  "phrase",
  "Error",
])

function display(path: NodePath) {
  const attribute = path.findParent((item) => item.isJSXAttribute())
  if (attribute?.isJSXAttribute())
    return attribute.node.name.type === "JSXIdentifier" && displayProperties.has(attribute.node.name.name)
  if (path.isJSXText() || path.findParent((item) => item.isJSXElement() || item.isJSXFragment())) return true
  const property = path.findParent((item) => item.isObjectProperty())
  const call = path.findParent((item) => item.isCallExpression() || item.isNewExpression())
  if (property?.isObjectProperty() && (!call || (property.node.start ?? 0) > (call.node.start ?? 0))) {
    const key = property.node.key
    return (
      !property.node.computed &&
      (key.type === "Identifier" || key.type === "StringLiteral") &&
      displayProperties.has(key.type === "Identifier" ? key.name : key.value)
    )
  }
  if (call?.isCallExpression() || call?.isNewExpression()) {
    const callee = call.node.callee
    const name =
      callee.type === "Identifier"
        ? callee.name
        : callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier"
          ? callee.property.name
          : ""
    if (["log", "info", "warn", "error", "write"].includes(name)) {
      if (callee.type !== "MemberExpression") return false
      if (callee.object.type === "Identifier")
        return name === "write" ? ["stdout", "stderr"].includes(callee.object.name) : callee.object.name === "console"
      return (
        name === "write" &&
        callee.object.type === "MemberExpression" &&
        callee.object.object.type === "Identifier" &&
        callee.object.object.name === "process" &&
        !callee.object.computed &&
        callee.object.property.type === "Identifier" &&
        ["stdout", "stderr"].includes(callee.object.property.name)
      )
    }
    return displayCalls.has(name)
  }
  return false
}

function identity(path: NodePath) {
  const ancestry = path.getAncestry().map((item) => {
    const node = item.node
    const callee = node.type === "CallExpression" || node.type === "NewExpression" ? node.callee : undefined
    const name =
      node.type === "VariableDeclarator" && node.id.type === "Identifier"
        ? node.id.name
        : node.type === "FunctionDeclaration"
          ? node.id?.name
          : node.type === "ObjectProperty" && !node.computed && node.key.type === "Identifier"
            ? node.key.name
            : node.type === "ObjectProperty" && !node.computed && node.key.type === "StringLiteral"
              ? node.key.value
              : node.type === "JSXElement" && node.openingElement.name.type === "JSXIdentifier"
                ? node.openingElement.name.name
                : callee?.type === "Identifier"
                  ? callee.name
                  : callee?.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier"
                    ? `${callee.object.type === "Identifier" ? callee.object.name : callee.object.type}.${callee.property.name}`
                    : undefined
    return { type: node.type, name, length: Array.isArray(item.container) ? item.container.length : undefined }
  })
  return {
    key: JSON.stringify([path.getPathLocation(), ancestry]),
    context: JSON.stringify([
      path.getPathLocation().replace(/\[\d+\]/g, "[]"),
      ancestry.map((item) => [item.type, item.name]),
    ]),
  }
}

function rawOffset(raw: string, index: number, jsx: boolean) {
  let position = 0
  let decoded = 0
  while (position < raw.length && decoded < index) {
    const remaining = raw.slice(position)
    const entity = jsx ? remaining.match(/^&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/i)?.[0] : undefined
    if (entity) {
      const codepoint =
        entity.startsWith("&#x") || entity.startsWith("&#X")
          ? Number.parseInt(entity.slice(3, -1), 16)
          : entity.startsWith("&#")
            ? Number.parseInt(entity.slice(2, -1), 10)
            : 0
      decoded += codepoint > 0xffff ? 2 : 1
      position += entity.length
      continue
    }
    const escape = !jsx ? remaining.match(/^\\(?:u\{[\da-f]+\}|u[\da-f]{4}|x[\da-f]{2}|\r\n|[\s\S])/i)?.[0] : undefined
    if (escape) {
      const codepoint = escape.startsWith("\\u{") ? Number.parseInt(escape.slice(3, -1), 16) : 0
      decoded += /^\\(?:\r\n|\r|\n)$/.test(escape) ? 0 : codepoint > 0xffff ? 2 : 1
      position += escape.length
      continue
    }
    position += remaining.startsWith("\r\n") ? 2 : 1
    decoded++
  }
  return position
}

function nodes(file: string, source: string): TextNode[] {
  if (asset.test(file)) {
    return source.split(/\r?\n/).map((text, index) => ({
      text: text.trim(),
      raw: text.trim(),
      line: index + 1,
      key: String(index),
      context: "asset",
      branded: displayBrand.test(text),
    }))
  }
  if (!code.test(file)) return []
  const parsed = parseSync(source, {
    filename: file,
    sourceType: "unambiguous",
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: /x$/i.test(file) ? ["typescript", "jsx"] : ["typescript"] },
  })
  if (!parsed) throw new Error(`Could not parse ${file}`)
  const result: TextNode[] = []
  function add(path: NodePath, text: string) {
    if (!path.node.loc) return
    if (
      path.findParent(
        (item) =>
          item.isImportDeclaration() ||
          item.isExportAllDeclaration() ||
          (item.isExportNamedDeclaration() && !!item.node.source) ||
          item.isTSType(),
      )
    )
      return
    const parent = path.parentPath
    if (parent?.isObjectProperty() && parent.node.key === path.node && !parent.node.computed) return
    if (
      parent?.isCallExpression() &&
      (parent.node.callee.type === "Import" ||
        (parent.node.callee.type === "Identifier" && parent.node.callee.name === "require"))
    )
      return
    const shown = display(path)
    const match = text.match(shown ? displayBrand : genericBrand)
    const url = !shown && /^\s*(?:https?:\/\/|@|[./])\S+\s*$/i.test(text)
    const raw = source.slice(
      (path.node.start ?? 0) + (path.isStringLiteral() ? 1 : 0),
      (path.node.end ?? 0) - (path.isStringLiteral() ? 1 : 0),
    )
    const jsx = path.isJSXText() || !!parent?.isJSXAttribute()
    const line =
      path.node.loc.start.line + (raw.slice(0, rawOffset(raw, match?.index ?? 0, jsx)).match(/\n/g)?.length ?? 0)
    result.push({ text: text.trim(), raw: raw.trim(), line, ...identity(path), branded: !!match && !url })
  }
  traverse(parsed, {
    StringLiteral(path) {
      add(path, path.node.value)
    },
    TemplateElement(path) {
      add(path, path.node.value.cooked ?? path.node.value.raw)
    },
    JSXText(path) {
      add(path, path.node.value)
    },
  })
  return result
}

export function candidates(file: string, source: string): Candidate[] {
  return nodes(file, source)
    .filter((item) => item.branded)
    .map((item) => ({ text: item.text, line: item.line }))
}

export function unresolved(file: string, base: string, current: string, transformed: string): Candidate[] {
  const before = nodes(file, base).filter((item) => item.branded)
  const now = nodes(file, current).filter((item) => item.branded)
  const after = new Map(nodes(file, transformed).map((item) => [item.key, item]))
  const group = (item: TextNode) => JSON.stringify([item.context, item.raw])
  const counts = (items: TextNode[]) => {
    const result = new Map<string, number>()
    for (const item of items) result.set(group(item), (result.get(group(item)) ?? 0) + 1)
    return result
  }
  const previousCounts = counts(before)
  const currentCounts = counts(now)
  return now.flatMap((item) => {
    const key = group(item)
    if ((currentCounts.get(key) ?? 0) <= (previousCounts.get(key) ?? 0)) return []
    const remaining = after.get(item.key)
    if (remaining && !remaining.branded) return []
    return [{ text: item.text, line: item.line }]
  })
}
