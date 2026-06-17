import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../..")
const source = readFileSync(join(ROOT, "webview-ui/agent-manager/cloud-agent/NewCloudAgentDialog.tsx"), "utf8")
const styles = readFileSync(join(ROOT, "webview-ui/agent-manager/agent-manager.css"), "utf8")
const modes = readFileSync(join(ROOT, "webview-ui/src/components/shared/ModeSwitcher.tsx"), "utf8")
const models = readFileSync(join(ROOT, "webview-ui/src/components/shared/ModelSelector.tsx"), "utf8")

describe("New Cloud Agent dialog contract", () => {
  it("requests sanitized create context and submits only presentation inputs", () => {
    expect(source).toContain("props.state.requestCreateContext()")
    expect(source).toContain("props.state.create({ prompt: prompt().trim(), mode: mode()!, model: model()! })")
    expect(source).not.toMatch(/repository\s*:/)
    expect(source).not.toMatch(/account\s*:/)
    expect(source).not.toMatch(/branch\s*:/)
    expect(source).not.toMatch(/organization/i)
    expect(source).not.toMatch(/token\s*:/)
    expect(source).not.toMatch(/url\s*:/i)
  })

  it("uses the fixed cloud mode allowlist and discovered Kilo models", () => {
    expect(source).toContain("initial, modes as cloudModes, options")
    expect(source).toContain("cloudModes(props.session.agents())")
    expect(source).toContain("options(props.provider.models())")
    expect(source).toContain("<ModeSwitcherBase")
    expect(source).toContain("agents={modes()}")
    expect(source).toContain("<ModelSelectorBase")
    expect(source).toContain("models={models()}")
    expect(source).toContain("favorites={false}")
    expect(source).not.toContain("<Select")
  })

  it("has no fallback model and disables submit when no discovered model is available", () => {
    expect(source).toContain("const [model, setModel] = createSignal<string>()")
    expect(source).toContain("setModel(initial(items, props.session.selected()))")
    expect(source).toContain("if (!prompt().trim() || !mode() || !model()) return false")
    expect(source).not.toContain("kilo-auto/free")
    expect(source).not.toContain("Kilo Auto")
  })

  it("keeps context subtle without exposing the account", () => {
    expect(source).not.toContain("context().account")
    expect(source).not.toContain("agentManager.cloud.create.account")
    expect(source).not.toContain("am-cloud-create-context")
    expect(source).toContain("am-cloud-create-note-repository")
    expect(source).toContain("props.state.context().repository")
  })

  it("gives the prompt more space and centers the dialog within the detail pane", () => {
    expect(styles).toMatch(
      /\.am-cloud-create-prompt\s+\[data-component="input"\]\[data-variant="normal"\]\s+textarea\[data-slot="input-input"\]\s*{[^}]*min-height: 110px/s,
    )
    expect(source).toContain('"--cloud-dialog-offset"')
    expect(source).toContain('document.querySelector<HTMLElement>(".am-sidebar")')
    expect(styles).toContain('[data-component="dialog"]:has(.am-cloud-create-shell)')
  })

  it("keeps visible actions and shared pickers disabled during creation, then closes only after success", () => {
    expect(source).toContain("disabled={props.state.creating()}")
    expect(source).toContain("disabled={!canSubmit()}")
    expect(modes).toContain("disabled?: boolean")
    expect(modes).toContain("get disabled()")
    expect(models).toContain("disabled?: boolean")
    expect(source).toContain("on(props.state.success")
    expect(source).toContain("props.onClose()")
  })

  it("shows an inline reason when sanitized context is unavailable", () => {
    expect(source).toContain('context.status === "signed-out"')
    expect(source).toContain('context.status === "unavailable"')
    expect(source).toContain('props.t("agentManager.cloud.create.contextUnavailable")')
  })
})
