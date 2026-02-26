/**
 * Localization lint: Agent Manager
 *
 * Ensures all user-visible strings in the Agent Manager webview go through
 * the i18n `t()` function rather than being hardcoded in English.
 *
 * Detects:
 *   - JSX text content (raw text between tags)
 *   - String-literal JSX attribute values for user-facing props
 *     (title, label, placeholder, aria-label)
 *   - Hardcoded string arguments to known UI functions (showToast, etc.)
 *
 * Allows:
 *   - CSS class names, data-* attributes, `type` attributes, icon names
 *   - Event handler names, message types, signal/state keys
 *   - Numbers, single characters, punctuation-only strings
 *   - Template expressions `{...}` (assumed to use t())
 *   - Strings that are clearly programmatic (IDs, prefixes, selectors)
 */

import { describe, it, expect } from "bun:test"
import { Project, SyntaxKind, Node } from "ts-morph"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const TSX_FILES = [
  path.join(ROOT, "webview-ui/agent-manager/AgentManagerApp.tsx"),
  path.join(ROOT, "webview-ui/agent-manager/sortable-tab.tsx"),
]

/**
 * Props whose string values are user-visible and must be localized.
 * Other props (class, icon, type, variant, size, data-*, placement, etc.)
 * are programmatic and should be skipped.
 */
const USER_FACING_PROPS = new Set(["title", "label", "placeholder", "aria-label"])

/**
 * Strings that are clearly programmatic and should never be flagged.
 */
function isProgrammatic(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  // Single characters, pure numbers, pure punctuation/whitespace
  if (trimmed.length <= 1) return true
  if (/^\d+$/.test(trimmed)) return true
  if (/^[^a-zA-Z]*$/.test(trimmed)) return true
  // CSS class names
  if (/^am-/.test(trimmed)) return true
  // Message type strings (e.g. "agentManager.createWorktree", "sendMessage")
  if (/^agentManager\./.test(trimmed)) return true
  if (
    /^(sendMessage|loadMessages|clearSession|sessionsLoaded|sessionCreated|action|setLanguage|webviewReady)$/.test(
      trimmed,
    )
  )
    return true
  // Known programmatic identifiers and config values
  if (/^(local|pending:|kilo-vscode|data-theme|use:sortable)/.test(trimmed)) return true
  // navigator/platform detection strings
  if (/^(Mac|iPhone|iPad)/.test(trimmed)) return true
  // Keyboard modifier symbols
  if (/^[⌘⇧⌃⌥]+$/.test(trimmed)) return true
  // Direction/action constants
  if (
    /^(up|down|left|right|horizontal|new|import|bottom|top|right-start|bottom-start|bottom-end|top-start)$/.test(
      trimmed,
    )
  )
    return true
  // Variant/size/icon names
  if (/^(ghost|primary|secondary|small|large|fit)$/.test(trimmed)) return true
  // Icon names with hyphens or single words used as icon identifiers
  if (
    /^(branch|plus|close-small|settings-gear|chevron-down|chevron-right|trash|info|circle-x|console|magnifying-glass|layers|selector)$/.test(
      trimmed,
    )
  )
    return true
  // HTML tag names / type attribute values
  if (/^(button|text|submit|checkbox|root)$/.test(trimmed)) return true
  // CSS selector strings
  if (/^\[data-/.test(trimmed) || /^\.am-/.test(trimmed)) return true
  // Log prefixes
  if (/^\[Kilo/.test(trimmed)) return true
  // Platform-specific modifier display (already keybinding tokens)
  if (/^(Ctrl\+|⌘|⇧|⌃|⌥)/.test(trimmed) && trimmed.length <= 6) return true
  return false
}

interface Violation {
  file: string
  line: number
  text: string
  context: string
}

function findViolations(): Violation[] {
  const project = new Project({
    compilerOptions: {
      jsx: 4, // JsxEmit.Preserve
      jsxImportSource: "solid-js",
      allowJs: true,
      strict: false,
      noEmit: true,
    },
    skipAddingFilesFromTsConfig: true,
  })

  const violations: Violation[] = []

  for (const filePath of TSX_FILES) {
    const source = project.addSourceFileAtPath(filePath)
    const basename = path.basename(filePath)

    // 1. Check JSX text nodes — raw text between tags
    source.getDescendantsOfKind(SyntaxKind.JsxText).forEach((node) => {
      const text = node.getText().trim()
      if (!text) return
      // Filter out whitespace-only or pure punctuation
      if (/^[^a-zA-Z]*$/.test(text)) return
      if (isProgrammatic(text)) return

      violations.push({
        file: basename,
        line: node.getStartLineNumber(),
        text,
        context: "JSX text content",
      })
    })

    // 2. Check string literal JSX attributes for user-facing props
    source.getDescendantsOfKind(SyntaxKind.JsxAttribute).forEach((attr) => {
      const name = attr.getNameNode().getText()
      if (!USER_FACING_PROPS.has(name)) return

      const initializer = attr.getInitializer()
      if (!initializer) return

      // {expression} — skip, assumed to use t()
      if (Node.isJsxExpression(initializer)) return

      // "string literal"
      if (Node.isStringLiteral(initializer)) {
        const text = initializer.getLiteralText()
        if (isProgrammatic(text)) return
        violations.push({
          file: basename,
          line: attr.getStartLineNumber(),
          text,
          context: `JSX attribute "${name}"`,
        })
      }
    })

    // 3. Check string literals used as UI fallbacks (e.g. || "Untitled", title: "New Session")
    //    in object literals inside function bodies (buildShortcutCategories, pending tab creation, etc.)
    source.getDescendantsOfKind(SyntaxKind.StringLiteral).forEach((node) => {
      const text = node.getLiteralText()
      if (isProgrammatic(text)) return

      // Check for `|| "string"` pattern — a common fallback for display text
      const parent = node.getParent()
      if (parent && Node.isBinaryExpression(parent)) {
        const op = parent.getOperatorToken().getText()
        if (op === "||" && parent.getRight() === node) {
          violations.push({
            file: basename,
            line: node.getStartLineNumber(),
            text,
            context: 'fallback string (|| "...")',
          })
          return
        }
      }

      // Check for `{ label: "string" }` or `{ title: "string" }` in object literals
      // that are NOT JSX attributes (those are caught above)
      if (parent && Node.isPropertyAssignment(parent)) {
        const propName = parent.getName()
        if ((propName === "label" || propName === "title") && parent.getInitializer() === node) {
          // Skip if this is inside a JSX attribute (already handled)
          const grandParent = parent.getParent()
          if (grandParent && Node.isObjectLiteralExpression(grandParent)) {
            violations.push({
              file: basename,
              line: node.getStartLineNumber(),
              text,
              context: `object property "${propName}"`,
            })
          }
        }
      }
    })

    // 4. Check showToast calls for hardcoded title/description
    source.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
      const expr = call.getExpression().getText()
      if (expr !== "showToast") return
      const args = call.getArguments()
      if (args.length === 0) return
      const obj = args[0]
      if (!Node.isObjectLiteralExpression(obj)) return
      obj.getProperties().forEach((prop) => {
        if (!Node.isPropertyAssignment(prop)) return
        const propName = prop.getName()
        if (propName !== "title" && propName !== "description") return
        const init = prop.getInitializer()
        if (!init || !Node.isStringLiteral(init)) return
        const text = init.getLiteralText()
        if (isProgrammatic(text)) return
        violations.push({
          file: basename,
          line: prop.getStartLineNumber(),
          text,
          context: `showToast ${propName}`,
        })
      })
    })
  }

  return violations
}

/**
 * Detects arrow-function parameters that shadow the `t` i18n function, and
 * JSX expressions that render `{t}` (the translation function itself) instead
 * of the intended loop variable.
 *
 * Catches bugs like:
 *   .map((token) => <kbd>{t}</kbd>)   — renders the i18n function, not `token`
 *   .map((t) => <kbd>{t}</kbd>)       — shadows outer `t`, works by accident
 */
interface ShadowViolation {
  file: string
  line: number
  text: string
  context: string
}

function findTranslationShadowViolations(): ShadowViolation[] {
  const project = new Project({
    compilerOptions: {
      jsx: 4, // JsxEmit.Preserve
      jsxImportSource: "solid-js",
      allowJs: true,
      strict: false,
      noEmit: true,
    },
    skipAddingFilesFromTsConfig: true,
  })

  const results: ShadowViolation[] = []

  for (const filePath of TSX_FILES) {
    const source = project.addSourceFileAtPath(filePath)
    const basename = path.basename(filePath)

    // Find arrow functions whose parameter list includes `t` AND whose body
    // contains JSX — this shadows the outer `t` from useLanguage() in a
    // rendering context, which is almost certainly a bug.
    // Non-JSX callbacks (e.g. `.map((t) => t.id)`) are harmless data transforms.
    source.getDescendantsOfKind(SyntaxKind.ArrowFunction).forEach((arrow) => {
      for (const param of arrow.getParameters()) {
        if (param.getName() === "t") {
          const parent = arrow.getParent()
          if (!parent) continue
          // Allow top-level destructuring like `const { t } = useLanguage()`
          if (Node.isVariableDeclaration(parent)) continue
          // Only flag if the arrow body contains JSX elements
          const hasJsx =
            arrow.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
            arrow.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0
          if (!hasJsx) continue
          results.push({
            file: basename,
            line: param.getStartLineNumber(),
            text: param.getText(),
            context: "arrow parameter shadows i18n t() function in JSX context",
          })
        }
      }
    })

    // Find .map() calls where the callback has a parameter but JSX inside
    // references `{t}` instead of the parameter name
    source.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
      const expr = call.getExpression()
      if (!Node.isPropertyAccessExpression(expr)) return
      if (expr.getName() !== "map") return

      const args = call.getArguments()
      if (args.length === 0) return
      const callback = args[0]
      if (!Node.isArrowFunction(callback)) return

      const params = callback.getParameters()
      if (params.length === 0) return
      const paramName = params[0].getName()

      // If the param is already `t`, it's caught by the shadow check above.
      // Here we check: param is NOT `t`, but JSX inside uses `{t}` — meaning
      // the callback renders the i18n function instead of the loop variable.
      if (paramName === "t") return

      callback.getDescendantsOfKind(SyntaxKind.JsxExpression).forEach((jsx) => {
        const inner = jsx.getExpression()
        if (!inner) return
        if (Node.isIdentifier(inner) && inner.getText() === "t") {
          results.push({
            file: basename,
            line: jsx.getStartLineNumber(),
            text: `{t} inside .map((${paramName}) => ...) — should be {${paramName}}`,
            context: "JSX renders i18n function instead of map callback parameter",
          })
        }
      })
    })
  }

  return results
}

describe("Agent Manager i18n — no hardcoded strings", () => {
  const violations = findViolations()

  it("should have no hardcoded user-facing strings in agent manager TSX files", () => {
    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}:${v.line} [${v.context}] "${v.text}"`).join("\n")
      expect(violations, `Found ${violations.length} hardcoded string(s):\n${report}`).toEqual([])
    }
    expect(violations).toEqual([])
  })
})

describe("Agent Manager i18n — no t() shadowing", () => {
  const shadows = findTranslationShadowViolations()

  it("should not shadow the t() translation function in callbacks", () => {
    if (shadows.length > 0) {
      const report = shadows.map((v) => `  ${v.file}:${v.line} [${v.context}] ${v.text}`).join("\n")
      expect(shadows, `Found ${shadows.length} t() shadow/misuse(s):\n${report}`).toEqual([])
    }
    expect(shadows).toEqual([])
  })
})
