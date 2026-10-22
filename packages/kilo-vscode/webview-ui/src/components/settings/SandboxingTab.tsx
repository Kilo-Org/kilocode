import { Component, For, createMemo, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import SettingsRow from "./SettingsRow"

const enabledDescription = "sandbox-enabled-description"
const networkDescription = "sandbox-network-description"
const allowedHostsDescription = "sandbox-allowed-hosts-description"
const writablePathsDescription = "sandbox-writable-paths-description"

function destination(input: string) {
  const match = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/.exec(input)
  if (!match) return
  if (/^[0-9.]+$/.test(match[1]) || match[1].length > 253) return
  const port = Number(match[2] ?? "443")
  if (
    port < 1 ||
    port > 65535 ||
    match[1].split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))
  )
    return
  return `${match[1]}:${port}`
}

const SandboxingTab: Component = () => {
  const { globalConfig, updateGlobalConfig } = useConfig()
  const language = useLanguage()
  const sandbox = createMemo(() => globalConfig().sandbox ?? {})
  const [newPath, setNewPath] = createSignal("")
  const [newHost, setNewHost] = createSignal("")

  const writablePaths = () => sandbox().writable_paths ?? []
  const allowedHosts = () => sandbox().allowed_hosts ?? []

  const addHost = () => {
    const input = newHost().trim().toLowerCase()
    const value = destination(input)
    if (!value) return
    const current = [...allowedHosts()]
    if (!current.includes(value)) {
      current.push(value)
      updateGlobalConfig({
        sandbox: { ...sandbox(), allowed_hosts: current },
      })
    }
    setNewHost("")
  }

  const removeHost = (index: number) => {
    const current = [...allowedHosts()]
    current.splice(index, 1)
    updateGlobalConfig({
      sandbox: { ...sandbox(), allowed_hosts: current },
    })
  }

  const addPath = () => {
    const value = newPath().trim()
    if (!value) return
    const current = [...writablePaths()]
    if (!current.includes(value)) {
      current.push(value)
      updateGlobalConfig({
        sandbox: { ...sandbox(), writable_paths: current },
      })
    }
    setNewPath("")
  }

  const removePath = (index: number) => {
    const current = [...writablePaths()]
    current.splice(index, 1)
    updateGlobalConfig({
      sandbox: { ...sandbox(), writable_paths: current },
    })
  }

  return (
    <Card>
      <SettingsRow
        title={language.t("settings.sandboxing.enabled.title")}
        description={language.t("settings.sandboxing.enabled.description")}
        descriptionId={enabledDescription}
      >
        <Switch
          checked={sandbox().enabled ?? false}
          inputProps={{ "aria-describedby": enabledDescription }}
          onChange={(checked) =>
            updateGlobalConfig({
              sandbox: { ...sandbox(), enabled: checked },
            })
          }
          hideLabel
        >
          {language.t("settings.sandboxing.enabled.title")}
        </Switch>
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.sandboxing.network.title")}
        description={language.t("settings.sandboxing.network.description")}
        descriptionId={networkDescription}
      >
        <Switch
          checked={sandbox().network !== "allow"}
          disabled={sandbox().enabled !== true}
          inputProps={{ "aria-describedby": networkDescription }}
          onChange={(checked) =>
            updateGlobalConfig({
              sandbox: { ...sandbox(), network: checked ? "deny" : "allow" },
            })
          }
          hideLabel
        >
          {language.t("settings.sandboxing.network.title")}
        </Switch>
      </SettingsRow>

      <div data-variant="wide-input">
        <SettingsRow
          title={language.t("settings.sandboxing.allowedHosts.title")}
          description={language.t("settings.sandboxing.allowedHosts.description")}
          descriptionId={allowedHostsDescription}
        >
          <div style={{ width: "100%" }}>
            <div
              style={{
                display: "flex",
                gap: "8px",
                "align-items": "center",
                padding: "8px 0",
                "border-bottom": allowedHosts().length > 0 ? "1px solid var(--border-weak-base)" : "none",
              }}
            >
              <div style={{ flex: 1 }}>
                <TextField
                  value={newHost()}
                  disabled={sandbox().enabled !== true || sandbox().network === "allow"}
                  placeholder="api.github.com:443"
                  onChange={(val) => setNewHost(val)}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === "Enter") addHost()
                  }}
                  hideLabel
                  label={language.t("settings.sandboxing.allowedHosts.title")}
                />
              </div>
              <Button
                variant="secondary"
                disabled={sandbox().enabled !== true || sandbox().network === "allow"}
                onClick={addHost}
              >
                {language.t("common.add")}
              </Button>
            </div>
            <For each={allowedHosts()}>
              {(host, index) => (
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    padding: "6px 0",
                    "border-bottom": index() < allowedHosts().length - 1 ? "1px solid var(--border-weak-base)" : "none",
                  }}
                >
                  <span
                    style={{
                      "font-family": "var(--vscode-editor-font-family, monospace)",
                      "font-size": "var(--kilo-font-size-12)",
                    }}
                  >
                    {host}
                  </span>
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    disabled={sandbox().enabled !== true || sandbox().network === "allow"}
                    onClick={() => removeHost(index())}
                  />
                </div>
              )}
            </For>
          </div>
        </SettingsRow>
      </div>

      {/* wide-input widens the input column so long filesystem paths are readable */}
      <div data-variant="wide-input">
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
                  disabled={sandbox().enabled !== true}
                  placeholder="/tmp"
                  onChange={(val) => setNewPath(val)}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === "Enter") addPath()
                  }}
                  hideLabel
                  label={language.t("settings.sandboxing.writablePaths.title")}
                />
              </div>
              <Button variant="secondary" disabled={sandbox().enabled !== true} onClick={addPath}>
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
                    "border-bottom":
                      index() < writablePaths().length - 1 ? "1px solid var(--border-weak-base)" : "none",
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
                  <IconButton
                    size="small"
                    variant="ghost"
                    icon="close"
                    disabled={sandbox().enabled !== true}
                    onClick={() => removePath(index())}
                  />
                </div>
              )}
            </For>
          </div>
        </SettingsRow>
      </div>
    </Card>
  )
}

export default SandboxingTab
