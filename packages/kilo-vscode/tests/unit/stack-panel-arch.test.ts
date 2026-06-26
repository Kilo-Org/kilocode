import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const extension = fs.readFileSync(path.join(root, "src/extension.ts"), "utf-8")
const kilo = fs.readFileSync(path.join(root, "src/KiloProvider.ts"), "utf-8")
const panel = fs.readFileSync(path.join(root, "src/StackPanelProvider.ts"), "utf-8")
const client = fs.readFileSync(path.join(root, "src/stack/client.ts"), "utf-8")
const controller = fs.readFileSync(path.join(root, "src/stack/panel-controller.ts"), "utf-8")
const context = fs.readFileSync(path.join(root, "webview-ui/src/context/stack.tsx"), "utf-8")
const wizard = fs.readFileSync(path.join(root, "webview-ui/src/components/stack/StackWizard.tsx"), "utf-8")
const vertical = fs.readFileSync(path.join(root, "webview-ui/src/components/stack/VerticalStep.tsx"), "utf-8")
const states = fs.readFileSync(path.join(root, "webview-ui/src/components/stack/StackStates.tsx"), "utf-8")
const pkg = fs.readFileSync(path.join(root, "package.json"), "utf-8")
const build = fs.readFileSync(path.join(root, "esbuild.js"), "utf-8")

describe("standalone Stack Builder architecture", () => {
  it("registers the command, provider, and panel serializer", () => {
    expect(extension).toContain("new StackPanelProvider(context.extensionUri, connectionService)")
    expect(extension).toContain("registerWebviewPanelSerializer(StackPanelProvider.viewType")
    expect(extension).toContain('registerCommand("kilo-code.new.stackBuilderOpen"')
    expect(extension).toContain('registerCommand("kilo-code.new.sidebarTitle.stackBuilderOpen"')
    expect(pkg).toContain('"command": "kilo-code.new.stackBuilderOpen"')
    expect(pkg).toContain('"command": "kilo-code.new.sidebarTitle.stackBuilderOpen"')
  })

  it("uses a standalone webview bundle", () => {
    expect(panel).toContain('"dist", "stack.js"')
    expect(panel).not.toContain('"dist", "webview.js"')
    expect(build).toContain('"webview-ui/stack/index.tsx", "dist/stack.js"')
  })

  it("uses the generated Stack SDK through KiloConnectionService", () => {
    expect(panel).toContain("new StackHttpClient(connection)")
    expect(client).toContain("client.stack.catalog")
    expect(client).toContain("client.stack.preview")
    expect(client).toContain("client.stack.apply")
    expect(client).not.toContain("fetch(")
    expect(panel).not.toContain("MarketplaceService")
    for (const type of ["stackLoad", "stackPreview", "stackApply", "stackCancel"]) {
      expect(kilo).not.toContain(`case "${type}"`)
    }
  })

  it("guards restored panels, project changes, and workspace removal", () => {
    expect(panel).toContain("stackRestoreProject")
    expect(panel).toContain("onDidChangeWorkspaceFolders")
    expect(panel).toContain("this.controller?.dispose()")
    expect(controller).toContain("private disposed = false")
    expect(controller).toContain("token.request === this.request")
  })

  it("forwards every webview stack action to the controller", () => {
    for (const type of ["stackLoad", "stackCancel", "stackDetect", "stackPreview", "stackApply"]) {
      expect(panel).toContain(`case "${type}"`)
    }
  })

  it("preserves loaded drafts and applies only the exact reviewed draft", () => {
    expect(context).toContain("cloneDraft(next.state.draft)")
    expect(context).toContain("cloneDraft(message.plan.draft)")
    expect(context).toContain("cloneDraft(review.draft)")
    expect(context).not.toContain("sanitizeDraft")
  })

  it("uses Marketplace coverage as status instead of an action gate", () => {
    expect(context).not.toContain("!ready()")
    expect(wizard).not.toContain("|| !stack.ready()")
    expect(vertical).not.toContain("disabled={!stack.ready()")
  })

  it("announces project-required state and retains typed apply failure details", () => {
    expect(states).toContain('role="alert"')
    expect(states).toContain('aria-live="assertive"')
    expect(states).toContain("heading.focus()")
    expect(states).toContain("failure()?.results")
    expect(states).toContain("detail().rollback")
  })
})
