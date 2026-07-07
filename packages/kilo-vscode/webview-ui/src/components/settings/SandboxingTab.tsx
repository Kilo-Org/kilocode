import { Component, For, createMemo, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

const description = "sandbox-network-description"
const writablePathsDescription = "sandbox-writable-paths-description"

const SandboxingTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()
  const experimental = createMemo(() => config().experimental ?? {})
  const [newPath, setNewPath] = createSignal("")

  const writablePaths = () => experimental().sandbox_writable_paths ?? []

  const addPath = () => {
    const value = newPath().trim()
    if (!value) return
    const current = [...writablePaths()]
    if (!current.includes(value)) {
      current.push(value)
      updateConfig({
        experimental: { ...experimental(), sandbox_writable_paths: current },
      })
    }
    setNewPath("")
  }

  const removePath = (index: number) => {
    const current = [...writablePaths()]
    current.splice(index, 1)
    updateConfig({
      experimental: { ...experimental(), sandbox_writable_paths: current },
    })
  }

  return (
    <Card>
      <SettingsRow
        title={language.t("settings.sandboxing.network.title")}
        description={language.t("settings.sandboxing.network.description")}
        descriptionId={description}
      >
        <Switch
          checked={experimental().sandbox_restrict_network !== false}
          inputProps={{ "aria-describedby": description }}
          onChange={(checked) =>
            updateConfig({
              experimental: {
                ...experimental(),
                sandbox_restrict_network: checked,
              },
            })
          }
          hideLabel
        >
          {language.t("settings.sandboxing.network.title")}
        </Switch>
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.sandboxing.writablePaths.title")}
        description={language.t("settings.sandboxing.writablePaths.description")}
        descriptionId={writablePathsDescription}
        last
      >
        <div style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              gap: "8px",
              "align-items": "center",
              padding: "8px 0",
              "border-bottom": writablePaths().length > 0 ? "1px solid var(--border-weak-base)" : "none",
            }}
          >
            <div style={{ flex: 1 }}>
              <TextField
                value={newPath()}
                placeholder="/tmp"
                onChange={(val) => setNewPath(val)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter") addPath()
                }}
                hideLabel
                label={language.t("settings.sandboxing.writablePaths.title")}
              />
            </div>
            <Button variant="secondary" onClick={addPath}>
              {language.t("common.add")}
            </Button>
          </div>
          <For each={writablePaths()}>
            {(path, index) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "6px 0",
                  "border-bottom": index() < writablePaths().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                }}
              >
                <span
                  style={{
                    "font-family": "var(--vscode-editor-font-family, monospace)",
                    "font-size": "var(--kilo-font-size-12)",
                  }}
                >
                  {path}
                </span>
                <IconButton size="small" variant="ghost" icon="close" onClick={() => removePath(index())} />
              </div>
            )}
          </For>
        </div>
      </SettingsRow>
    </Card>
  )
}

export default SandboxingTab
