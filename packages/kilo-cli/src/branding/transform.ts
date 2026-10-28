export * as KiloBranding from "./transform"

import { parseSync, traverse } from "@babel/core"
import type { NodePath } from "@babel/core"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { KiloBrandingStructural } from "./structural"

export const replacements = KiloBrandingStructural.replacements

const displayProperties = new Set([
  "description",
  "title",
  "label",
  "placeholder",
  "message",
  "safeMessage",
  "headline",
  "footnote",
  "detail",
  "retry",
])
const urlDestinations = new Map([
  ["https://opencode.ai/v2/docs", "https://kilo.ai/docs"],
  ["https://github.com/anomalyco/opencode/issues/new", "https://github.com/Kilo-Org/kilocode/issues/new"],
])

function contains(
  outer: { start?: number | null; end?: number | null },
  inner: { start?: number | null; end?: number | null },
) {
  return (
    outer.start != null &&
    outer.end != null &&
    inner.start != null &&
    inner.end != null &&
    outer.start <= inner.start &&
    outer.end >= inner.end
  )
}

function propertyName(path: NodePath) {
  if (!path.isObjectProperty() || path.node.computed) return
  if (path.node.key.type === "Identifier") return path.node.key.name
  if (path.node.key.type === "StringLiteral") return path.node.key.value
}

function rendered(path: NodePath) {
  const container = path.findParent((item) => item.isJSXExpressionContainer())
  return (
    !!container?.isJSXExpressionContainer() &&
    (container.parentPath.isJSXElement() || container.parentPath.isJSXFragment()) &&
    outputValue(path, container)
  )
}

function imported(path: NodePath, name: string, source: string) {
  const binding = path.scope.getBinding(name)
  return (
    !!binding?.path.isImportSpecifier() &&
    binding.path.parentPath.isImportDeclaration() &&
    binding.path.parentPath.node.source.value === source
  )
}

function displayCall(path: NodePath, call: NodePath, key: string) {
  if ((!call.isCallExpression() && !call.isNewExpression()) || !outputValue(path, call)) return false
  const index = call.node.arguments.findIndex((arg) => contains(arg, path.node))
  if (index < 0) return false
  const callee = call.node.callee
  if (callee.type === "Identifier") {
    if (["intro", "cancel"].includes(callee.name)) return index === 0 && imported(call, callee.name, "@clack/prompts")
    if (callee.name === "fail") return index === 0 && ["cli/src/mini.ts", "cli/src/run/run.ts"].includes(key)
    if (callee.name === "setFailure") return index === 0 && key === "tui/src/component/terminal-pane.tsx"
    if (callee.name === "style") return index === 0 && key === "cli/src/commands/handlers/stats.ts"
    if (callee.name === "setTerminalTitle") {
      const binding = call.scope.getBinding(callee.name)
      return (
        index === 1 &&
        !!binding?.path.isImportSpecifier() &&
        binding.path.parentPath.isImportDeclaration() &&
        /(?:^|\/)util\/renderer$/.test(binding.path.parentPath.node.source.value)
      )
    }
    if (callee.name === "row") return index === 1 && key === "tui/src/util/presentation.ts"
    if (callee.name === "Error") return index === 0 && !call.scope.getBinding("Error")
    if (callee.name === "phrase" && key === "cli/src/services/update-preflight.tsx") {
      const arg = call.node.arguments[index]
      return arg.type === "ArrayExpression" && !!arg.elements[0] && contains(arg.elements[0], path.node)
    }
    return false
  }
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return false
  const method = callee.property.name
  const object = callee.object
  if (object.type === "Identifier") {
    if (["Flag", "Argument"].includes(object.name) && method === "withDescription")
      return index === 0 && imported(call, object.name, "effect/cli")
    if (object.name === "Effect" && ["logError", "logWarning"].includes(method))
      return index === 0 && imported(call, "Effect", "effect")
    if (object.name === "log" && ["info", "warn", "message"].includes(method))
      return index === 0 && imported(call, "log", "@clack/prompts")
    if (object.name === "preflight" && method === "fail")
      return index === 0 && key === "cli/src/commands/handlers/default.ts"
    if (object.name === "RequestError" && method === "internalError")
      return index === 1 && imported(call, "RequestError", "@agentclientprotocol/sdk")
    if (object.name === "console" && ["log", "warn", "error"].includes(method))
      return index === 0 && !call.scope.getBinding("console")
  }
  return (
    index === 0 &&
    method === "write" &&
    object.type === "MemberExpression" &&
    !object.computed &&
    object.object.type === "Identifier" &&
    object.object.name === "process" &&
    object.property.type === "Identifier" &&
    ["stdout", "stderr"].includes(object.property.name) &&
    !call.scope.getBinding("process")
  )
}

function outputValue(path: NodePath, boundary: NodePath) {
  let child = path
  for (let parent = path.parentPath; parent && parent !== boundary; child = parent, parent = parent.parentPath) {
    if (parent.isConditionalExpression() && child.key === "test") return false
    if (parent.isLogicalExpression() && child.key === "left") return false
    if (parent.isBinaryExpression() && parent.node.operator !== "+") return false
    if (parent.isObjectProperty() && child.key !== "value") return false
    if (
      parent.isNewExpression() ||
      parent.isOptionalCallExpression() ||
      parent.isOptionalMemberExpression() ||
      parent.isTaggedTemplateExpression() ||
      parent.isUnaryExpression() ||
      parent.isUpdateExpression() ||
      parent.isAssignmentExpression() ||
      parent.isFunction()
    )
      return false
    if (parent.isMemberExpression()) {
      if (
        child.key !== "object" ||
        parent.node.computed ||
        parent.node.property.type !== "Identifier" ||
        parent.node.property.name !== "join" ||
        !parent.parentPath.isCallExpression() ||
        parent.parentPath.node.callee !== parent.node
      )
        return false
    }
    if (parent.isCallExpression()) {
      const callee = parent.node.callee
      if (
        callee.type !== "MemberExpression" ||
        callee.computed ||
        callee.property.type !== "Identifier" ||
        callee.property.name !== "join" ||
        !contains(callee.object, path.node)
      )
        return false
    }
  }
  return true
}

function nearestCall(path: NodePath) {
  for (let parent = path.parentPath; parent; parent = parent.parentPath) {
    if (parent.isFunction()) return
    if (parent.isCallExpression() || parent.isNewExpression()) return parent
  }
}

function display(path: NodePath, key: string) {
  if (key === "core/src/oauth/page.ts") {
    const fn = path.findParent((item) => item.isFunctionDeclaration())
    if (!fn?.isFunctionDeclaration()) return false
    if (["success", "error"].includes(fn.node.id?.name ?? "")) {
      const property = path.findParent((item) => item.isObjectProperty())
      return (
        !!property &&
        contains(fn.node, property.node) &&
        ["message", "footnote"].includes(propertyName(property) ?? "") &&
        outputValue(path, property)
      )
    }
    if (["renderDocument", "bootstrapScript"].includes(fn.node.id?.name ?? "")) {
      const result = path.findParent((item) => item.isReturnStatement())
      return !!result && contains(fn.node, result.node) && outputValue(path, result)
    }
    return false
  }
  if (path.findParent((item) => item.isImportDeclaration() || item.isTSType())) return false
  if (rendered(path)) return true
  const fn = path.findParent((item) => item.isFunctionDeclaration())
  if (fn?.isFunctionDeclaration() && ["cliErrorMessage", "epilogue"].includes(fn.node.id?.name ?? "")) {
    const result = path.findParent((item) => item.isReturnStatement())
    if (result && contains(fn.node, result.node) && outputValue(path, result)) return true
  }
  if (fn?.isFunctionDeclaration() && fn.node.id?.name === "errorDetails") {
    const property = path.findParent((item) => item.isObjectProperty() && propertyName(item) === "prompt")
    if (property && contains(fn.node, property.node) && outputValue(path, property)) return true
  }
  if (fn?.isFunctionDeclaration() && fn.node.id?.name === "buildIssueURL") {
    const variable = path.findParent((item) => item.isVariableDeclarator())
    if (
      variable?.isVariableDeclarator() &&
      variable.node.id.type === "Identifier" &&
      variable.node.id.name === "head" &&
      outputValue(path, variable)
    )
      return true
    const call = path.findParent((item) => item.isCallExpression())
    if (
      call?.isCallExpression() &&
      call.node.callee.type === "MemberExpression" &&
      !call.node.callee.computed &&
      call.node.callee.property.type === "Identifier" &&
      call.node.callee.property.name === "set" &&
      call.node.callee.object.type === "MemberExpression" &&
      !call.node.callee.object.computed &&
      call.node.callee.object.object.type === "Identifier" &&
      call.node.callee.object.object.name === "url" &&
      call.node.callee.object.property.type === "Identifier" &&
      call.node.callee.object.property.name === "searchParams" &&
      call.node.arguments[0]?.type === "StringLiteral" &&
      call.node.arguments[0].value === "reproduce" &&
      call.node.arguments[1] &&
      contains(call.node.arguments[1], path.node) &&
      outputValue(path, call)
    )
      return true
  }
  const attribute = path.findParent((item) => item.isJSXAttribute())
  if (attribute?.isJSXAttribute() && attribute.node.name.type === "JSXIdentifier")
    return displayProperties.has(attribute.node.name.name) && outputValue(path, attribute)
  const property = path.findParent((item) => item.isObjectProperty())
  const option = path.findParent((item) => item.isTSSatisfiesExpression())
  if (
    property &&
    propertyName(property) === "description" &&
    option?.isTSSatisfiesExpression() &&
    option.node.typeAnnotation.type === "TSTypeReference" &&
    option.node.typeAnnotation.typeName.type === "Identifier" &&
    option.node.typeAnnotation.typeName.name === "SlashOption" &&
    outputValue(path, option)
  )
    return true
  const call = nearestCall(path)
  if (property?.isObjectProperty() && (!call || (property.node.start ?? 0) > (call.node.start ?? 0))) {
    if (!displayProperties.has(propertyName(property) ?? "") || !outputValue(path, property)) return false
    if (!call) return true
    if (!call.isCallExpression() && !call.isNewExpression()) return false
    const callee = call.node.callee
    if (
      propertyName(property) === "description" &&
      call.isCallExpression() &&
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.type === "Identifier" &&
      callee.property.name === "annotate" &&
      callee.object.type === "CallExpression" &&
      callee.object.callee.type === "MemberExpression" &&
      callee.object.callee.object.type === "Identifier" &&
      callee.object.callee.object.name === "Schema" &&
      imported(call, "Schema", "effect") &&
      call.node.arguments[0] === property.parentPath.node
    )
      return true
    return (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      ((callee.object.name === "Spec" &&
        callee.property.name === "make" &&
        imported(call, "Spec", "../framework/spec")) ||
        (callee.object.name === "ACPError" &&
          callee.property.name === "ServiceFailureError" &&
          imported(call, "ACPError", "./error")))
    )
  }
  if (call && displayCall(path, call, key)) return true
  if (
    call?.isCallExpression() &&
    call.node.callee.type === "MemberExpression" &&
    !call.node.callee.computed &&
    call.node.callee.property.type === "Identifier" &&
    call.node.callee.property.name === "join" &&
    contains(call.node.callee.object, path.node)
  ) {
    const output = nearestCall(call)
    if (output && outputValue(path, call) && displayCall(call, output, key)) return true
  }
  const variable = path.findParent((item) => item.isVariableDeclarator())
  return (
    variable?.isVariableDeclarator() &&
    variable.node.id.type === "Identifier" &&
    outputValue(path, variable) &&
    (["DEFAULT_TITLE", "INTERACTIVE_INPUT_ERROR", "stages", "remoteWarning"].includes(variable.node.id.name) ||
      (variable.node.id.name === "command" && fn?.isFunctionDeclaration() && fn.node.id?.name === "buildExit"))
  )
}

function brand(value: string, command = "kilo2", site = false) {
  return value.replace(
    /https?:\\?\/\\?\/[^\s"'`\\<>]+|OpenCode(?:\s|\\[nr])+(?:Go|Console|Zen)\b|\bopencode\.json\b|\bopencode\.ai\b|\bOpenCode\b|(?<![@/\w])\bopencode\b(?![-.])/g,
    (part) => {
      if (part.startsWith("http") || /^OpenCode(?:\s|\\[nr])+(?:Go|Console|Zen)$/.test(part)) return part
      if (part === "opencode.json") return KiloConfigFiles.newFile
      if (part === "opencode.ai") return site ? "kilo.ai" : part
      if (part === "opencode") return command
      return "Kilo"
    },
  )
}

function semantic(path: NodePath) {
  if (!path.isStringLiteral()) return
  const property = path.parentPath
  if (!property.isObjectProperty() || property.node.value !== path.node) return
  const name = propertyName(property)
  const object = property.parentPath
  if (!object.isObjectExpression()) return
  const owner = object.parentPath
  if (
    name === "description" &&
    owner.isCallExpression() &&
    owner.node.callee.type === "MemberExpression" &&
    owner.node.callee.object.type === "Identifier" &&
    owner.node.callee.object.name === "Spec" &&
    owner.node.callee.property.type === "Identifier" &&
    owner.node.callee.property.name === "make" &&
    imported(owner, "Spec", "../framework/spec") &&
    owner.node.arguments[1] === object.node &&
    owner.node.arguments[0]?.type === "StringLiteral" &&
    owner.node.arguments[0].value === "upgrade"
  )
    return "Show manual Kilo update instructions"
  if (
    name === "title" &&
    object.node.properties.some(
      (item) =>
        item.type === "ObjectProperty" &&
        !item.computed &&
        item.key.type === "Identifier" &&
        item.key.name === "name" &&
        item.value.type === "StringLiteral" &&
        item.value.value === "opencode.update",
    )
  )
    return "Kilo update instructions"
  if (
    name === "name" &&
    owner.isVariableDeclarator() &&
    owner.node.id.type === "Identifier" &&
    owner.node.id.name === "authMethod"
  ) {
    const annotation = owner.node.id.typeAnnotation
    if (
      annotation?.type === "TSTypeAnnotation" &&
      annotation.typeAnnotation.type === "TSTypeReference" &&
      annotation.typeAnnotation.typeName.type === "Identifier" &&
      annotation.typeAnnotation.typeName.name === "AuthMethod"
    )
      return brand(path.node.value, "Kilo")
  }
  if (
    name === "name" &&
    owner.isObjectProperty() &&
    propertyName(owner) === "agentInfo" &&
    owner.parentPath.parentPath?.isReturnStatement()
  )
    return brand(path.node.value)
  if (
    name === "command" &&
    owner.isObjectProperty() &&
    propertyName(owner) === "terminal-auth" &&
    path.node.value === "opencode" &&
    owner.parentPath.parentPath?.isAssignmentExpression()
  )
    return "kilo2"
}

function destination(path: NodePath) {
  if (!path.isStringLiteral()) return
  const call = path.parentPath
  if (
    (!call.isCallExpression() && !call.isNewExpression()) ||
    call.node.arguments[0] !== path.node ||
    call.node.callee.type !== "Identifier" ||
    !["openUrl", "URL"].includes(call.node.callee.name)
  )
    return
  if (call.node.callee.name === "openUrl" && !imported(call, "openUrl", "@opencode/util/open")) return
  if (call.node.callee.name === "URL" && call.scope.getBinding("URL")) return
  for (const [from, to] of urlDestinations) {
    if (path.node.value === from || path.node.value.startsWith(`${from}?`) || path.node.value.startsWith(`${from}#`))
      return to + path.node.value.slice(from.length)
  }
}

function productSite(path: NodePath) {
  const fn = path.findParent((item) => item.isFunctionDeclaration())
  return fn?.isFunctionDeclaration() && ["renderStats", "StatsPoster"].includes(fn.node.id?.name ?? "")
}

export function transform(file: string, source: string) {
  const key = file.replaceAll("\\", "/").split("/packages/").at(-1) ?? file
  if (key.includes("/src/kilocode/") || key === "cli/src/services/updater.ts") return source
  if (!/^(?:cli|tui)\/src\/.*\.tsx?$/.test(key) && key !== "core/src/oauth/page.ts") return source
  if (!/(?:OpenCode|opencode|OC \|)/.test(source) && !Object.hasOwn(replacements, key)) return source
  const normalized = source.replaceAll("\r\n", "\n")
  const structural = Object.hasOwn(replacements, key) ? replacements[key as keyof typeof replacements] : []
  const input = structural.reduce((text, [from, to]) => {
    if (!text.includes(from)) throw new Error(`Kilo branding no longer matches ${key}: ${from}`)
    return text.replaceAll(from, to)
  }, normalized)
  const parsed = parseSync(input, {
    filename: file,
    sourceType: "module",
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: key.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"] },
  })
  if (!parsed) throw new Error(`Could not parse Kilo branding for ${key}`)
  const edits: { start: number; end: number; text: string }[] = []
  traverse(parsed, {
    StringLiteral(path) {
      if (path.node.start == null || path.node.end == null) return
      const selected = semantic(path) ?? destination(path)
      if (selected !== undefined) {
        if (selected !== path.node.value)
          edits.push({ start: path.node.start, end: path.node.end, text: JSON.stringify(selected) })
        return
      }
      if (!display(path, key)) return
      const raw = input.slice(path.node.start, path.node.end)
      const text = brand(raw, "kilo2", productSite(path))
      if (text !== raw) edits.push({ start: path.node.start, end: path.node.end, text })
    },
    TemplateElement(path) {
      if (!display(path, key) || path.node.start == null || path.node.end == null) return
      const raw = input.slice(path.node.start, path.node.end)
      const text = brand(raw, "kilo2", productSite(path)).replace(/^OC \| /, "Kilo | ")
      if (text !== raw) edits.push({ start: path.node.start, end: path.node.end, text })
    },
    JSXText(path) {
      if (path.node.start == null || path.node.end == null) return
      const raw = input.slice(path.node.start, path.node.end)
      const text = brand(raw, "kilo2", productSite(path))
      if (text !== raw) edits.push({ start: path.node.start, end: path.node.end, text })
    },
  })
  const branded = edits
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), input)
  if (key !== "core/src/oauth/page.ts") return branded === normalized && structural.length === 0 ? source : branded
  return KiloBrandingStructural.wordmark(branded)
}
