import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const GLOBAL_TARGETS = new Set(["window", "document", "globalThis"])
const ACTIVE_SLOT_SCOPES = [
  ".am-chat-slot-active",
  ".am-diff-panel-cache-active",
  ".am-browser-cache-active",
  ":not(.am-chat-wrapper-hidden)",
]

type FnNode = ESTree.Function | ESTree.ArrowFunctionExpression

function isAstNode(value: unknown): value is ESTree.Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"
}

function childNodes(node: ESTree.Node): ESTree.Node[] {
  const result: ESTree.Node[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue
    if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) result.push(item)
      continue
    }
    if (isAstNode(value)) result.push(value)
  }
  return result
}

function walk(node: ESTree.Node, visit: (current: ESTree.Node, ancestors: readonly ESTree.Node[]) => void): void {
  const ancestors: ESTree.Node[] = []
  const step = (current: ESTree.Node) => {
    visit(current, ancestors)
    ancestors.push(current)
    for (const child of childNodes(current)) step(child)
    ancestors.pop()
  }
  step(node)
}

function isFnNode(node: ESTree.Node | null | undefined): node is FnNode {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  )
}

function propName(node: ESTree.MemberExpression): string | null {
  if (!node.computed && node.property.type === "Identifier") return node.property.name
  if (node.computed && node.property.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value
  }
  return null
}

function isUseViewActiveCall(node: ESTree.Node | null | undefined): boolean {
  return node?.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "useViewActive"
}

function isGuardName(name: string): boolean {
  return name === "viewActive" || name === "isViewActive"
}

function collectGuardsAndFunctions(program: ESTree.Program) {
  const guards = new Set<string>(["viewActive", "isViewActive"])
  const functions = new Map<string, FnNode[]>()

  const registerFn = (name: string, fn: FnNode) => {
    const existing = functions.get(name)
    if (existing) existing.push(fn)
    else functions.set(name, [fn])
  }

  walk(program, (node) => {
    if (node.type === "FunctionDeclaration" && node.id) {
      registerFn(node.id.name, node)
    }
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
      if (isUseViewActiveCall(node.init)) guards.add(node.id.name)
      if (isFnNode(node.init)) registerFn(node.id.name, node.init)
    }
  })

  return { guards, functions }
}

function exprUsesGuard(node: ESTree.Node | null | undefined, guards: ReadonlySet<string>): boolean {
  if (!node) return false
  let found = false
  walk(node, (current) => {
    if (found) return
    if (current.type === "CallExpression") {
      if (current.callee.type === "Identifier" && guards.has(current.callee.name)) {
        found = true
        return
      }
      if (current.callee.type === "MemberExpression") {
        const name = propName(current.callee)
        if (name && isGuardName(name)) {
          found = true
          return
        }
      }
    }
    if (current.type === "Identifier" && isGuardName(current.name)) {
      found = true
    }
  })
  return found
}

function isEarlyReturnGuard(stmt: ESTree.Statement, guards: ReadonlySet<string>): boolean {
  if (stmt.type !== "IfStatement") return false
  if (!exprUsesGuard(stmt.test, guards)) return false
  if (stmt.consequent.type === "ReturnStatement") return true
  if (stmt.consequent.type === "BlockStatement") {
    return stmt.consequent.body.some((item) => item.type === "ReturnStatement")
  }
  return false
}

function isScopeGuarded(
  node: ESTree.Node,
  ancestors: readonly ESTree.Node[],
  guards: ReadonlySet<string>,
): boolean {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i]
    const child = i + 1 < ancestors.length ? ancestors[i + 1] : node
    if (ancestor.type === "IfStatement" && ancestor.consequent === child && exprUsesGuard(ancestor.test, guards)) {
      return true
    }
    if (ancestor.type === "ConditionalExpression" && exprUsesGuard(ancestor.test, guards)) {
      return true
    }
    if (ancestor.type === "LogicalExpression" && ancestor.right === child && exprUsesGuard(ancestor.left, guards)) {
      return true
    }
    if (ancestor.type === "BlockStatement") {
      const idx = ancestor.body.indexOf(child as ESTree.Statement)
      if (idx > 0) {
        for (let j = 0; j < idx; j++) {
          if (isEarlyReturnGuard(ancestor.body[j], guards)) return true
        }
      }
    }
  }
  return false
}

function fnContainsGuard(
  fn: FnNode,
  guards: ReadonlySet<string>,
  functions: ReadonlyMap<string, FnNode[]>,
  depth = 0,
): boolean {
  if (!fn.body) return false
  if (exprUsesGuard(fn.body, guards)) return true
  if (depth >= 2) return false
  let found = false
  walk(fn.body, (current) => {
    if (found) return
    if (current.type === "CallExpression" && current.callee.type === "Identifier") {
      const targets = functions.get(current.callee.name)
      if (targets?.some((target) => target !== fn && fnContainsGuard(target, guards, functions, depth + 1))) {
        found = true
      }
    }
  })
  return found
}

function isHandlerGuarded(
  arg: ESTree.Node | null | undefined,
  guards: ReadonlySet<string>,
  functions: ReadonlyMap<string, FnNode[]>,
): boolean {
  if (!arg) return false
  if (isFnNode(arg)) return fnContainsGuard(arg, guards, functions)
  if (arg.type === "Identifier") {
    const targets = functions.get(arg.name)
    return !!targets?.some((target) => fnContainsGuard(target, guards, functions))
  }
  return false
}

function isGlobalAddEventListener(node: ESTree.CallExpression): boolean {
  if (node.callee.type !== "MemberExpression") return false
  if (propName(node.callee) !== "addEventListener") return false
  return node.callee.object.type === "Identifier" && GLOBAL_TARGETS.has(node.callee.object.name)
}

function isCommandListener(node: ESTree.CallExpression): boolean {
  return node.callee.type === "MemberExpression" && propName(node.callee) === "onCommand"
}

function isCreateResizeObserver(node: ESTree.CallExpression): boolean {
  return node.callee.type === "Identifier" && node.callee.name === "createResizeObserver"
}

function isDocumentQuery(node: ESTree.CallExpression): boolean {
  if (node.callee.type !== "MemberExpression") return false
  const method = propName(node.callee)
  if (method !== "querySelector" && method !== "querySelectorAll") return false
  return node.callee.object.type === "Identifier" && node.callee.object.name === "document"
}

function hasActiveSlotScope(arg: ESTree.Node | null | undefined): boolean {
  if (!arg) return false
  if (arg.type === "Literal" && typeof arg.value === "string") {
    return ACTIVE_SLOT_SCOPES.some((scope) => arg.value.includes(scope))
  }
  if (arg.type === "TemplateLiteral") {
    return arg.quasis.some((quasi) => ACTIVE_SLOT_SCOPES.some((scope) => quasi.value.raw.includes(scope)))
  }
  return false
}

function isCssHighlights(node: ESTree.MemberExpression): boolean {
  if (propName(node) !== "highlights") return false
  if (node.object.type === "Identifier" && node.object.name === "CSS") return true
  if (node.object.type === "MemberExpression" && propName(node.object) === "CSS") return true
  return false
}

function checkCall(
  node: ESTree.CallExpression,
  ancestors: readonly ESTree.Node[],
  guards: ReadonlySet<string>,
  functions: ReadonlyMap<string, FnNode[]>,
): "globalListener" | "globalCommand" | "resizeObserver" | "unscopedQuery" | null {
  if (isGlobalAddEventListener(node)) {
    if (isHandlerGuarded(node.arguments[1], guards, functions) || isScopeGuarded(node, ancestors, guards)) return null
    return "globalListener"
  }
  if (isCommandListener(node)) {
    if (isHandlerGuarded(node.arguments[0], guards, functions) || isScopeGuarded(node, ancestors, guards)) return null
    return "globalCommand"
  }
  if (isCreateResizeObserver(node)) {
    if (isHandlerGuarded(node.arguments[1], guards, functions) || isScopeGuarded(node, ancestors, guards)) return null
    return "resizeObserver"
  }
  if (isDocumentQuery(node)) {
    if (hasActiveSlotScope(node.arguments[0])) return null
    return "unscopedQuery"
  }
  return null
}

/**
 * Enforce keep-alive multi-slot isolation inside kept-alive SessionView and
 * DiffPanel trees (Agent Manager mounts up to 15 chat/diff slots at once).
 */
export const requireViewActiveGuardRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require useViewActive() guards for global listeners, ResizeObserver, CSS.highlights, and active-slot scoping for document.querySelector inside kept-alive SessionView/DiffPanel trees.",
    },
    messages: {
      globalListener:
        "Global window/document addEventListener inside a kept-alive SessionView/DiffPanel tree must gate on useViewActive() so hidden Agent Manager slots do not react.",
      globalCommand:
        "onCommand listener inside a kept-alive SessionView/DiffPanel tree must gate on useViewActive() so hidden Agent Manager slots do not handle commands.",
      resizeObserver:
        "ResizeObserver inside a kept-alive SessionView/DiffPanel tree must gate on useViewActive() so hidden Agent Manager slots do not run layout work when inactive.",
      globalHighlights:
        "CSS.highlights access inside a kept-alive SessionView/DiffPanel tree must gate on useViewActive() so hidden Agent Manager slots do not clobber active highlights.",
      unscopedQuery:
        "Unscoped document.querySelector/querySelectorAll inside a kept-alive SessionView/DiffPanel tree can match hidden Agent Manager slots. Query from a local element ref or scope to .am-chat-slot-active / .am-diff-panel-cache-active.",
    },
  },
  createOnce(context) {
    return {
      Program(program) {
        const { guards, functions } = collectGuardsAndFunctions(program)
        walk(program, (node, ancestors) => {
          if (node.type === "CallExpression") {
            const messageId = checkCall(node, ancestors, guards, functions)
            if (messageId) context.report({ node, messageId })
            return
          }
          if (
            node.type === "NewExpression" &&
            node.callee.type === "Identifier" &&
            node.callee.name === "ResizeObserver"
          ) {
            if (!isHandlerGuarded(node.arguments[0], guards, functions) && !isScopeGuarded(node, ancestors, guards)) {
              context.report({ node, messageId: "resizeObserver" })
            }
            return
          }
          if (node.type === "MemberExpression" && isCssHighlights(node) && !isScopeGuarded(node, ancestors, guards)) {
            context.report({ node, messageId: "globalHighlights" })
          }
        })
      },
    }
  },
})
