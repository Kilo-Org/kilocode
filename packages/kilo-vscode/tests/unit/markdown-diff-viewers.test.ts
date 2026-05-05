import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRoot } from "solid-js"
import { createMarkdownRender } from "../../webview-ui/agent-manager/review-preferences"

const ROOT = join(import.meta.dir, "../..")
const files = {
  view: join(ROOT, "webview-ui/agent-manager/MarkdownDiffView.tsx"),
  panel: join(ROOT, "webview-ui/agent-manager/DiffPanel.tsx"),
  full: join(ROOT, "webview-ui/agent-manager/FullScreenDiffView.tsx"),
  virtual: join(ROOT, "webview-ui/diff-virtual/DiffVirtualApp.tsx"),
  viewer: join(ROOT, "webview-ui/diff-viewer/DiffViewerApp.tsx"),
  provider: join(ROOT, "src/DiffViewerProvider.ts"),
  vprovider: join(ROOT, "src/DiffVirtualProvider.ts"),
  manager: join(ROOT, "src/agent-manager/AgentManagerProvider.ts"),
}

function src(file: string) {
  return readFileSync(file, "utf-8")
}

function expectInlineViewer(file: string) {
  const code = src(file)
  expect(code).toContain("isMarkdownFile(diff.file) && props.onMarkdownRenderChange")
  expect(code).toContain("props.onMarkdownRenderChange?.(!props.markdownRender)")
  expect(code).toContain("props.markdownRender && isMarkdownFile(diff.file)")
  expect(code).toContain("<MarkdownDiffView diff={diff} />")
  expect(code).toMatch(
    /fallback=\{\s*<Diff[\s\S]*?before=\{\{ name: diff\.file, contents: diff\.before \}\}[\s\S]*?after=\{\{ name: diff\.file, contents: diff\.after \}\}/,
  )
}

describe("Markdown diff viewer", () => {
  it("detects only Markdown file extensions", () => {
    const code = src(files.view)
    expect(code).toContain("return /\\.(md|mdx|markdown)$/i.test(file)")
  })

  it("keeps added, deleted, unchanged, and modified Markdown rendering branches", () => {
    const code = src(files.view)
    expect(code).toContain('props.diff.status === "added" ? "" : props.diff.before')
    expect(code).toContain('props.diff.status === "deleted" ? "" : props.diff.after')
    expect(code).toContain("before().length > 0 && after().length > 0 && before() !== after()")
    expect(code).toContain('data-split={split() ? "true" : undefined}')
    expect(code).toContain("<Markdown text={after() || before()} cacheKey={`${props.diff.file}:rendered`} />")
    expect(code).toContain("<Markdown text={before()} cacheKey={`${props.diff.file}:before`} />")
    expect(code).toContain("<Markdown text={after()} cacheKey={`${props.diff.file}:after`} />")
  })
})

describe("Markdown diff preference", () => {
  it("posts Agent Manager preference changes only when the render value changes", () => {
    createRoot((dispose) => {
      const calls: Array<{ type: "agentManager.setReviewMarkdownRender"; render: boolean }> = []
      const pref = createMarkdownRender({ postMessage: (msg) => calls.push(msg) })

      pref.update(true)
      pref.update(true)
      pref.setRender(false)
      pref.update(false)

      expect(calls).toEqual([{ type: "agentManager.setReviewMarkdownRender", render: true }])
      dispose()
    })
  })
})

describe("Markdown diff viewer wiring", () => {
  it("keeps inline and fullscreen Agent Manager viewers behind Markdown detection with raw diff fallback", () => {
    expectInlineViewer(files.panel)
    expectInlineViewer(files.full)
  })

  it("propagates Markdown render preferences through standalone and virtual diff viewers", () => {
    const viewer = src(files.viewer)
    expect(viewer).toContain('if (msg.type === "diffViewer.markdownRender")')
    expect(viewer).toContain("setMarkdown(msg.render)")
    expect(viewer).toContain('post({ type: "diffViewer.setMarkdownRender", render })')

    const virtual = src(files.virtual)
    expect(virtual).toContain("setMarkdown(msg.markdownRender === true)")
    expect(virtual).toContain('getVSCodeAPI().postMessage({ type: "diffVirtual.setMarkdownRender", render: next })')
    expect(virtual).toContain("markdown() && isMarkdownFile(d().file)")
    expect(virtual).toContain(
      "<MarkdownDiffView diff={{ file: d().file, before: resolved().before, after: resolved().after }} />",
    )
  })

  it("persists and re-sends Markdown render preferences from extension providers", () => {
    const provider = src(files.provider)
    expect(provider).toContain('this.post({ type: "diffViewer.markdownRender", render: getDiffMarkdownRender() })')
    expect(provider).toContain('if (type === "diffViewer.setMarkdownRender" && typeof msg.render === "boolean")')
    expect(provider).toContain("void setDiffMarkdownRender(msg.render)")

    const vprovider = src(files.vprovider)
    expect(vprovider).toContain("markdownRender: getDiffMarkdownRender()")
    expect(vprovider).toContain('if (type === "diffVirtual.setMarkdownRender" && typeof msg.render === "boolean")')
    expect(vprovider).toContain("void setDiffMarkdownRender(msg.render)")

    const manager = src(files.manager)
    expect(manager).toContain('if (m.type === "agentManager.setReviewMarkdownRender")')
    expect(manager).toContain("void setDiffMarkdownRender(m.render).then(() => this.pushState())")
    expect(manager.match(/reviewMarkdownRender: getDiffMarkdownRender\(\)/g)).toHaveLength(2)
  })
})
