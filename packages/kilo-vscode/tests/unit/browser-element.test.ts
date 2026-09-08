import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Window } from "happy-dom"
import { capture, locate } from "../../src/services/browser-automation/browser-element"

const windows: Window[] = []

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()))
})

function inspect(html: string, selector: string, detail = true) {
  const window = new Window({ url: "http://localhost:3000/" })
  windows.push(window)
  window.document.body.innerHTML = html
  const node = window.document.querySelector(selector)
  if (!node) throw new Error("Selected test element is missing")
  Object.defineProperty(window.document, "elementFromPoint", { value: () => node })
  const run = new Function(
    "document",
    "Element",
    "CSS",
    "innerWidth",
    "innerHeight",
    "getComputedStyle",
    `return (${capture.toString()})(${JSON.stringify({ x: 0.5, y: 0.5, detail })})`,
  )
  const result = run(
    window.document,
    window.Element,
    window.CSS,
    window.innerWidth,
    window.innerHeight,
    window.getComputedStyle.bind(window),
  ) as ReturnType<typeof capture> | undefined
  if (!result) throw new Error("Browser element capture returned no element")
  return { result, node, document: window.document }
}

describe("browser element context", () => {
  test("builds a unique selector and bounded ancestry for repeated buttons without ids", () => {
    const selected = inspect(
      '<main id="app"><section class="hero"><div class="actions"><button class="primary">Save</button><button class="primary">Cancel</button></div></section><section><button class="primary">Save</button></section></main>',
      ".actions button:first-child",
    )
    expect(selected.document.querySelectorAll(selected.result.selector)).toHaveLength(1)
    expect(selected.document.querySelector(selected.result.selector)).toBe(selected.node)
    expect(selected.result.hierarchy).toEqual([
      "html",
      "body",
      "main#app",
      "section.hero",
      "div.actions",
      "button.primary",
    ])
    expect(selected.result.html).toBe('<button class="primary">Save</button>')
  })

  test("prefers stable test ids and does not trust duplicate element ids", () => {
    const stable = inspect('<button data-testid="checkout">Pay</button><button>Pay</button>', "[data-testid]")
    expect(stable.result.selector).toBe('button[data-testid="checkout"]')
    const duplicate = inspect(
      '<div><button id="duplicate">One</button><button id="duplicate">Two</button></div>',
      "button:last-child",
    )
    expect(duplicate.result.selector).not.toBe("#duplicate")
    expect(duplicate.document.querySelectorAll(duplicate.result.selector)).toHaveLength(1)
    expect(duplicate.document.querySelector(duplicate.result.selector)).toBe(duplicate.node)
  })

  test("excludes scripts, handlers, arbitrary attributes, hidden text, and input values", () => {
    const selected = inspect(
      '<button id="save" onclick="secret()" data-api-key="secret-token" aria-label="Save"><span>Save</span><script>secret-code</script><input value="secret-input"><textarea>secret-textarea</textarea><span hidden>secret-hidden</span><span style="display:none">secret-css</span><span style="visibility:hidden">secret-invisible</span><span style="opacity:0">secret-transparent</span><span contenteditable>secret-editable</span></button>',
      "#save",
    )
    expect(selected.result.text).toBe("Save")
    expect(selected.result.html).toBe('<button id="save" aria-label="Save">Save</button>')
    expect(JSON.stringify(selected.result)).not.toContain("secret")
    const password = inspect('<input type="password" value="private-password" aria-label="Password">', "input")
    expect(password.result.text).toBe("Password")
    expect(JSON.stringify(password.result)).not.toContain("private-password")
  })

  test("provides relevant colors and keeps hover responses lightweight", () => {
    const selected = inspect('<button style="color: white; background-color: rgb(22, 163, 74)">Save</button>', "button")
    expect(selected.result.styles?.backgroundColor).toBe("rgb(22, 163, 74)")
    expect(selected.result.html).not.toContain("style=")
    const hover = inspect('<button id="save">Save</button>', "button", false)
    expect(hover.result.selector).toBe("#save")
    expect(hover.result).not.toHaveProperty("html")
    expect(hover.result).not.toHaveProperty("hierarchy")
    expect(hover.result).not.toHaveProperty("source")
  })

  test("bounds text and HTML instead of copying the entire document", () => {
    const selected = inspect(
      `<main><button class="${"a".repeat(500)}">${"Save ".repeat(500)}</button></main>`,
      "button",
    )
    expect(selected.result.text?.length).toBeLessThanOrEqual(180)
    expect(selected.result.html?.length).toBeLessThanOrEqual(800)
    expect(selected.result.classes?.length).toBeLessThanOrEqual(180)
  })

  test("does not fabricate ambiguous selectors for deeply repeated structures", () => {
    const nested = (depth: number) =>
      `<section>${"<div>".repeat(depth)}<button>Save</button>${"</div>".repeat(depth)}</section>`
    const selected = inspect(nested(26).repeat(2), "section:nth-of-type(2) button")
    expect(selected.document.querySelectorAll(selected.result.selector)).toHaveLength(1)
    expect(selected.document.querySelector(selected.result.selector)).toBe(selected.node)
    expect(() => inspect(nested(150).repeat(2), "section:nth-of-type(2) button")).toThrow(
      "Browser element capture returned no element",
    )
  })

  test("bounds traversal before reading a large selected subtree", () => {
    const selected = inspect(
      `<main id="large">${"<span></span>".repeat(300)}<span>late-private-text</span></main>`,
      "main",
    )
    expect(selected.result.text).toBeUndefined()
    expect(selected.result.html).toBe('<main id="large"></main>')
  })

  test("accepts only existing source files within the owning workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kilo-browser-source-"))
    try {
      const project = path.join(root, "project")
      await mkdir(path.join(project, "src"), { recursive: true })
      await writeFile(path.join(project, "src", "Button.tsx"), "export const Button = () => {\n\n\n  return null\n}")
      await writeFile(path.join(root, "private.ts"), "export const privateValue = true")
      await writeFile(path.join(project, ".env"), "SECRET=value")
      await symlink(path.join(root, "private.ts"), path.join(project, "src", "external.ts"))
      expect(await locate(project, { file: "src/Button.tsx", line: 4, column: 2 })).toEqual({
        file: "src/Button.tsx",
        line: 4,
        column: 2,
      })
      expect(await locate(project, { file: "src/Button.tsx", line: 999, column: 2 })).toEqual({
        file: "src/Button.tsx",
        line: undefined,
        column: undefined,
      })
      expect(await locate(project, { file: "src/missing.tsx" })).toBeUndefined()
      expect(await locate(project, { file: "../private.ts" })).toBeUndefined()
      expect(await locate(project, { file: "src/external.ts" })).toBeUndefined()
      expect(await locate(project, { file: ".env" })).toBeUndefined()
      expect(await locate(project, { file: "https://example.com/Button.tsx" })).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
