/**
 * Runtime contract tests for kilo-vscode's dependencies on @kilocode/kilo-ui.
 *
 * These tests import the upstream UI modules directly and verify at runtime
 * that the exports kilo-vscode depends on still exist with the expected shape.
 *
 * Because the upstream modules use SolidJS JSX (jsxImportSource: "solid-js"),
 * they must be loaded from within packages/kilo-ui/ where bun picks up the
 * correct tsconfig. We use Bun.spawnSync to run a small check script in that
 * context.
 *
 * TypeScript types (OpenFileFn, ToolProps, ToolInfo) are erased at runtime,
 * so those are verified via source analysis on the upstream file.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { Window } from "happy-dom"
import { markBidi } from "../../../ui/src/kilocode/markdown-bidi"

const MONOREPO_ROOT = path.resolve(import.meta.dir, "../../../..")
const KILO_UI_DIR = path.join(MONOREPO_ROOT, "packages/kilo-ui")
const BASIC_TOOL_FILE = path.join(MONOREPO_ROOT, "packages/ui/src/components/basic-tool.tsx")
const DATA_CONTEXT_FILE = path.join(MONOREPO_ROOT, "packages/ui/src/context/data.tsx")
const MESSAGE_PART_FILE = path.join(MONOREPO_ROOT, "packages/ui/src/components/message-part.tsx")
const KILO_MESSAGE_PART_FILE = path.join(MONOREPO_ROOT, "packages/kilo-ui/src/components/message-part.tsx")
const KILO_MESSAGE_HIGHLIGHT_FILE = path.join(MONOREPO_ROOT, "packages/kilo-ui/src/components/message-highlight.ts")
const KILO_MESSAGE_PART_CSS_FILE = path.join(MONOREPO_ROOT, "packages/kilo-ui/src/components/message-part.css")
const SHELL_ROLLING_FILE = path.join(MONOREPO_ROOT, "packages/kilo-ui/src/components/shell-rolling-results.tsx")
const ASSISTANT_MESSAGE_FILE = path.join(
  MONOREPO_ROOT,
  "packages/kilo-vscode/webview-ui/src/components/chat/AssistantMessage.tsx",
)
const CHAT_LAYOUT_FILE = path.join(MONOREPO_ROOT, "packages/kilo-vscode/webview-ui/src/styles/chat-layout.css")

function check(code: string): { ok: boolean; output: string } {
  const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", code], {
    cwd: KILO_UI_DIR,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  return {
    ok: result.exitCode === 0,
    output: stdout + stderr,
  }
}

/**
 * Tool names that kilo-vscode overrides or uses directly.
 * Sources:
 *   - VscodeToolOverrides.tsx: "bash"
 *   - TaskToolExpanded.tsx:    "task"
 *   - TaskToolExpanded.tsx uses getToolInfo() which handles all of these
 */
const TOOL_NAMES_WE_DEPEND_ON = ["bash", "task", "read", "write", "glob", "edit", "todowrite"]

describe("ToolRegistry tool name contract (runtime)", () => {
  it("all tools used by kilo-vscode are registered in ToolRegistry", () => {
    const names = JSON.stringify(TOOL_NAMES_WE_DEPEND_ON)
    const result = check(`
      const hist = { state: null, length: 1, replaceState(s) { hist.state = s }, pushState(s) { hist.state = s }, go() {} }
      const mql = { matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
      globalThis.window = globalThis.window || { history: hist, location: { pathname: "/", search: "", hash: "", href: "/", origin: "" }, scrollTo() {}, addEventListener() {}, removeEventListener() {}, confirm() { return false }, matchMedia() { return mql } }
      const { ToolRegistry } = await import("./src/components/message-part.tsx")
      const names = ${names}
      const missing = names.filter(n => typeof ToolRegistry.render(n) !== "function")
      if (missing.length) {
        console.error("Missing tools: " + missing.join(", "))
        process.exit(1)
      }
      console.log("ok")
      process.exit(0)
    `)
    expect(result.ok, `ToolRegistry check failed: ${result.output}`).toBe(true)
  })
})

describe("getToolInfo() export contract (runtime)", () => {
  it("getToolInfo is an exported function", () => {
    // Note: getToolInfo() calls useI18n() internally, so we cannot invoke it
    // outside a SolidJS rendering context. We verify it exists as a function.
    const result = check(`
      const hist = { state: null, length: 1, replaceState(s) { hist.state = s }, pushState(s) { hist.state = s }, go() {} }
      const mql = { matches: false, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
      globalThis.window = globalThis.window || { history: hist, location: { pathname: "/", search: "", hash: "", href: "/", origin: "" }, scrollTo() {}, addEventListener() {}, removeEventListener() {}, confirm() { return false }, matchMedia() { return mql } }
      const { getToolInfo } = await import("./src/components/message-part.tsx")
      if (typeof getToolInfo !== "function") {
        console.error("getToolInfo is " + typeof getToolInfo)
        process.exit(1)
      }
      console.log("ok")
      process.exit(0)
    `)
    expect(result.ok, `getToolInfo check failed: ${result.output}`).toBe(true)
  })

  it("ToolInfo type still declares icon and title fields (source)", () => {
    // ToolInfo is a TypeScript type erased at runtime, so we verify via source
    const src = fs.readFileSync(MESSAGE_PART_FILE, "utf-8")
    expect(src).toMatch(/export type ToolInfo\s*=\s*\{[^}]*icon\s*:/s)
    expect(src).toMatch(/export type ToolInfo\s*=\s*\{[^}]*title\s*:/s)
  })
})

describe("DataProvider contract (runtime)", () => {
  it("DataProvider and useData are exported functions", () => {
    const result = check(`
      import { DataProvider, useData } from "./src/context/data.tsx"
      if (typeof DataProvider !== "function") {
        console.error("DataProvider is " + typeof DataProvider)
        process.exit(1)
      }
      if (typeof useData !== "function") {
        console.error("useData is " + typeof useData)
        process.exit(1)
      }
      console.log("ok")
    `)
    expect(result.ok, `DataProvider check failed: ${result.output}`).toBe(true)
  })

  it("DataProvider accepts onOpenFile prop and exports OpenFileFn (source)", () => {
    // onOpenFile and OpenFileFn are `kilocode_change` additions — TypeScript types
    // erased at runtime, so we verify via source analysis
    const src = fs.readFileSync(DATA_CONTEXT_FILE, "utf-8")
    expect(src).toContain("onOpenFile")
    expect(src).toContain("OpenFileFn")
    expect(src).toMatch(/openFile:\s*props\.onOpenFile/)
  })

  it("DataProvider accepts onOpenDiff prop and exports OpenDiffFn (source)", () => {
    // onOpenDiff and OpenDiffFn are `kilocode_change` additions — TypeScript types
    // erased at runtime, so we verify via source analysis
    const src = fs.readFileSync(DATA_CONTEXT_FILE, "utf-8")
    expect(src).toContain("onOpenDiff")
    expect(src).toContain("OpenDiffFn")
    expect(src).toMatch(/openDiff:\s*props\.onOpenDiff/)
  })

  it("DataProvider accepts onOpenContent prop and exports OpenContentFn (source)", () => {
    const src = fs.readFileSync(DATA_CONTEXT_FILE, "utf-8")
    expect(src).toContain("onOpenContent")
    expect(src).toContain("OpenContentFn")
    expect(src).toMatch(/openContent:\s*props\.onOpenContent/)
  })
})

describe("Assistant Markdown streaming contract (source)", () => {
  const src = fs.readFileSync(KILO_MESSAGE_PART_FILE, "utf-8")
  const block =
    src.match(
      /PART_MAPPING\["text"\]\s*=\s*function TextPartDisplay[\s\S]*?(?=\/\/ Expanded mode|PART_MAPPING\["reasoning"\])/,
    )?.[0] ?? ""

  it("passes active text streams through Markdown's streaming mode", () => {
    expect(block).not.toBe("")
    expect(block).toContain("streaming={streaming()}")
  })
})

describe("Markdown bidirectional rendering contract", () => {
  it("adds dir to direction-owning markdown blocks without nesting it inside containers", () => {
    const win = new Window()
    const root = win.document.createElement("div")
    root.innerHTML = `
      <h1>عنوان ۱</h1>
      <h2>عنوان ۲</h2>
      <h3>عنوان ۳</h3>
      <h4>عنوان ۴</h4>
      <h5>عنوان ۵</h5>
      <h6>عنوان ۶</h6>
      <p>متن فارسی با <code>inline</code></p>
      <blockquote><p>نقل قول فارسی</p></blockquote>
      <ul><li>مورد اول<ul><li>مورد دوم</li></ul></li></ul>
      <table><thead><tr><th>ستون</th></tr></thead><tbody><tr><td>کیلو</td></tr></tbody></table>
      <pre><code data-lang="ts">const value = "کیلو"</code></pre>
    `

    markBidi(root)

    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
      expect(root.querySelector(tag)?.getAttribute("dir")).toBe("auto")
    }
    expect(root.querySelector("p")?.getAttribute("dir")).toBe("auto")
    expect(root.querySelector("blockquote")?.getAttribute("dir")).toBe("auto")
    expect(root.querySelector("ul")?.getAttribute("dir")).toBe("auto")
    expect(root.querySelector("table")?.getAttribute("dir")).toBe("auto")
    expect(root.querySelector("pre")?.getAttribute("dir")).toBe("auto")
    expect(root.querySelector(":not(pre) > code")?.getAttribute("dir")).toBe("auto")

    expect(root.querySelector("blockquote p")?.hasAttribute("dir")).toBe(false)
    expect(root.querySelector("li")?.hasAttribute("dir")).toBe(false)
    expect(root.querySelector("td")?.hasAttribute("dir")).toBe(false)
  })
})

describe("Edit tool diff-first click contract (source)", () => {
  const src = fs.readFileSync(KILO_MESSAGE_PART_FILE, "utf-8")

  const editBlockMatch = src.match(/ToolRegistry\.register\(\{\s*name:\s*"edit"[\s\S]*?(?=ToolRegistry\.register\(|$)/)
  const editBlock = editBlockMatch?.[0] ?? ""

  it("edit tool renders from filediff.patch and falls back to tool input", () => {
    expect(editBlock).toContain("normalize(diff)")
    expect(editBlock).toMatch(/props\.input\.oldString\s*\?\?\s*""/)
    expect(editBlock).toMatch(/props\.input\.newString\s*\?\?\s*""/)
  })
})

describe("Write and apply_patch patch rendering contracts (source)", () => {
  const src = fs.readFileSync(KILO_MESSAGE_PART_FILE, "utf-8")
  const writeBlock =
    src.match(/ToolRegistry\.register\(\{\s*name:\s*"write"[\s\S]*?(?=ToolRegistry\.register\(|$)/)?.[0] ?? ""
  const patchBlock =
    src.match(/ToolRegistry\.register\(\{\s*name:\s*"apply_patch"[\s\S]*?(?=ToolRegistry\.register\(|$)/)?.[0] ?? ""

  it("write tool can render from filediff.patch when input.content is stripped", () => {
    expect(writeBlock).toContain("normalize(diff)")
    expect(writeBlock).toContain("props.input.content || view()")
    expect(writeBlock).toContain('mode="diff"')
  })

  it("apply_patch tool can render from patch metadata without before/after", () => {
    expect(patchBlock).toContain("file.patch")
    expect(patchBlock).toContain("normalize({")
    expect(patchBlock).toContain("file: file.relativePath")
    expect(patchBlock).toContain('mode="diff"')
  })
})

describe("Bash tool static terminal preview (source)", () => {
  const src = fs.readFileSync(KILO_MESSAGE_PART_FILE, "utf-8")
  const block =
    src.match(/ToolRegistry\.register\(\{\s*name:\s*"bash"[\s\S]*?(?=ToolRegistry\.register\(|$)/)?.[0] ?? ""

  it("bash tool renders BashHighlightedOutput", () => {
    expect(block).toContain("BashHighlightedOutput")
  })

  it("does not animate expanded bash details", () => {
    expect(block).toMatch(/allowPendingToggle\s+trigger=/)
    expect(block).not.toMatch(/allowPendingToggle\s+animated/)
  })

  it("BashHighlightedOutput syntax highlights the command next to the prompt", () => {
    expect(src).toContain('data-slot="bash-terminal" data-kind="command"')
    expect(src).toContain('data-slot="bash-prompt"')
    expect(src).toContain('data-slot="bash-section-code" data-scrollable ref={cmdRef}')
    expect(src).toContain('data-lang="shellscript"')
    expect(src).toContain("escapeHtml(cmd)")
  })

  it("BashHighlightedOutput syntax highlights log output", () => {
    expect(src).toContain('data-slot="bash-terminal" data-kind="output"')
    expect(src).toContain('data-slot="bash-section-code" data-scrollable ref={outRef}')
    expect(src).toContain('data-lang="log"')
    expect(src).toContain("escapeHtml(out)")
  })

  it("BashHighlightedOutput highlights only while expanded", () => {
    expect(src).toContain("if (!props.active) return")
    expect(block).toContain("active={open()}")
  })

  it("BashHighlightedOutput keeps command and output in separate terminal containers", () => {
    const slots = src.match(/data-slot="bash-terminal"/g) ?? []
    expect(slots).toHaveLength(2)
  })

  it("BashHighlightedOutput does not render shell section labels or a divider", () => {
    expect(src).not.toMatch(/data-slot="mcp-section-label".*shell\./)
    expect(src).not.toContain('data-slot="bash-divider"')
  })

  it("BashHighlightedOutput supports openContent for opening output in editor", () => {
    expect(src).toContain("data.openContent")
    expect(src).toContain("openInEditor")
  })

  it("BashHighlightedOutput opens full output file when truncated", () => {
    // When the CLI truncates output, metadata.outputPath holds the full file.
    // openInEditor should prefer openFile(outputPath) over openContent.
    expect(src).toContain("props.outputPath")
    expect(src).toMatch(/props\.outputPath.*data\.openFile/)
  })

  it("bash tool passes outputPath from metadata to BashHighlightedOutput", () => {
    expect(block).toContain("props.metadata.outputPath")
  })
})

describe("Expanded tool motion and typography (source)", () => {
  it("animates completed rolling shell details", () => {
    const src = fs.readFileSync(SHELL_ROLLING_FILE, "utf-8")
    expect(src).toContain("useCollapsible({")
    expect(src).toContain("content: () => contentRef")
    expect(src).toContain("body: () => bodyRef")
  })

  it("uses the assistant markdown line-height ratio for reasoning output", () => {
    const css = fs.readFileSync(KILO_MESSAGE_PART_CSS_FILE, "utf-8")
    const block = css.match(
      /html\[data-theme="kilo-vscode"\] \[data-component="reasoning-part"\][\s\S]*?(?=@keyframes reasoning-pulse)/,
    )?.[0]
    expect(block).toMatch(/\[data-component="markdown"\]\s*\{[^}]*line-height:\s*160%;/)
  })
})

describe("HighlightedText @mention regex fallback and click handler (source)", () => {
  const src = fs.readFileSync(KILO_MESSAGE_PART_FILE, "utf-8")
  const helper = fs.readFileSync(KILO_MESSAGE_HIGHLIGHT_FILE, "utf-8")

  it("detects @path patterns via regex when source offsets are missing", () => {
    // detect is the regex fallback for when the backend doesn't populate FilePart.source.text.{start,end}
    expect(src).toContain("buildHighlightedTextSegments")
    expect(helper).toMatch(/MENTION_RE/)
    expect(helper).toMatch(/refs\.length\s*>\s*0\s*\?\s*resolve\(text,\s*refs\)\s*:\s*detect\(text\)/)
  })

  it("prefers source offsets over regex when both are available", () => {
    expect(helper).toMatch(/const refs = \[/)
    expect(helper).toMatch(/refs\.length\s*>\s*0\s*\?\s*resolve\(text,\s*refs\)\s*:\s*detect\(text\)/)
  })

  it("file mention spans are clickable via data.openFile", () => {
    expect(src).toContain("data-clickable")
    expect(src).toMatch(/segment\.type\s*===\s*"file".*data\.openFile/)
  })

  it("click handler strips @ prefix before calling openFile", () => {
    expect(src).toMatch(/segment\.text\.replace\(\/\^@\//)
  })

  it("does not duplicate HTML escaping helpers", () => {
    expect(src).not.toMatch(/function escapeHtml/)
  })
})

describe("AssistantMessage visible row contract (source)", () => {
  const src = fs.readFileSync(ASSISTANT_MESSAGE_FILE, "utf-8")

  it("filters suppressed tools that have no visible renderer", () => {
    expect(src).toContain('state.status === "completed" && !!ToolRegistry.render(tool)')
  })

  it("filters pending questions until their dock request exists", () => {
    expect(src).toContain('part.state.status !== "pending" && part.state.status !== "running"')
    expect(src).toContain('matchToolRequest(part, "question", session.questions())')
  })

  it("filters completed synthetic text and redaction-only reasoning", () => {
    expect(src).toContain('part.type === "text" && part.synthetic && props.message.time.completed')
    expect(src).toContain('.text?.replace("[REDACTED]", "").trim()')
  })

  it("uses the plan exit card only when plan metadata is renderable", () => {
    expect(src).toContain("if (!planExitInfo(part)) return")
  })
})

describe("Assistant transcript spacing contract (source)", () => {
  const css = fs.readFileSync(CHAT_LAYOUT_FILE, "utf-8")

  it("uses a 6px gap between virtualized assistant rows", () => {
    expect(css).toMatch(/\.vscode-session-turn\[data-row="assistant"\]\s*\{\s*padding-bottom: 6px;/)
  })

  it("removes spacing from assistant rows without visible content", () => {
    expect(css).toMatch(
      /\.vscode-session-turn\[data-row="assistant"\]:has\(> \.vscode-session-turn-assistant:empty\)\s*\{\s*padding-bottom: 0;/,
    )
  })
})

describe("BasicTool export contract (runtime)", () => {
  it("BasicTool and GenericTool are exported from basic-tool", () => {
    const result = check(`
      const { BasicTool, GenericTool } = await import("./src/components/basic-tool.tsx")
      if (typeof BasicTool !== "function") {
        console.error("BasicTool is " + typeof BasicTool)
        process.exit(1)
      }
      if (typeof GenericTool !== "function") {
        console.error("GenericTool is " + typeof GenericTool)
        process.exit(1)
      }
      console.log("ok")
      process.exit(0)
    `)
    expect(result.ok, `BasicTool export check failed: ${result.output}`).toBe(true)
  })
})

describe("Collapsed deferred tool details contract (source)", () => {
  const basic = fs.readFileSync(BASIC_TOOL_FILE, "utf-8")
  const message = fs.readFileSync(KILO_MESSAGE_PART_FILE, "utf-8")

  it("uses an explicit details hint before touching deferred children", () => {
    expect(basic).toContain("hasDetails?: boolean")
    expect(basic).toContain("props.hasDetails ?? !!hasChildren()")
    expect(basic).toMatch(/<Show when=\{!props\.defer \|\| ready\(\)\}>\{props\.children\}<\/Show>/)
  })

  it("opts edit-family transcript cards into collapsed lazy details", () => {
    for (const name of ["edit", "write", "apply_patch"]) {
      const block =
        message.match(
          new RegExp(`ToolRegistry\\.register\\(\\{\\s*name:\\s*"${name}"[\\s\\S]*?(?=ToolRegistry\\.register\\(|$)`),
        )?.[0] ?? ""
      expect(block).toContain("defer")
      expect(block).toContain("hasDetails")
    }
  })

  it("lazy-mounts completed bash output and retains it after first expansion", () => {
    const block =
      message.match(/ToolRegistry\.register\(\{\s*name:\s*"bash"[\s\S]*?(?=ToolRegistry\.register\(|$)/)?.[0] ?? ""
    expect(block).toContain("const [mounted, setMounted] = createSignal(open())")
    expect(block).toMatch(/if \(open\(\) \|\| pending\(\)\) setMounted\(true\)/)
    expect(block).toContain("hasDetails")
    expect(block).toMatch(/<Show when=\{mounted\(\)\}>[\s\S]*?<BashHighlightedOutput/)
  })
})
